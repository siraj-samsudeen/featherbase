// #1277 (J1, J3): the steps towards business roles, each run only when someone asks for it (owner, 18-Nov-2026: he
// approves each starting role, and the switch stays on the old rules until he says so). The starting roles come
// only from the Add The Starting Roles button; the old grants to Dash Reader are given to the manager roles only by the
// Give Old Grants To Business Roles action (decision 7: start narrow; any other grant is added on request); neither
// touches the switch. Running either again adds nothing: a role or title
// already there, by name, is never changed, and a grant already given to that role is not given twice. Every
// addition, and every old grant with no matching business role, is written once to dash.switch_over_log. Old
// grants stay as they were, so the old rules keep working whichever way the switch is set (J5).
import { DASH_APP, type Model } from './business-roles.ts'
import { ROLE, PERMISSION, TITLE_MAP, businessModel, every } from './business-access.ts'
import { permissionRowKey } from './permission-grid-server.ts'
import { type Documents } from './provider.ts'
import { DASH_READER_GRANT_ROLES, STARTING_ROLES, STARTING_TITLES } from './starting-roles.ts'
import { accessKey, all } from './report-access-server.ts'
import { checked, exact, text } from './values.ts'

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
  const lines: LogLine[] = []
  const log = async (line: LogLine) => {
    const id = JSON.stringify([line.step, line.outcome, exact(line.business_role), exact(line.source_grant), line.detail])
    if (seen.has(id)) return false
    seen.add(id)
    lines.push(line)
    return true
  }
  /** #1340: the run kept as one record, its counts in its title, and each line it wrote linked to it. */
  return Object.assign(log, {
    async finish(step: RunStep, summary: string, counts: Partial<Record<'added' | 'already_there' | 'not_carried_over', number>>, by: string | null) {
      const run = await write.create(SETUP_RUN, { step, summary: `${step}: ${summary}`, ...counts, run_by_name: by })
      for (const line of lines)
        await write.create(SWITCH_OVER_LOG, { step: line.step, outcome: line.outcome, detail: line.detail, business_role: line.business_role ?? null, source_grant: line.source_grant ?? null, setup_run: exact(run.row_id) })
      return exact(run.row_id)
    },
  })
}

/** #1340: one record per run of a step, so Activity shows each run as its counts, its lines one click away. */
export const SETUP_RUN = 'dash.setup_run'
export type RunStep = 'Add The Starting Roles' | 'Give Old Grants To Business Roles'
const counted = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
export const startingRolesSummary = ({ roles, titles }: { roles: number; titles: number }) =>
  roles || titles ? `${counted(roles, 'role')} and ${counted(titles, 'title map')} added` : 'nothing to add: every starting role and title is there'
export const oldGrantsSummary = ({ added, alreadyThere, notConverted }: { added: number; alreadyThere: number; notConverted: number }) =>
  `${added.toLocaleString('en-IN')} added · ${alreadyThere.toLocaleString('en-IN')} already there · ${notConverted.toLocaleString('en-IN')} not carried over`

/** J1: the starting roles and Title Map rows that are missing, by name. A role or title already there is never changed. */
export async function ensureStartingRoles(read: Documents, write: Writer, log?: (line: LogLine) => Promise<boolean>): Promise<{ roles: number; titles: number }> {
  const ids = new Map((await every(read, ROLE, ['role_name'])).map(r => [key(text(r.role_name)), exact(r.row_id)]))
  let roles = 0
  for (const role of STARTING_ROLES.filter(r => !ids.has(key(r.name)))) {
    const saved = await write.create(ROLE, { role_name: role.name, description: role.description, reaches: role.reaches, by_hand_only: !!role.by_hand_only })
    ids.set(key(role.name), exact(saved.row_id))
    for (const [app, level, verb, thing, reach] of role.grants)
      await write.create(PERMISSION, { business_role: exact(saved.row_id), app, level, verb, thing, reach, permission_key: permissionRowKey({ business_role: exact(saved.row_id), app, level, verb, thing }) })
    roles++
    await log?.({ step: 'Starting role', outcome: 'Added', business_role: exact(saved.row_id), detail: `Added the starting role ${role.name}, with its ${role.grants.length} permission${role.grants.length === 1 ? '' : 's'}` })
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

/**
 * The business roles a grant to an old platform role becomes. Owner, 18-Nov-2026 (decision 7, start narrow; add on request):
 * only a grant to Dash Reader, and only to the manager roles of the starting data (DASH_READER_GRANT_ROLES) that hold a
 * Dash permission and are not given by hand only. Any other role's grant, Dash All-Stores Reader's among them, is none.
 */
export function rolesForOldRole(role: string, model: Pick<Model, 'roles' | 'permissions'>): string[] {
  if (role !== 'Dash Reader') return []
  const dash = new Set(model.permissions.filter(p => p.app === DASH_APP).map(p => p.role))
  const managers = new Set(DASH_READER_GRANT_ROLES.map(key))
  return model.roles.filter(r => dash.has(r.id) && !r.by_hand_only && managers.has(key(r.name))).map(r => r.id).sort()
}

/** The old receiver of a live grant (a job or a platform role), and the business roles it is carried to: none for a job (decision 7). */
export function carriedOver(row: Row, model: Pick<Model, 'roles' | 'permissions'>): { old: { kind: 'job' | 'role'; name: string }; roles: string[] } | null {
  const old = exact(row.job) ? { kind: 'job' as const, name: exact(row.job) } : exact(row.role) ? { kind: 'role' as const, name: exact(row.role) } : null
  // A row that is not one thing to one receiver gives nothing under the old rules, so it gives nothing to a role either.
  if (!old || !('key' in accessKey(row))) return null
  return { old, roles: old.kind === 'role' ? rolesForOldRole(old.name, model) : [] }
}

/** What happens to one old grant when the old grants are given to business roles (#1340: said before it runs, then done). */
export type GrantOutcome = 'Will be added' | 'Already there' | 'Not carried over' | 'Stays with the person'
export interface PlannedGrant {
  grant: string
  gives: { report: string } | { report_bundle: string }
  /** "the report Vendor Sales", as the log says it. */
  what: string
  old: { kind: 'job' | 'role' | 'person'; name: string }
  outcome: GrantOutcome
  /** The business role it is given to, for Will be added and Already there. */
  role?: string
  /** Already given to that role by an earlier run: nothing is written or logged again. */
  earlier?: boolean
}

/**
 * J3, worked out without writing: each live grant to Dash Reader given also to the manager roles (Will be added, or
 * Already there), any other grant to a job or an old role not carried over, and a grant to one person staying with them (D4).
 * Giving the old grants runs exactly this plan, so the preview and the run cannot disagree.
 */
export async function planGrants(read: Documents, model: Model, reportNames: ReadonlyMap<string, string> = new Map()): Promise<PlannedGrant[]> {
  // The log names reports and bundles by name, never by key.
  const bundleNames = new Map((await every(read, 'dash.report_bundle', ['bundle_name'])).map(b => [exact(b.row_id), text(b.bundle_name)]))
  // Live grants only, as reportsGivenTo reads them: a retired or removed grant is access already withdrawn (Codex round 3).
  const rows = (await all(read, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'business_role', 'removed'])).filter(r => !checked(r.removed))
  const live = new Set(rows.map(r => accessKey(r)).flatMap(k => ('key' in k ? [k.key] : [])))
  // Each old grant given to a role once, ever: a later removal or change of that role grant is the owner's decision,
  // and running this again must not undo it (Codex adversarial round 1). The log is the record of what was given.
  const given = new Set((await every(read, SWITCH_OVER_LOG, ['step', 'outcome', 'source_grant', 'business_role']))
    .filter(l => text(l.step) === 'Report grant' && ['Added', 'Already given'].includes(text(l.outcome))).map(l => `${exact(l.source_grant)}/${exact(l.business_role)}`))
  const plan: PlannedGrant[] = []
  for (const row of rows) {
    const gives = exact(row.report) ? { report: exact(row.report) } : { report_bundle: exact(row.report_bundle) }
    const what = 'report' in gives ? `the report ${reportNames.get(gives.report!) || 'no longer listed'}` : `the bundle ${bundleNames.get(gives.report_bundle!) || 'no longer listed'}`
    const carried = carriedOver(row, model)
    if (!carried) {
      if (exact(row.person) && 'key' in accessKey(row)) plan.push({ grant: exact(row.row_id), gives, what, old: { kind: 'person', name: exact(row.person) }, outcome: 'Stays with the person' })
      continue
    }
    const { old, roles: targets } = carried
    if (!targets.length) {
      plan.push({ grant: exact(row.row_id), gives, what, old, outcome: 'Not carried over' })
      continue
    }
    for (const role of targets) {
      const found = accessKey({ ...gives, business_role: role })
      if (!('key' in found)) continue
      const step = { grant: exact(row.row_id), gives, what, old, role }
      if (given.has(`${exact(row.row_id)}/${role}`)) { plan.push({ ...step, outcome: 'Already there', earlier: true }); continue }
      given.add(`${exact(row.row_id)}/${role}`)
      if (live.has(found.key)) { plan.push({ ...step, outcome: 'Already there' }); continue }
      live.add(found.key)
      plan.push({ ...step, outcome: 'Will be added' })
    }
  }
  return plan
}

/** J3: the plan carried out: each grant to add written and logged, each one already there or not carried over logged once. */
export async function convertGrants(read: Documents, write: Writer, model: Model, log: (line: LogLine) => Promise<boolean>,
  reportNames: ReadonlyMap<string, string> = new Map()): Promise<{ added: number; notConverted: number; alreadyThere: number }> {
  const roleName = new Map(model.roles.map(r => [r.id, r.name]))
  let added = 0
  let notConverted = 0
  let alreadyThere = 0
  for (const step of await planGrants(read, model, reportNames)) {
    const { old, what } = step
    if (step.outcome === 'Not carried over') {
      notConverted++
      await log({ step: 'Report grant', outcome: 'Not converted', source_grant: step.grant,
        detail: `The grant of ${what} to the ${old.kind} ${old.name} is not carried over to business roles: add it to a role on request. It stays as it was, and gives nothing while business roles decide` })
    } else if (step.outcome === 'Already there') {
      alreadyThere++
      if (!step.earlier) await log({ step: 'Report grant', outcome: 'Already given', source_grant: step.grant, business_role: step.role,
        detail: `${roleName.get(step.role!)} already had ${what}, as it was given to the ${old.kind} ${old.name}` })
    } else if (step.outcome === 'Will be added') {
      await write.create(ACCESS, { ...step.gives, business_role: step.role, given_by_name: 'Switch-over to business roles' })
      added++
      await log({ step: 'Report grant', outcome: 'Added', source_grant: step.grant, business_role: step.role,
        detail: `Gave ${what} to ${roleName.get(step.role!)}, as it was given to the ${old.kind} ${old.name}` })
    }
  }
  return { added, notConverted, alreadyThere }
}

/** J3, when asked: the old grants given to business roles, the run kept with its log. It changes no switch and adds no role. */
export async function giveOldGrantsToRoles(read: Documents, write: Writer, today: string, reportNames: ReadonlyMap<string, string>, by: string | null = null) {
  const { model } = await businessModel(read, today)
  const log = await logger(read, write)
  const grants = await convertGrants(read, write, model, log, reportNames)
  const run = await log.finish('Give Old Grants To Business Roles', oldGrantsSummary(grants),
    { added: grants.added, already_there: grants.alreadyThere, not_carried_over: grants.notConverted }, by)
  return { grants_added: grants.added, grants_not_converted: grants.notConverted, grants_already_there: grants.alreadyThere, run }
}
