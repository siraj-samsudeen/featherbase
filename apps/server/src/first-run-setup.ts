// First-run setup (#465, design D9; spec "First-run System Manager setup").
// Offered to the built-in Administrator whenever the "A System Manager with an
// email address" health check fails, not on a first-run flag. Each person
// named becomes a System Manager (an enabled person with that address is given
// the role; anyone else is created) in one transaction, and is then invited
// through the existing invitation flow. When outbound email is the sink, the
// invitation link comes back to copy instead of being sent.
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { getDoc, saveDoc } from './document'
import { actionTransaction } from './action-transaction'
import { readSmtpConfig } from './email'
import { inviteGoogle, looksLikeEmail, methodOfKind } from './identities'
import { invitationSiteUrl, sendInvitation, signInLink, SITE_URL_MISSING } from './invitation-email'

import { SETUP_MAX_PEOPLE as MAX_PEOPLE } from 'shared'

export const SETUP_ROLE = 'System Manager'

const requestSchema = z.object({
  people: z.array(z.object({ full_name: z.string().max(140).optional(), email: z.string().max(254) }).strict()).min(1).max(MAX_PEOPLE),
}).strict()

export type SetupInvitation =
  | { status: 'sent' }
  | { status: 'link'; link: string; method_label: string }
  | { status: 'failed'; error: string; link: string | null; method_label: string }
  | { status: 'no_method' }

export interface SetupOutcome {
  person: string
  full_name: string
  email: string
  /** False when an existing person with that address was given the role. */
  created: boolean
  invitation: SetupInvitation
}

export interface SetupResult {
  people: SetupOutcome[]
  /** False while outbound email is the sink: the links are shown instead. */
  email_can_send: boolean
}

/** Can this server send email? Without SMTP every message goes to the sink. */
export function emailCanSend(): boolean {
  return readSmtpConfig() !== null
}

export async function setUpSystemManagers(input: unknown, actor: string, requestOrigin: string): Promise<SetupResult> {
  if (actor !== 'Administrator')
    throw new AppError('PermissionError', 'Only the built-in Administrator sets up who looks after the instance')
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'people'] = issue.message
    throw new AppError('ValidationError', 'Name at least one person, each with an email address', fields)
  }

  // 1. Every problem at once, beside its row, before anything is written.
  const people = parsed.data.people.map((p) => {
    const email = p.email.trim().toLowerCase()
    const full_name = p.full_name?.trim() || email.split('@')[0]
    return { email, full_name }
  })
  const problems: Record<string, string> = {}
  const seen = new Map<string, number>()
  for (const [i, p] of people.entries()) {
    if (!looksLikeEmail(p.email) || /\.invalid$/.test(p.email)) problems[`people.${i}.email`] = 'Enter an email address'
    else if (seen.has(p.email)) problems[`people.${i}.email`] = `The same address as person ${(seen.get(p.email) ?? 0) + 1}`
    else seen.set(p.email, i)
  }
  if (Object.keys(problems).length)
    throw new AppError('ValidationError', 'Some people could not be set up; nothing was changed', problems)

  /** The person who holds each address now, locked until the commit, so an
   *  edit to that person's email cannot slip between the lookup and the
   *  grant (Codex review). A problem found here rolls the whole setup back. */
  async function holders(): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    const late: Record<string, string> = {}
    for (const [i, p] of people.entries()) {
      const rows = await sql`
        select row_id, enabled from person
        where lower(trim(email)) = ${p.email} and replaced_by is null and row_id <> 'Administrator'
        order by enabled desc, created_at limit 1 for update`
      // A sign-in already using the address decides who it reaches: Google
      // sign-in finds a linked identity before any invitation, so a new
      // person would be one the invitee can never enter (Codex review).
      const signIns = await sql`
        select i.person_id, p.enabled from sign_in_identity i
        join person p on p.row_id = i.person_id
        where i.ended_at is null and p.replaced_by is null and i.person_id <> 'Administrator'
          and (lower(trim(i.email)) = ${p.email} or i.pending_email = ${p.email})
        for update of p`
      const owners = [...new Set([...rows.map((r) => String(r.row_id)), ...signIns.map((r) => String(r.person_id))])]
      if (!owners.length) continue
      if (owners.length > 1) {
        late[`people.${i}.email`] = 'This address belongs to more than one person (as a contact address or a sign-in). Decide which person it is on the Person pages first.'
        continue
      }
      const enabled = rows.length ? Boolean(rows[0].enabled) : Boolean(signIns[0].enabled)
      if (!enabled) late[`people.${i}.email`] = 'This address belongs to a disabled person. Enable them on their Person page first.'
      else found.set(p.email, owners[0])
    }
    if (Object.keys(late).length)
      throw new AppError('ValidationError', 'Some people could not be set up; nothing was changed', late)
    return found
  }

  // 2. One transaction: each person a System Manager, with a pending Google
  //    invitation when Google sign-in is on.
  const google = await methodOfKind('google')
  const invites = Boolean(google?.enabled)
  const made = await actionTransaction(async () => {
    const out: { person: string; full_name: string; email: string; created: boolean; identity: string | null; invited: boolean }[] = []
    const existing = await holders()
    for (const p of people) {
      const found = existing.get(p.email)
      let person: string
      let full_name = p.full_name
      if (found) {
        person = found
        const doc = await getDoc('Person', person, actor) as { roles?: { role: string }[]; updated_at?: unknown; full_name?: string }
        const roles = (doc.roles ?? []).map((r) => r.role)
        full_name = doc.full_name?.trim() || p.full_name
        if (!roles.includes(SETUP_ROLE))
          await saveDoc('Person', { row_id: person, roles: [...roles, SETUP_ROLE].map((role) => ({ role })), updated_at: doc.updated_at }, actor)
      } else {
        const created = await saveDoc('Person', { email: p.email, full_name: p.full_name, enabled: true, roles: [{ role: SETUP_ROLE }] }, actor, 'insert')
        person = String(created.row_id)
      }
      let identity: string | null = null
      let invited = false
      if (invites) {
        const pending = await inviteGoogle(person, p.email, actor)
        identity = pending.id
        invited = pending.created
      }
      out.push({ person, full_name, email: p.email, created: !found, identity, invited })
    }
    return out
  })

  // 3. After the commit: send each new invitation, or hand back its link.
  // A broken SMTP configuration must not hide what was already committed:
  // every invitation then counts as not sent, with its link to copy.
  let canSend = false
  let smtpBroken = false
  try {
    canSend = emailCanSend()
  } catch {
    smtpBroken = true
  }
  const site = invitationSiteUrl(requestOrigin)
  const link = site ? signInLink(site) : null
  const method_label = google?.label || 'Google'
  const result: SetupOutcome[] = []
  for (const m of made) {
    let invitation: SetupInvitation
    if (!m.identity) invitation = { status: 'no_method' }
    else if (smtpBroken && m.invited) {
      invitation = { status: 'failed', error: 'The invitation email was not sent: the email settings on this server are incomplete', link, method_label }
    } else if (!canSend || !m.invited) {
      invitation = link ? { status: 'link', link, method_label } : { status: 'failed', error: SITE_URL_MISSING, link: null, method_label }
    } else {
      const sent = await sendInvitation(m.identity, actor, requestOrigin).catch(() => null)
      invitation = sent?.invitation_email.status === 'sent'
        ? { status: 'sent' }
        : { status: 'failed', error: sent?.invitation_email.status === 'failed' ? sent.invitation_email.error : 'The invitation email was not sent', link, method_label }
    }
    result.push({ person: m.person, full_name: m.full_name, email: m.email, created: m.created, invitation })
  }
  return { people: result, email_can_send: canSend }
}
