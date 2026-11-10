// #1173: a System Manager acts on one waiting request from the Waiting for
// access page: approve it with roles and the access apps give, decline it
// with a reason, or dismiss a false alarm. Roles go through the Person save
// (System Manager only, like editing them by hand); an app's access goes
// through the app's own declared action, under its own rules, so a grant here
// never gives more than the admin could give elsewhere. Each decision is one
// activity row. Nothing is mailed: the platform sends no mail on grant.
import { z } from 'zod'
import { sql } from './db'
import { AppError, errorMessage } from './errors'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { assertSystemManager } from './permissions'
import { listInstalledApps } from './apps'
import { accessGrantApps, runGrant } from './runtime-packages'
import { canOpen, settleAccessRequests } from './waiting-for-access'

/** Roles every person holds, or nobody can be given: never offered. */
const NOT_GIVEN = ['Administrator', 'All', 'Guest'] as const
export const FULL_ADMIN = 'System Manager'

const choiceSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  group: z.string().max(60).optional(),
  given: z.boolean().optional(),
  payload: z.record(z.string(), z.string()),
}).strict()
const optionsSchema = z.object({
  about: z.array(z.object({ label: z.string().max(60), value: z.string().max(200) }).strict()).max(20).optional(),
  peers: z.array(z.string()).max(2000).optional(),
  choices: z.array(choiceSchema).max(500),
}).strict()
type Options = z.infer<typeof optionsSchema>

const reject = (message: string): never => { throw new AppError('ValidationError', message) }

async function requestRow(id: string) {
  await settleAccessRequests()
  const [row] = await sql`select row_id, person, app, app_name, created_at, declined_at, declined_by, declined_reason
    from access_request where row_id = ${id}`
  if (!row) throw new AppError('NotFoundError', 'That request is no longer waiting')
  return row
}

async function heldRoles(person: string): Promise<string[]> {
  return (await sql`select role from has_role where parent = ${person} and parenttype = 'Person' order by role`).map((r) => String(r.role))
}

async function roleChoices(): Promise<string[]> {
  return (await sql`select row_id from role where row_id not in ${sql([...NOT_GIVEN])}
    and not coalesce(disabled, false) and retired_at is null order by row_id`).map((r) => String(r.row_id))
}

/** The installed, running apps that declare how their access is given. */
async function grantApps() {
  const running = new Set((await listInstalledApps()).filter((app) => app.active).map((app) => app.name))
  return accessGrantApps().filter((grant) => running.has(grant.app))
}

async function optionsOf(grant: { app: string; read: string }, person: string, user: string): Promise<Options> {
  const parsed = optionsSchema.safeParse(await runGrant(grant.app, 'read', grant.read, { payload: { person } }, user))
  if (!parsed.success) throw new Error(`${grant.app}.${grant.read} answered in an unexpected shape`)
  return parsed.data
}

/** Everything the drawer shows for one request. */
export async function accessRequestDetails(id: string, user: string) {
  await assertSystemManager(user)
  const row = await requestRow(id)
  const person = String(row.person)
  const [p] = await sql`select row_id, full_name, email from person where row_id = ${person}`
  const signIns = await sql`select coalesce(m.label, m.row_id) as method, coalesce(i.sign_in_name, i.email) as sign_in_name
    from sign_in_identity i join sign_in_method m on m.row_id = i.method
    where i.person_id = ${person} and i.ended_at is null and i.subject is not null order by i.linked_at`
  const apps = []
  const peers = new Set<string>()
  for (const grant of await grantApps()) {
    try {
      const options = await optionsOf(grant, person, user)
      for (const peer of options.peers ?? []) if (peer !== person) peers.add(peer)
      apps.push({ app: grant.app, title: grant.title, about: options.about ?? [], choices: options.choices })
    } catch (error) {
      console.warn(JSON.stringify({ event: 'access_grant_options_failed', app: grant.app, error: errorMessage(error) }))
      apps.push({ app: grant.app, title: grant.title, about: [], choices: [], problem: `Couldn't load what ${grant.title} can give` })
    }
  }
  const hints: Record<string, number> = {}
  if (peers.size)
    for (const r of await sql`select role, count(distinct parent)::int as n from has_role
      where parenttype = 'Person' and parent in ${sql([...peers])} group by role`)
      hints[String(r.role)] = Number(r.n)
  let declined = null
  if (row.declined_at) {
    const [by] = await sql`select full_name from person where row_id = ${row.declined_by}`
    declined = { at: new Date(row.declined_at as string).toISOString(), by: String(row.declined_by), by_name: by?.full_name ?? null, reason: String(row.declined_reason ?? '') }
  }
  return {
    id: String(row.row_id), app: String(row.app), app_name: String(row.app_name),
    asked_at: new Date(row.created_at as string).toISOString(), declined,
    person: { id: person, full_name: p?.full_name ?? null, email: p?.email ?? null },
    sign_ins: signIns.map((s) => ({ method: String(s.method), sign_in_name: String(s.sign_in_name ?? '') })),
    roles_held: await heldRoles(person),
    role_choices: await roleChoices(),
    role_hints: hints,
    apps,
  }
}

const approveSchema = z.object({
  roles: z.array(z.string()).max(50).optional(),
  grants: z.array(z.object({ app: z.string(), choice: z.string() }).strict()).max(100).optional(),
  confirm_full_admin: z.boolean().optional(),
}).strict()

/** Approve: give the roles picked and each app choice picked. Returns what
 *  was given, what an app refused, and whether the person can now open the
 *  app they asked for (when they can, the request has gone). */
export async function approveAccessRequest(id: string, user: string, body: unknown) {
  await assertSystemManager(user)
  const parsed = approveSchema.safeParse(body ?? {})
  if (!parsed.success) reject('Expected { roles, grants }')
  const { roles = [], grants = [], confirm_full_admin: confirmed } = parsed.data!
  const row = await requestRow(id)
  const person = String(row.person)
  const held = await heldRoles(person)
  const offered = await roleChoices()
  const unknown = roles.filter((role) => !offered.includes(role))
  if (unknown.length) reject(`These roles can't be given: ${unknown.join(', ')}`)
  const newRoles = [...new Set(roles.filter((role) => !held.includes(role)))]
  if (newRoles.includes(FULL_ADMIN) && confirmed !== true) reject('System Manager gives full admin access: confirm it to give it')

  // Each app choice is looked up afresh among what the app offers this
  // person, so only an offered payload is ever sent, plus the person.
  const apps = await grantApps()
  const picked: { grant: (typeof apps)[number]; choice: z.infer<typeof choiceSchema> }[] = []
  const optionsByApp = new Map<string, Options>()
  for (const { app, choice } of grants) {
    const grant = apps.find((g) => g.app === app)
    if (!grant) reject(`${app} gives no access from here`)
    if (!optionsByApp.has(app)) optionsByApp.set(app, await optionsOf(grant!, person, user))
    const found = optionsByApp.get(app)!.choices.find((c) => c.id === choice)
    if (!found) reject(`${grant!.title} offers no such choice`)
    if (!found!.given && !picked.some((p) => p.grant.app === app && p.choice.id === choice)) picked.push({ grant: grant!, choice: found! })
  }
  if (!newRoles.length && !picked.length) reject('Pick a role or something else to give that they do not have yet')

  if (newRoles.length) {
    const [p] = await sql`select updated_at from person where row_id = ${person}`
    const existing = await sql`select row_id, role from has_role where parent = ${person} and parenttype = 'Person' order by position, row_id`
    await saveDoc('Person', {
      row_id: person, updated_at: p.updated_at,
      roles: [...existing.map((r) => ({ row_id: String(r.row_id), role: String(r.role) })), ...newRoles.map((role) => ({ role }))],
    }, user)
  }
  const given: string[] = [...newRoles]
  const failed: { label: string; problem: string }[] = []
  const appLines: string[] = []
  for (const { grant, choice } of picked) {
    const label = `${grant.title}: ${choice.group ? `${choice.group} ` : ''}${choice.label}`
    try {
      await runGrant(grant.app, 'action', grant.action, { idempotencyKey: `access-request:${id}:${grant.app}:${choice.id}`, payload: { ...choice.payload, person } }, user)
      given.push(label)
      appLines.push(label)
    } catch (error) {
      failed.push({ label, problem: error instanceof AppError ? error.message : 'It did not go through' })
    }
  }
  if (given.length) {
    const parts = [newRoles.length ? `roles ${newRoles.join(', ')}` : '', ...appLines].filter(Boolean)
    await logActivity(user, `access_granted for ${person} in ${row.app_name}: ${parts.join('; ')}`)
  }
  const open = await canOpen(person, String(row.app_name))
  await settleAccessRequests()
  return { given, failed, open }
}

/** Decline with a reason: the request stays, marked declined. */
export async function declineAccessRequest(id: string, user: string, body: unknown) {
  await assertSystemManager(user)
  const reason = typeof (body as { reason?: unknown })?.reason === 'string' ? String((body as { reason: string }).reason).trim() : ''
  if (!reason) reject('Say why it is declined')
  if (reason.length > 500) reject('Keep the reason under 500 characters')
  const row = await requestRow(id)
  await sql`update access_request set declined_at = now(), declined_by = ${user}, declined_reason = ${reason},
    updated_at = now(), updated_by = ${user} where row_id = ${id}`
  await logActivity(user, `access_declined for ${row.person} in ${row.app_name}: ${reason}`)
  return { declined: id }
}

/** Dismiss a request that needs nothing: it goes, and opening the app again
 *  is a fresh request. */
export async function dismissAccessRequest(id: string, user: string) {
  await assertSystemManager(user)
  const row = await requestRow(id)
  await sql`delete from access_request where row_id = ${id}`
  await logActivity(user, `access_dismissed for ${row.person} in ${row.app_name}`)
  return { dismissed: id }
}
