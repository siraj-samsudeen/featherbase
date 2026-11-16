// Report access (#1046) on the server: who has been given which report, read fresh on every
// request, and the Report access page's reads and actions. The access Tables are read as the
// app (`baseTables`), so an ordinary reader needs no grant on them and can't list them; the
// page writes as the signed-in person, through the platform's save path, so every change runs
// the save rules and lands in version history.
import { reportsReaching, type AccessRow, type Because, type BundleMember } from './report-access.ts'
import { EMPLOYEE_STATUS, exact, holdsOn, text } from './values.ts'
import { diveIdIn, reportKeyFor, type DiveChoice } from './add-dive.ts'
import { istToday } from './report.ts'
import { TEAM_MANAGER, checkedFor, checkedSave, givableBundles, teamOf } from './team-access.ts'
import { ALL_STORES_ROLE, type Documents } from './provider.ts'

type Row = Record<string, unknown>

/** The role that manages report access. System Managers manage it too. */
export const ACCESS_MANAGER = 'Report Access Manager'
export const ACCESS = 'dash.report_access'
export const BUNDLE = 'dash.report_bundle'
export const MEMBER = 'dash.report_bundle_member'
export const REPORT = 'dash.report'

/** What these reads and actions use of the platform's context. */
export interface AccessContext {
  user: string
  /** The caller's own name, as the platform shows it. */
  userName?: string
  roles?: readonly string[]
  payload?: unknown
  baseTables?: Documents
  documents?: Documents & {
    create?(table: string, values: Row): Promise<Row>
    update?(table: string, values: Row): Promise<Row>
  }
  people?: {
    names(ids: string[]): Promise<Record<string, string | null>>
    rolesOf?(person: string): Promise<readonly string[]>
    roleNames?(): Promise<readonly string[]>
    waitingForAccess?(): Promise<readonly { person: string; name?: string | null; asked_at: string }[]>
  }
  reject?(message: string): never
  /** What a person reaches today, by their jobs and roles (#1217: a Team Report Manager gives only reports they can open). Missing means nothing. */
  reach?(person: string, roles: readonly string[]): Promise<Reach>
}

const PAGE = 500
export async function all(documents: Documents, table: string, fields: string[], filters: [string, string, unknown][] = []): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { fields: ['row_id', ...fields], filters, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const nullable = (value: unknown) => (exact(value) === '' ? null : exact(value))
/** A Check column's value as saved: 1, true or '1'. */
const ticked = (value: unknown) => value === 1 || value === true || value === '1'

/** The jobs `person` holds today, from their current Employee rows' job assignments. */
export async function jobsOf(base: Documents, person: string, on: string): Promise<string[]> {
  const employees = (await all(base, 'Employee', [EMPLOYEE_STATUS], [['person', '=', person]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  if (!employees.length) return []
  const jobs = await all(base, 'Job Assignment', ['job', 'starts_on', 'ends_on'], [['employee', 'in', employees.map(row => exact(row.row_id))]])
  return [...new Set(jobs.filter(row => holdsOn(row, on)).map(row => exact(row.job)).filter(Boolean))].sort()
}

/** Every access row and bundle member, as the app reads them. */
async function grants(base: Documents): Promise<{ rows: (AccessRow & { row_id: string })[]; members: BundleMember[] }> {
  const rows = (await all(base, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'removed'])).filter(row => !ticked(row.removed)).map(row => ({
    row_id: exact(row.row_id), report: nullable(row.report), report_bundle: nullable(row.report_bundle),
    person: nullable(row.person), role: nullable(row.role), job: nullable(row.job),
  }))
  const members = (await all(base, MEMBER, ['report_bundle', 'report', 'removed'])).filter(row => !ticked(row.removed)).map(row => ({ report_bundle: exact(row.report_bundle), report: exact(row.report) }))
  return { rows, members }
}

/**
 * The reports given to `person`, by report key, with every route that gives each. Read fresh:
 * a removed row, a role taken away, a job ended or a report taken out of a bundle is gone on the
 * next request.
 */
export async function reportsGivenTo(base: Documents, person: string, roles: readonly string[], on: string): Promise<Map<string, Because[]>> {
  const { rows, members } = await grants(base)
  return reportsReaching({ person, roles, jobs: await jobsOf(base, person, on) }, rows, members)
}

/** Does the caller manage report access for the whole company? */
export const managesAccess = (ctx: AccessContext) => (ctx.roles ?? []).some(role => role === ACCESS_MANAGER || role === 'System Manager')

/** Does the caller manage report access for their own team only (#1217)? */
export const managesTeamAccess = (ctx: AccessContext) => !managesAccess(ctx) && (ctx.roles ?? []).includes(TEAM_MANAGER)

const NOT_A_MANAGER = 'Only a Report Access Manager or a System Manager can see or change who has which report'
function managerOnly(ctx: AccessContext): void {
  if (!managesAccess(ctx)) ctx.reject!(NOT_A_MANAGER)
}

/**
 * Whose report access the caller manages: the whole company, or their team (#1217) with the
 * reports they can open themselves, read fresh on every request. Anyone else is refused.
 */
type Scope = { kind: 'company' } | { kind: 'team'; team: Map<string, string>; holds: Set<string> }
async function scopeOf(ctx: AccessContext, on: string): Promise<Scope> {
  if (managesAccess(ctx)) return { kind: 'company' }
  if (!managesTeamAccess(ctx)) ctx.reject!(NOT_A_MANAGER)
  const team = await teamOf(ctx.baseTables!, ctx.user, on)
  // What they can open themselves: given to them, and not shut by their own reach, as Dash offers it to them.
  // Opening a report takes a Dash reader role too (the manifest's report and embed_session readRoles; Codex adversarial round 2).
  const opensReports = (ctx.roles ?? []).some(role => role === 'Dash Reader' || role === ALL_STORES_ROLE)
  const reports = (await names(ctx)).reports
  const reach = ctx.reach ? await ctx.reach(ctx.user, ctx.roles ?? []) : { any: false, wholeStore: false }
  const holds = new Set(!opensReports ? [] : [...(await reportsGivenTo(ctx.baseTables!, ctx.user, ctx.roles ?? [], on)).keys()]
    .filter(key => reports.has(key) && closedBecause(reports.get(key), reach) === null))
  return { kind: 'team', team, holds }
}
const NOT_IN_TEAM = 'That person is not in your team'
const NOT_HELD = 'You can give only reports you can open yourself'

/** A bundle id to its name, and a report key to its name. */
async function names(ctx: AccessContext) {
  const reports = await ctx.documents!.list('dash.report', { fields: ['report_key', 'report_name', 'filter_shape'], order_by: 'report_name asc', limit_page_length: 200 })
  const bundles = await all(ctx.baseTables!, BUNDLE, ['bundle_name'])
  return {
    reports: new Map(reports.map(row => [exact(row.report_key), { name: text(row.report_name), noFilter: exact(row.filter_shape) === 'No filter', wholeStores: exact(row.filter_shape) === 'Whole stores' }])),
    bundles: new Map(bundles.map(row => [exact(row.row_id), text(row.bundle_name)])),
  }
}

/** A person's name as the caller may read it, falling back to their name on the staff list. */
export async function personNames(ctx: AccessContext, ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!wanted.length) return found
  const shown = await ctx.people!.names(wanted)
  for (const id of wanted) if (shown[id]) found.set(id, String(shown[id]))
  const missing = wanted.filter(id => !found.has(id))
  if (missing.length)
    for (const row of await all(ctx.baseTables!, 'Employee', ['name', 'person'], [['person', 'in', missing]]))
      if (text(row.name) && !found.has(exact(row.person))) found.set(exact(row.person), text(row.name))
  return found
}

/** One `because`, as the person lookup says it: "Job Team Leader, through Team leader pack". */
export function becauseLine(because: Because, bundleName: (id: string) => string): string {
  const route = because.kind === 'person' ? 'Given directly' : `${because.kind === 'role' ? 'Role' : 'Job'} ${because.receiver}`
  return because.bundle ? `${route}, through ${bundleName(because.bundle)}` : route
}

export type Gives = { kind: 'Report' | 'Bundle'; name: string }
export type To = { kind: 'Person' | 'Role' | 'Job'; name: string; who?: Who }

/** The Report access page: who has what, what can be given, and who is waiting. Managers only. */
export async function accessPage(ctx: AccessContext, on: string = istToday()) {
  const scope = await scopeOf(ctx, on)
  const team = scope.kind === 'team' ? scope : null
  const named = await names(ctx)
  // A Team Report Manager sees only what may be given, and only grants to their team, as a person.
  // The full name maps describe existing grants; only what may be given narrows (Codex standard round 1).
  const givable = { reports: new Set(team ? [...named.reports.keys()].filter(key => team.holds.has(key)) : named.reports.keys()), bundles: new Set(named.bundles.keys()) }
  const access = (await all(ctx.baseTables!, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'updated_at', 'created_by', 'given_by_name', 'removed']))
    .filter(row => !ticked(row.removed) && (!team || team.team.has(exact(row.person))))
  const members = (await all(ctx.baseTables!, MEMBER, ['report_bundle', 'report', 'updated_at', 'removed'])).filter(row => !ticked(row.removed))
  if (team) {
    givable.bundles = givableBundles([...named.bundles.keys()], members.map(m => ({ report_bundle: exact(m.report_bundle), report: exact(m.report) })), team.holds)
  }
  const jobs = team ? [] : await all(ctx.baseTables!, 'Job Assignment', ['job'])
  const waiting = team ? [] : (await ctx.people!.waitingForAccess?.()) ?? []
  const people = await personNames(ctx, [...access.map(row => exact(row.person)), ...access.map(row => exact(row.created_by)), ...waiting.map(w => w.person)])
  const who = await whoIs(ctx.baseTables!, [...access.map(row => exact(row.person)), ...waiting.map(w => w.person)], on)
  const teamWho = team ? await whoIs(ctx.baseTables!, [...team.team.keys()], on) : new Map<string, Who>()
  const rows = access.map(row => {
    const gives: Gives | null = nullable(row.report) ? { kind: 'Report', name: named.reports.get(exact(row.report))?.name ?? 'A report no longer listed' }
      : nullable(row.report_bundle) ? { kind: 'Bundle', name: named.bundles.get(exact(row.report_bundle)) ?? 'A bundle no longer listed' } : null
    const to: To | null = nullable(row.person) ? { kind: 'Person', name: people.get(exact(row.person)) ?? 'Someone you can’t see', who: who.get(exact(row.person)) }
      : nullable(row.role) ? { kind: 'Role', name: exact(row.role) } : nullable(row.job) ? { kind: 'Job', name: exact(row.job) } : null
    // A Team Report Manager takes away only what they gave someone in their team.
    const removable = !team || exact(row.created_by) === ctx.user
    return { id: exact(row.row_id), updated_at: exact(row.updated_at), gives, to, removable, given_by: text(row.given_by_name) || people.get(exact(row.created_by)) || (exact(row.created_by) === 'Administrator' ? 'Administrator' : 'Someone'),
      given_on: exact(row.updated_at).slice(0, 10) }
  }).filter(row => row.gives && row.to)
    .sort((a, b) => a.gives!.name.localeCompare(b.gives!.name) || a.to!.name.localeCompare(b.to!.name))
  return {
    scope: scope.kind,
    // #1216: each with who they are, so two people of the same name in a team can be told apart.
    team: team ? [...team.team].map(([person, name]) => ({ person, name, ...teamWho.get(person)! })) : [],
    reports: [...named.reports].filter(([key]) => givable.reports.has(key)).map(([key, report]) => ({ key, name: report.name })),
    bundles: [...named.bundles].filter(([id]) => givable.bundles.has(id)).map(([id, name]) => ({ id, name,
      reports: members.filter(m => exact(m.report_bundle) === id && named.reports.has(exact(m.report)))
        .map(m => ({ member: exact(m.row_id), updated_at: exact(m.updated_at), key: exact(m.report), name: named.reports.get(exact(m.report))!.name }))
        .sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: team ? [] : [...((await ctx.people!.roleNames?.()) ?? [])],
    jobs: [...new Set(jobs.map(row => exact(row.job)).filter(Boolean))].sort(),
    rows,
    waiting: waiting.map(w => ({ person: w.person, name: w.name || people.get(w.person) || 'Someone', asked_on: w.asked_at.slice(0, 10), who: who.get(w.person) })),
  }
}

/**
 * Who a person is on the staff list (#1216), so people with the same name can be told apart:
 * their employee code, each job they hold today with its site, and whether they are current
 * staff, have left, or are not on the staff list at all (a service account, an outsider).
 */
export type Who = { code: string | null; jobs: string[]; staff: 'current' | 'left' | 'none' }

export async function whoIs(base: Documents, persons: string[], on: string): Promise<Map<string, Who>> {
  const wanted = [...new Set(persons.filter(Boolean))]
  const found = new Map<string, Who>(wanted.map(person => [person, { code: null, jobs: [], staff: 'none' }]))
  if (!wanted.length) return found
  const employees = (await all(base, 'Employee', ['employee_code', 'person', EMPLOYEE_STATUS], [['person', 'in', wanted]]))
    .sort((a, b) => exact(a.employee_code).localeCompare(exact(b.employee_code)))
  const current = employees.filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  const jobs = current.length ? (await all(base, 'Job Assignment', ['employee', 'job', 'site', 'starts_on', 'ends_on'], [['employee', 'in', current.map(row => exact(row.row_id))]])).filter(row => holdsOn(row, on) && exact(row.job)) : []
  const siteIds = [...new Set(jobs.map(row => exact(row.site)).filter(Boolean))]
  const sites = new Map(siteIds.length ? (await all(base, 'Site', ['name'], [['row_id', 'in', siteIds]])).map(row => [exact(row.row_id), text(row.name)]) : [])
  for (const person of wanted) {
    const mine = current.filter(row => exact(row.person) === person)
    const left = employees.find(row => exact(row.person) === person && text(row[EMPLOYEE_STATUS]) === 'Left')
    if (mine.length) {
      const held = jobs.filter(row => mine.some(employee => exact(employee.row_id) === exact(row.employee)))
        .map(row => (sites.get(exact(row.site)) ? `${exact(row.job)} · ${sites.get(exact(row.site))}` : exact(row.job)))
      found.set(person, { code: nullable(mine[0].employee_code), jobs: [...new Set(held)].sort(), staff: 'current' })
    } else if (left) found.set(person, { code: nullable(left.employee_code), jobs: [], staff: 'left' })
  }
  return found
}

const SEARCH_LIMIT = 20

/** Current staff whose name or employee code holds the text typed, for the person picker, each with who they are. */
export async function personSearch(ctx: AccessContext, on: string = istToday()) {
  const scope = await scopeOf(ctx, on)
  const typed = text((ctx.payload as { q?: unknown } | undefined)?.q)
  if (typed.length < 2) return []
  // #1217: a Team Report Manager finds only their team, by name or employee code.
  if (scope.kind === 'team') {
    const who = await whoIs(ctx.baseTables!, [...scope.team.keys()], on)
    const q = typed.toLowerCase()
    return [...scope.team].filter(([person, name]) => name.toLowerCase().includes(q) || (who.get(person)?.code ?? '').toLowerCase().includes(q))
      .map(([person, name]) => ({ person, name, ...who.get(person)! }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.code ?? '').localeCompare(b.code ?? ''))
  }
  // The first twenty by name, and everyone sharing the twentieth's name: the platform orders by one
  // column, so ties at the cut are settled here, by code, rather than by however the database returns them.
  const matching = async (column: string) => {
    const filters: [string, string, unknown][] = [[column, 'like', `%${typed}%`], [EMPLOYEE_STATUS, '=', 'Current']]
    const first = await ctx.baseTables!.list('Employee', { fields: ['name', 'person', EMPLOYEE_STATUS], filters, order_by: 'name asc', limit_page_length: SEARCH_LIMIT })
    if (first.length < SEARCH_LIMIT) return first
    const last = exact(first.at(-1)!.name)
    return [...first.filter(row => exact(row.name) !== last), ...await all(ctx.baseTables!, 'Employee', ['name', 'person', EMPLOYEE_STATUS], [...filters, ['name', '=', last]])]
  }
  const names = new Map<string, string>()
  for (const row of [...await matching('name'), ...await matching('employee_code')])
    if (exact(row.person) && !names.has(exact(row.person))) names.set(exact(row.person), text(row.name))
  const who = await whoIs(ctx.baseTables!, [...names.keys()], on)
  return [...names].map(([person, name]) => ({ person, name, ...who.get(person)! }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.code ?? '').localeCompare(b.code ?? ''))
    .slice(0, SEARCH_LIMIT)
}

/** What their job reaches today: any store at all, and a whole store. */
export type Reach = { any: boolean; wholeStore: boolean }

/** Why a given report still won't open for them, or null when it opens. A grant never widens which stores a person sees. */
function closedBecause(report: { noFilter: boolean; wholeStores: boolean } | undefined, reach: Reach): string | null {
  if (!report || report.noFilter) return null
  if (!reach.any) return 'Given, but their job reaches no store'
  if (report.wholeStores && !reach.wholeStore) return 'Given, but it covers whole stores and their job reaches part of a store'
  return null
}

/** What one person sees, and why. `reaches` says what they reach today, by their jobs and the roles they hold. */
export async function personLookup(ctx: AccessContext, on: string, reaches: (person: string, roles: readonly string[]) => Promise<Reach>) {
  const scope = await scopeOf(ctx, on)
  const person = exact((ctx.payload as { person?: unknown } | undefined)?.person)
  if (!person) ctx.reject!('Choose a person')
  if (scope.kind === 'team' && !scope.team.has(person)) ctx.reject!(NOT_IN_TEAM)
  const named = await names(ctx)
  const roles = (await ctx.people!.rolesOf?.(person)) ?? []
  const given = await reportsGivenTo(ctx.baseTables!, person, roles, on)
  const reach = await reaches(person, roles)
  const name = (await personNames(ctx, [person])).get(person) ?? 'This person'
  const reports = [...given].map(([key, because]) => {
    const report = named.reports.get(key)
    return { key, name: report?.name ?? 'A report no longer listed', because: because.map(b => becauseLine(b, id => named.bundles.get(id) ?? 'a bundle')),
      closed: closedBecause(report, reach) }
  }).filter(report => named.reports.has(report.key)).sort((a, b) => a.name.localeCompare(b.name))
  return { name, reports }
}

/** The one thing a row gives and the one receiver, or a plain refusal. */
export function accessKey(row: { report?: unknown; report_bundle?: unknown; person?: unknown; role?: unknown; job?: unknown }): { key: string } | { problem: string } {
  const gives = (['report', 'report_bundle'] as const).filter(column => exact(row[column]))
  const to = (['person', 'role', 'job'] as const).filter(column => exact(row[column]))
  if (gives.length !== 1) return { problem: 'Give exactly one report or one bundle' }
  if (to.length !== 1) return { problem: 'Give it to exactly one person, one role or one job' }
  return { key: `${gives[0]}:${exact(row[gives[0]])}/${to[0]}:${exact(row[to[0]])}` }
}

/** Give a report or a bundle to a person, a role or a job. */
export async function giveReport(ctx: AccessContext, on: string = istToday()) {
  const scope = await scopeOf(ctx, on)
  const payload = (ctx.payload ?? {}) as Record<string, unknown>
  const values = Object.fromEntries((['report', 'report_bundle', 'person', 'role', 'job'] as const).map(column => [column, nullable(payload[column])]))
  const checked = accessKey(values)
  if ('problem' in checked) ctx.reject!(checked.problem)
  const key = (checked as { key: string }).key
  if (scope.kind === 'team') {
    await teamMayGive(ctx, scope, values)
    // Their own Table read shows only rows they made; the app's read shows every live grant.
    if ((await grants(ctx.baseTables!)).rows.some(row => { const live = accessKey(row); return 'key' in live && live.key === key })) ctx.reject!('That is already given')
  } else {
    const existing = await ctx.documents!.list(ACCESS, { fields: ['row_id'], filters: [['access_key', '=', key]], limit_page_length: 1 })
    if (existing.length) ctx.reject!('That is already given')
  }
  // The giver's name as the platform knows it: a Report Access Manager can't read other people, nor need be on the staff list.
  const saved = await checkedSave({ user: ctx.user, key }, () => ctx.documents!.create!(ACCESS, { ...values, given_by_name: text(ctx.userName) || null }))
  return { id: exact(saved.row_id) }
}

/** A Team Report Manager gives a report or a bundle they can open to a person in their team, and nothing else. */
async function teamMayGive(ctx: AccessContext, scope: Extract<Scope, { kind: 'team' }>, values: Record<string, string | null>) {
  if (!values.person) ctx.reject!('You can give a report only to a person in your team')
  if (values.person === ctx.user) ctx.reject!('You can’t give a report to yourself')
  if (!scope.team.has(values.person!)) ctx.reject!(NOT_IN_TEAM)
  if (values.report && !scope.holds.has(values.report)) ctx.reject!(NOT_HELD)
  if (values.report_bundle) {
    const members = (await grants(ctx.baseTables!)).members
    if (!givableBundles([values.report_bundle], members, scope.holds).has(values.report_bundle)) ctx.reject!(NOT_HELD)
  }
}

/** The row the payload names, as the page loaded it: its id and the updated_at it saw. */
function named(ctx: AccessContext, what: string): { id: string; updatedAt: string } {
  const { id, updated_at: updatedAt } = (ctx.payload ?? {}) as { id?: unknown; updated_at?: unknown }
  if (typeof id !== 'string' || !id || typeof updatedAt !== 'string' || !updatedAt) ctx.reject!(`Choose ${what}`)
  return { id: id as string, updatedAt: updatedAt as string }
}

/**
 * Take one row away by marking it removed, not deleting it: its history then says who removed it
 * and when, and a later give of the same thing makes a new row. The page's updated_at guards
 * against removing a row someone changed since.
 */
async function markRemoved(ctx: AccessContext, table: string, what: string) {
  managerOnly(ctx)
  const { id, updatedAt } = named(ctx, what)
  await ctx.documents!.update!(table, { row_id: id, removed: true, updated_at: updatedAt })
  return { removed: id }
}

/**
 * Take one access row away. A Team Report Manager takes away only a live grant they gave to
 * someone in their team (#1217).
 */
export async function removeAccess(ctx: AccessContext, on: string = istToday()) {
  const scope = await scopeOf(ctx, on)
  if (scope.kind === 'company') return markRemoved(ctx, ACCESS, 'what to remove')
  const { id, updatedAt } = named(ctx, 'what to remove')
  const [row] = await all(ctx.baseTables!, ACCESS, ['person', 'created_by', 'removed'], [['row_id', '=', id]])
  if (!row || ticked(row.removed) || exact(row.created_by) !== ctx.user || !scope.team.has(exact(row.person)))
    ctx.reject!('You can take away only what you gave someone in your team')
  await checkedSave({ user: ctx.user, row: id }, () => ctx.documents!.update!(ACCESS, { row_id: id, removed: true, updated_at: updatedAt }))
  return { removed: id }
}

/** Take a report out of a bundle. */
export const removeFromBundle = (ctx: AccessContext) => markRemoved(ctx, MEMBER, 'a report to take out')

/** Make a bundle, by name. */
export async function makeBundle(ctx: AccessContext) {
  managerOnly(ctx)
  const name = text((ctx.payload as { name?: unknown } | undefined)?.name)
  if (!name) ctx.reject!('Name the bundle')
  if ((await ctx.documents!.list(BUNDLE, { fields: ['row_id'], filters: [['bundle_name', '=', name]], limit_page_length: 1 })).length) ctx.reject!('There is already a bundle with that name')
  const saved = await ctx.documents!.create!(BUNDLE, { bundle_name: name })
  return { id: exact(saved.row_id) }
}

/** Put a report into a bundle. */
export async function addToBundle(ctx: AccessContext) {
  managerOnly(ctx)
  const { bundle, report } = (ctx.payload ?? {}) as { bundle?: unknown; report?: unknown }
  if (!exact(bundle) || !exact(report)) ctx.reject!('Choose a bundle and a report')
  if ((await ctx.documents!.list(MEMBER, { fields: ['row_id'], filters: [['member_key', '=', `${exact(bundle)}/${exact(report)}`]], limit_page_length: 1 })).length) ctx.reject!('That report is already in the bundle')
  const saved = await ctx.documents!.create!(MEMBER, { report_bundle: exact(bundle), report: exact(report) })
  return { id: exact(saved.row_id) }
}

/** Save rules for the access Tables: one thing to one receiver, and keys that refuse duplicates. */
const GIVES = ['report', 'report_bundle', 'person', 'role', 'job'] as const

/**
 * #1217: a writer who doesn't manage access company-wide (a Team Report Manager) saves an access
 * row only as the one save Dash's give or remove action checked for them: a new row with the key
 * it checked, or the row it checked marked removed and otherwise unchanged. Their Table permission
 * alone, through the platform's Table API, saves nothing.
 */
function checkedSaveOf(context: { row: Row; old?: Row; user: string; isNew: boolean }, key: string): boolean {
  const ticket = checkedFor()
  if (!ticket || ticket.user !== context.user) return false
  if (context.isNew) return ticket.key === key && !ticked(context.row.removed)
  const old = context.old
  return !!old && ticket.row === exact(context.row.row_id) && ticket.row === exact(old.row_id) && ticked(context.row.removed) && !ticked(old.removed)
    && GIVES.every(column => exact(context.row[column]) === exact(old[column]))
}

export const validators = {
  /**
   * #1169: a Dive opens through one report only, on every save, the generic save path included.
   * A Report Access Manager may create reports; without this they could register a Dive Dash
   * already narrows to a reader's stores a second time, as a report taking no filter, and give
   * every store's figures to anyone.
   */
  async [REPORT](context: { row: Row; documents?: Pick<Documents, 'list'>; reject(message: string, fields?: Record<string, string>): never }) {
    context.row.dive_id = exact(context.row.dive_id).trim()
    const dive = exact(context.row.dive_id).toLowerCase()
    if (!dive || !context.documents) return
    const other = (await reportRows(context.documents)).find(report => report.dive === dive && report.key !== exact(context.row.report_key))
    if (other) context.reject(`That Dive is already in Dash as ${other.name}`, { dive_id: `Already in Dash as ${other.name}` })
  },
  [ACCESS](context: { row: Row; old?: Row; user: string; roles?: readonly string[]; isNew: boolean; reject(message: string, fields?: Record<string, string>): never }) {
    for (const column of GIVES) if (exact(context.row[column]).trim() === '') context.row[column] = null
    const checked = accessKey(context.row)
    if ('problem' in checked) context.reject(checked.problem)
    const key = (checked as { key: string }).key
    const company = context.user === 'Administrator' || (context.roles ?? []).some(role => role === ACCESS_MANAGER || role === 'System Manager')
    if (!company && !checkedSaveOf(context, key)) context.reject('Give and take away reports on the Report access page')
    // A removed row keeps no key, so the same thing can be given again as a new row.
    context.row.access_key = ticked(context.row.removed) ? null : key
  },
  [MEMBER](context: { row: Row; reject(message: string, fields?: Record<string, string>): never }) {
    if (!exact(context.row.report_bundle) || !exact(context.row.report)) context.reject('A bundle member names a bundle and a report')
    context.row.member_key = ticked(context.row.removed) ? null : `${exact(context.row.report_bundle)}/${exact(context.row.report)}`
  },
}

/**
 * #1173: what the platform's Waiting for access drawer offers for one person: their current job,
 * site and section, the people in the same job (for the platform's role hints), and every bundle
 * and report, each marked when it already reaches them. Giving one is `give_report` with the
 * choice's payload plus the person. Managers only, like the Report access page.
 */
export async function grantOptions(ctx: AccessContext, on: string) {
  managerOnly(ctx)
  const person = exact((ctx.payload as { person?: unknown } | undefined)?.person)
  if (!person) ctx.reject!('Choose a person')
  const base = ctx.baseTables!
  const employees = (await all(base, 'Employee', [EMPLOYEE_STATUS], [['person', '=', person]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  const held = employees.length
    ? (await all(base, 'Job Assignment', ['job', 'site', 'section', 'starts_on', 'ends_on'], [['employee', 'in', employees.map(row => exact(row.row_id))]])).filter(row => holdsOn(row, on))
    : []
  const jobs = [...new Set(held.map(row => exact(row.job)).filter(Boolean))].sort()
  const nameOf = async (table: string, ids: string[]) => {
    const wanted = [...new Set(ids.filter(Boolean))]
    if (!wanted.length) return []
    const rows = await all(base, table, ['name'], [['row_id', 'in', wanted]])
    return wanted.map(id => text(rows.find(row => exact(row.row_id) === id)?.name) || id)
  }
  const about = [
    { label: 'Job', value: jobs.join(', ') },
    { label: 'Site', value: (await nameOf('Site', held.map(row => exact(row.site)))).join(', ') },
    { label: 'Section', value: (await nameOf('Section', held.map(row => exact(row.section)))).join(', ') },
  ].filter(line => line.value)
  // Store reports reach people through their job: say plainly when there is none to go by.
  if (!employees.length) about.push({ label: 'Staff list', value: 'Not a current employee, so store reports won’t open' })
  // Everyone else holding one of those jobs today.
  const peers = new Set<string>()
  if (jobs.length) {
    const same = (await all(base, 'Job Assignment', ['employee', 'starts_on', 'ends_on'], [['job', 'in', jobs]])).filter(row => holdsOn(row, on))
    const ids = [...new Set(same.map(row => exact(row.employee)))]
    if (ids.length)
      for (const row of await all(base, 'Employee', ['person', EMPLOYEE_STATUS], [['row_id', 'in', ids]]))
        if (text(row[EMPLOYEE_STATUS]) === 'Current' && exact(row.person) && exact(row.person) !== person) peers.add(exact(row.person))
  }
  const roles = (await ctx.people!.rolesOf?.(person)) ?? []
  const reaching = await reportsGivenTo(base, person, roles, on)
  const { rows } = await grants(base)
  const bundleReaches = (bundle: string) => rows.some(row => row.report_bundle === bundle
    && (row.person === person || (row.role !== null && roles.includes(row.role)) || (row.job !== null && jobs.includes(row.job))))
  const named = await names(ctx)
  const choices = [
    ...[...named.bundles].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id: `bundle:${id}`, label: name, group: 'Bundle', given: bundleReaches(id), payload: { report_bundle: id } })),
    ...[...named.reports].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, report]) => ({ id: `report:${key}`, label: report.name, group: 'Report', given: reaching.has(key), payload: { report: key } })),
  ]
  return { about, peers: [...peers].sort(), choices }
}

/** Every Dash report: its key, its name and the Dive it opens (ids compared trimmed, in lower case). */
async function reportRows(documents: Pick<Documents, 'list'>): Promise<{ key: string; name: string; dive: string }[]> {
  const rows = await documents.list('dash.report', { fields: ['report_key', 'report_name', 'dive_id'], limit_page_length: 1000 })
  return rows.map(row => ({ key: exact(row.report_key), name: text(row.report_name), dive: exact(row.dive_id).trim().toLowerCase() }))
}

/** What `dive_choices` reads in its transaction: whether the caller manages access, and which Dives are in Dash. */
export async function diveChoicesPrepared(ctx: AccessContext) {
  if (!managesAccess(ctx)) return { manager: false, inDash: [] as [string, string][] }
  return { manager: true, inDash: (await reportRows(ctx.documents!)).map(report => [report.dive, report.name] as [string, string]) }
}

/**
 * The organisation's Dives for the Add a Dive card (#1169), read live from MotherDuck, each marked
 * with the report that already opens it. Managers only. MotherDuck out of reach is said, never an
 * empty list.
 */
export async function diveChoices(ctx: AccessContext & { datasets?: { live(name: string): Promise<{ rows: unknown[] }> } },
  prepared: Awaited<ReturnType<typeof diveChoicesPrepared>> | undefined) {
  if (!prepared?.manager) ctx.reject!('Only a Report Access Manager or a System Manager can add reports')
  const inDash = new Map(prepared!.inDash)
  let rows: unknown[]
  try {
    rows = (await ctx.datasets!.live(DIVES_DATASET)).rows
  } catch (error) {
    // The cause, so a wrong query can be told from an outage; anything shaped like a token is cut out.
    const message = String((error as Error)?.message ?? error).replace(/(token|password)\S*/gi, '$1=…').slice(0, 300)
    console.error(JSON.stringify({ event: 'dash_dive_list_failed', person: ctx.user, message }))
    return { unreachable: true as const }
  }
  const dives: DiveChoice[] = (rows as Row[]).map(row => ({ dive_id: exact(row.dive_id).toLowerCase(), title: text(row.title) || 'Untitled Dive',
    owner: text(row.owner_name), saved_on: nullable(row.saved_on), in_dash: inDash.get(exact(row.dive_id).toLowerCase()) ?? null }))
  return { dives }
}

/** The dataset of the organisation's Dives (featherbase.json's `datasets`). */
export const DIVES_DATASET = 'organisation_dives'

/**
 * Add a Dive to Dash as a report taking no filter (#1169): whoever it is given to sees everything
 * the Dive shows. A Dive that filters by store still needs a System Manager in Admin.
 */
export async function addReport(ctx: AccessContext) {
  managerOnly(ctx)
  const payload = (ctx.payload ?? {}) as { dive_id?: unknown; name?: unknown }
  const dive = diveIdIn(exact(payload.dive_id))
  if (!dive || dive !== exact(payload.dive_id).trim().toLowerCase()) ctx.reject!('Choose a Dive')
  const name = text(payload.name).replace(/\s+/g, ' ')
  if (!name) ctx.reject!('Name the report')
  const reports = await reportRows(ctx.documents!)
  const already = reports.find(report => report.dive === dive)
  if (already) ctx.reject!(`That Dive is already in Dash as ${already.name}`)
  const sameName = reports.find(report => report.name.toLowerCase() === name.toLowerCase())
  if (sameName) ctx.reject!(`Another report is called ${sameName.name}`)
  const key = reportKeyFor(name, reports.map(report => report.key))
  await ctx.documents!.create!('dash.report', { report_key: key, report_name: name, dive_id: dive, filter_shape: 'No filter' })
  return { key, name }
}
