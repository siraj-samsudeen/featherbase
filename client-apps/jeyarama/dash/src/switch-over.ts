// #1277 (J1, J3): the steps towards business roles, each run only when someone asks for it (owner, 18-Nov-2026: he
// approves each starting role, and the switch stays on the old rules until he says so). The starting roles come
// only from the Add The Starting Roles button; the old grants are given to business roles only by the Give Old
// Grants To Business Roles action; neither touches the switch. Running either again adds nothing: a role or title
// already there, by name, is never changed, and a grant already given to that role is not given twice. Every
// addition, and every old grant with no matching business role, is written once to dash.switch_over_log. Old
// grants stay as they were, so the old rules keep working whichever way the switch is set (J5).
import { DASH_APP, shadowReceiver, type Model } from './business-roles.ts'
import { ROLE, PERMISSION, TITLE_MAP, businessModel, every } from './business-access.ts'
import { ALL_STORES_ROLE, type Documents } from './provider.ts'
import { STARTING_ROLES, STARTING_TITLES } from './starting-roles.ts'
import { accessKey } from './report-access-server.ts'
import { checked, exact, text } from './values.ts'
import { istToday } from './report.ts'

type Row = Record<string, unknown>
export const SWITCH_OVER_LOG = 'dash.switch_over_log'
export const ACCESS = 'dash.report_access'
export type Step = 'Starting role' | 'Title map' | 'Report grant'
export type Outcome = 'Added' | 'Already given' | 'Not converted'
export interface Writer { create(table: string, values: Row): Promise<Row> }
export interface LogLine { step: Step; outcome: Outcome; detail: string; business_role?: string | null; source_grant?: string | null }

const key = (name: string) => name.trim().toLowerCase()

/** Writes one log line, unless the same line is there already (a rerun repeats nothing). */
export async function logger(read: Documents, write: Writer) {
  const seen = new Set((await every(read, SWITCH_OVER_LOG, ['step', 'outcome', 'business_role', 'source_grant', 'detail']))
    .map(r => JSON.stringify([text(r.step), text(r.outcome), exact(r.business_role), exact(r.source_grant), text(r.detail)])))
  return async (line: LogLine) => {
    const id = JSON.stringify([line.step, line.outcome, exact(line.business_role), exact(line.source_grant), line.detail])
    if (seen.has(id)) return false
    seen.add(id)
    await write.create(SWITCH_OVER_LOG, { step: line.step, outcome: line.outcome, detail: line.detail, business_role: line.business_role ?? null, source_grant: line.source_grant ?? null })
    return true
  }
}

/** J1: the starting roles and Title Map rows that are missing, by name. A role or title already there is never changed. */
export async function ensureStartingRoles(read: Documents, write: Writer, log?: (line: LogLine) => Promise<boolean>): Promise<{ roles: number; titles: number }> {
  const ids = new Map((await every(read, ROLE, ['role_name'])).map(r => [key(text(r.role_name)), exact(r.row_id)]))
  let roles = 0
  for (const role of STARTING_ROLES.filter(r => !ids.has(key(r.name)))) {
    const saved = await write.create(ROLE, { role_name: role.name, description: role.description, reaches: role.reaches, by_hand_only: !!role.by_hand_only })
    ids.set(key(role.name), exact(saved.row_id))
    for (const [app, level, verb, thing, reach] of role.grants)
      await write.create(PERMISSION, { business_role: exact(saved.row_id), app, level, verb, thing, reach })
    roles++
    await log?.({ step: 'Starting role', outcome: 'Added', business_role: exact(saved.row_id), detail: `Added the starting role ${role.name}, with its ${role.grants.length} permissions` })
  }
  const mapped = new Set((await every(read, TITLE_MAP, ['title'])).map(r => key(text(r.title))))
  let titles = 0
  for (const [title, role] of STARTING_TITLES.filter(([title, role]) => !mapped.has(key(title)) && ids.has(key(role)))) {
    await write.create(TITLE_MAP, { title, business_role: ids.get(key(role))! })
    titles++
    await log?.({ step: 'Title map', outcome: 'Added', business_role: ids.get(key(role))!, detail: `Mapped the title ${title} to ${role}` })
  }
  return { roles, titles }
}

/** The business roles that a grant to an old platform role becomes: those holding a Dash permission, not given by hand only. */
export function rolesForOldRole(role: string, model: Pick<Model, 'roles' | 'permissions'>): string[] {
  const dash = new Set(model.permissions.filter(p => p.app === DASH_APP).map(p => p.role))
  const candidates = model.roles.filter(r => dash.has(r.id) && !r.by_hand_only)
  if (role === 'Dash Reader') return candidates.map(r => r.id).sort()
  // Dash All-Stores Reader reached every store: the roles that reach the whole company.
  if (role === ALL_STORES_ROLE) return candidates.filter(r => r.reaches === 'Whole company').map(r => r.id).sort()
  return []
}

/** J3: each live grant to a job or an old role, given also to its business roles. A grant to one person stays as it is (D4). */
export async function convertGrants(read: Documents, write: Writer, model: Model, log: (line: LogLine) => Promise<boolean>,
  reportNames: ReadonlyMap<string, string> = new Map()): Promise<{ added: number; notConverted: number }> {
  // The log names reports and bundles by name, never by key.
  const bundleNames = new Map((await every(read, 'dash.report_bundle', ['bundle_name'])).map(b => [exact(b.row_id), text(b.bundle_name)]))
  const rows = (await every(read, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'business_role', 'removed'])).filter(r => !checked(r.removed))
  const live = new Set(rows.map(r => accessKey(r)).flatMap(k => ('key' in k ? [k.key] : [])))
  // Each old grant given to a role once, ever: a later removal or change of that role grant is the owner's decision,
  // and running this again must not undo it (Codex adversarial round 1). The log is the record of what was given.
  const given = new Set((await every(read, SWITCH_OVER_LOG, ['step', 'outcome', 'source_grant', 'business_role']))
    .filter(l => text(l.step) === 'Report grant' && ['Added', 'Already given'].includes(text(l.outcome))).map(l => `${exact(l.source_grant)}/${exact(l.business_role)}`))
  const roleName = new Map(model.roles.map(r => [r.id, r.name]))
  let added = 0
  let notConverted = 0
  for (const row of rows) {
    const old = exact(row.job) ? { kind: 'job', name: exact(row.job) } : exact(row.role) ? { kind: 'role', name: exact(row.role) } : null
    if (!old || exact(row.business_role) || exact(row.person)) continue
    const gives = exact(row.report) ? { report: exact(row.report) } : { report_bundle: exact(row.report_bundle) }
    const what = 'report' in gives ? `the report ${reportNames.get(gives.report!) || 'no longer listed'}` : `the bundle ${bundleNames.get(gives.report_bundle!) || 'no longer listed'}`
    const nullRow = { report: null, report_bundle: null, person: null, role: null, job: null, business_role: null }
    const receiver = old.kind === 'job' ? shadowReceiver({ ...nullRow, ...gives, job: old.name }, model) : null
    const targets = old.kind === 'job' ? (receiver?.kind === 'role' ? [receiver.role] : []) : rolesForOldRole(old.name, model)
    if (!targets.length) {
      notConverted++
      await log({ step: 'Report grant', outcome: 'Not converted', source_grant: exact(row.row_id),
        detail: `The grant of ${what} to the ${old.kind} ${old.name} has no matching business role: it stays as it was, and gives nothing while business roles decide` })
      continue
    }
    for (const role of targets) {
      const found = accessKey({ ...gives, business_role: role })
      if (!('key' in found) || given.has(`${exact(row.row_id)}/${role}`)) continue
      given.add(`${exact(row.row_id)}/${role}`)
      if (live.has(found.key)) {
        await log({ step: 'Report grant', outcome: 'Already given', source_grant: exact(row.row_id), business_role: role,
          detail: `${roleName.get(role)} already had ${what}, as it was given to the ${old.kind} ${old.name}` })
        continue
      }
      await write.create(ACCESS, { ...gives, business_role: role, given_by_name: 'Switch-over to business roles' })
      live.add(found.key)
      added++
      await log({ step: 'Report grant', outcome: 'Added', source_grant: exact(row.row_id), business_role: role,
        detail: `Gave ${what} to ${roleName.get(role)}, as it was given to the ${old.kind} ${old.name}` })
    }
  }
  return { added, notConverted }
}

/** J3, when asked: the old grants given to business roles, logged. It changes no switch and adds no role. */
export async function giveOldGrantsToRoles(read: Documents, write: Writer, today: string = istToday(), reportNames: ReadonlyMap<string, string> = new Map()) {
  const { model } = await businessModel(read, today)
  const grants = await convertGrants(read, write, model, await logger(read, write), reportNames)
  return { grants_added: grants.added, grants_not_converted: grants.notConverted }
}
