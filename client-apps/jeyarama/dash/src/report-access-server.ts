// Report access (#1046) on the server: who has been given which report, read fresh on every
// request, and the Report access page's reads and actions. The access Tables are read as the
// app (`baseTables`), so an ordinary reader needs no grant on them and can't list them; the
// page writes as the signed-in person, through the platform's save path, so every change runs
// the save rules and lands in version history.
import { reportsReaching, type AccessRow, type Because, type BundleMember } from './report-access.ts'
import { EMPLOYEE_STATUS, exact, holdsOn, text } from './values.ts'
import type { Documents } from './provider.ts'

type Row = Record<string, unknown>

/** The role that manages report access. System Managers manage it too. */
export const ACCESS_MANAGER = 'Report Access Manager'
export const ACCESS = 'dash.report_access'
export const BUNDLE = 'dash.report_bundle'
export const MEMBER = 'dash.report_bundle_member'

/** What these reads and actions use of the platform's context. */
export interface AccessContext {
  user: string
  roles?: readonly string[]
  payload?: unknown
  baseTables?: Documents
  documents?: Documents & {
    create?(table: string, values: Row): Promise<Row>
    delete?(table: string, id: string, updatedAt: string): Promise<void>
  }
  people?: {
    names(ids: string[]): Promise<Record<string, string | null>>
    rolesOf?(person: string): Promise<readonly string[]>
    roleNames?(): Promise<readonly string[]>
    waitingForAccess?(): Promise<readonly { person: string; asked_at: string }[]>
  }
  reject?(message: string): never
}

const PAGE = 500
async function all(documents: Documents, table: string, fields: string[], filters: [string, string, unknown][] = []): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { fields: ['row_id', ...fields], filters, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const nullable = (value: unknown) => (exact(value) === '' ? null : exact(value))

/** The jobs `person` holds today, from their current Employee rows' job assignments. */
export async function jobsOf(base: Documents, person: string, on: string): Promise<string[]> {
  const employees = (await all(base, 'Employee', [EMPLOYEE_STATUS], [['person', '=', person]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  if (!employees.length) return []
  const jobs = await all(base, 'Job Assignment', ['job', 'starts_on', 'ends_on'], [['employee', 'in', employees.map(row => exact(row.row_id))]])
  return [...new Set(jobs.filter(row => holdsOn(row, on)).map(row => exact(row.job)).filter(Boolean))].sort()
}

/** Every access row and bundle member, as the app reads them. */
async function grants(base: Documents): Promise<{ rows: (AccessRow & { row_id: string })[]; members: BundleMember[] }> {
  const rows = (await all(base, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job'])).map(row => ({
    row_id: exact(row.row_id), report: nullable(row.report), report_bundle: nullable(row.report_bundle),
    person: nullable(row.person), role: nullable(row.role), job: nullable(row.job),
  }))
  const members = (await all(base, MEMBER, ['report_bundle', 'report'])).map(row => ({ report_bundle: exact(row.report_bundle), report: exact(row.report) }))
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

/** Does the caller manage report access? */
export const managesAccess = (ctx: AccessContext) => (ctx.roles ?? []).some(role => role === ACCESS_MANAGER || role === 'System Manager')

function managerOnly(ctx: AccessContext): void {
  if (!managesAccess(ctx)) ctx.reject!('Only a Report Access Manager or a System Manager can see or change who has which report')
}

/** A bundle id to its name, and a report key to its name. */
async function names(ctx: AccessContext) {
  const reports = await ctx.documents!.list('dash.report', { fields: ['report_key', 'report_name', 'filter_shape'], order_by: 'report_name asc', limit_page_length: 200 })
  const bundles = await all(ctx.baseTables!, BUNDLE, ['bundle_name'])
  return {
    reports: new Map(reports.map(row => [exact(row.report_key), { name: text(row.report_name), noFilter: exact(row.filter_shape) === 'No filter' }])),
    bundles: new Map(bundles.map(row => [exact(row.row_id), text(row.bundle_name)])),
  }
}

/** A person's name as the caller may read it, falling back to their name on the staff list. */
async function personNames(ctx: AccessContext, ids: string[]): Promise<Map<string, string>> {
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
export type To = { kind: 'Person' | 'Role' | 'Job'; name: string }

/** The Report access page: who has what, what can be given, and who is waiting. Managers only. */
export async function accessPage(ctx: AccessContext) {
  managerOnly(ctx)
  const named = await names(ctx)
  const access = await all(ctx.baseTables!, ACCESS, ['report', 'report_bundle', 'person', 'role', 'job', 'updated_at', 'updated_by'])
  const members = await all(ctx.baseTables!, MEMBER, ['report_bundle', 'report'])
  const jobs = await all(ctx.baseTables!, 'Job Assignment', ['job'])
  const waiting = (await ctx.people!.waitingForAccess?.()) ?? []
  const people = await personNames(ctx, [...access.map(row => exact(row.person)), ...access.map(row => exact(row.updated_by)), ...waiting.map(w => w.person)])
  const rows = access.map(row => {
    const gives: Gives | null = nullable(row.report) ? { kind: 'Report', name: named.reports.get(exact(row.report))?.name ?? 'A report no longer listed' }
      : nullable(row.report_bundle) ? { kind: 'Bundle', name: named.bundles.get(exact(row.report_bundle)) ?? 'A bundle no longer listed' } : null
    const to: To | null = nullable(row.person) ? { kind: 'Person', name: people.get(exact(row.person)) ?? 'Someone you can’t see' }
      : nullable(row.role) ? { kind: 'Role', name: exact(row.role) } : nullable(row.job) ? { kind: 'Job', name: exact(row.job) } : null
    return { id: exact(row.row_id), updated_at: exact(row.updated_at), gives, to, given_by: people.get(exact(row.updated_by)) ?? (exact(row.updated_by) === 'Administrator' ? 'Administrator' : 'Someone'),
      given_on: exact(row.updated_at).slice(0, 10) }
  }).filter(row => row.gives && row.to)
    .sort((a, b) => a.gives!.name.localeCompare(b.gives!.name) || a.to!.name.localeCompare(b.to!.name))
  return {
    reports: [...named.reports].map(([key, report]) => ({ key, name: report.name })),
    bundles: [...named.bundles].map(([id, name]) => ({ id, name,
      reports: members.filter(m => exact(m.report_bundle) === id).map(m => named.reports.get(exact(m.report))?.name).filter((n): n is string => !!n).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: [...((await ctx.people!.roleNames?.()) ?? [])],
    jobs: [...new Set(jobs.map(row => exact(row.job)).filter(Boolean))].sort(),
    rows,
    waiting: waiting.map(w => ({ person: w.person, name: people.get(w.person) ?? 'Someone', asked_on: w.asked_at.slice(0, 10) })),
  }
}

/** People on the staff list whose name holds the text typed, for the Give bar's person picker. */
export async function personSearch(ctx: AccessContext) {
  managerOnly(ctx)
  const typed = text((ctx.payload as { q?: unknown } | undefined)?.q)
  if (typed.length < 2) return []
  const rows = await ctx.baseTables!.list('Employee', { fields: ['name', 'person', EMPLOYEE_STATUS], filters: [['name', 'like', `%${typed}%`], [EMPLOYEE_STATUS, '=', 'Current']], order_by: 'name asc', limit_page_length: 20 })
  const seen = new Set<string>()
  return rows.filter(row => exact(row.person) && !seen.has(exact(row.person)) && seen.add(exact(row.person))).map(row => ({ person: exact(row.person), name: text(row.name) }))
}

/** What one person sees, and why. `reaches` says whether their job reaches any store today. */
export async function personLookup(ctx: AccessContext, on: string, reaches: (person: string) => Promise<boolean>) {
  managerOnly(ctx)
  const person = exact((ctx.payload as { person?: unknown } | undefined)?.person)
  if (!person) ctx.reject!('Choose a person')
  const named = await names(ctx)
  const roles = (await ctx.people!.rolesOf?.(person)) ?? []
  const given = await reportsGivenTo(ctx.baseTables!, person, roles, on)
  const reachesStore = await reaches(person)
  const name = (await personNames(ctx, [person])).get(person) ?? 'This person'
  const reports = [...given].map(([key, because]) => {
    const report = named.reports.get(key)
    return { key, name: report?.name ?? 'A report no longer listed', because: because.map(b => becauseLine(b, id => named.bundles.get(id) ?? 'a bundle')),
      closed: !reachesStore && !report?.noFilter ? 'Given, but their job reaches no store' : null }
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
export async function giveReport(ctx: AccessContext) {
  managerOnly(ctx)
  const payload = (ctx.payload ?? {}) as Record<string, unknown>
  const values = Object.fromEntries((['report', 'report_bundle', 'person', 'role', 'job'] as const).map(column => [column, nullable(payload[column])]))
  const checked = accessKey(values)
  if ('problem' in checked) ctx.reject!(checked.problem)
  const existing = await ctx.documents!.list(ACCESS, { fields: ['row_id'], filters: [['access_key', '=', (checked as { key: string }).key]], limit_page_length: 1 })
  if (existing.length) ctx.reject!('That is already given')
  const saved = await ctx.documents!.create!(ACCESS, values)
  return { id: exact(saved.row_id) }
}

/** Take one access row away. */
export async function removeAccess(ctx: AccessContext) {
  managerOnly(ctx)
  const { id, updated_at: updatedAt } = (ctx.payload ?? {}) as { id?: unknown; updated_at?: unknown }
  if (typeof id !== 'string' || !id || typeof updatedAt !== 'string') ctx.reject!('Choose what to remove')
  await ctx.documents!.delete!(ACCESS, id as string, updatedAt as string)
  return { removed: id }
}

/** Save rules for the access Tables: one thing to one receiver, and keys that refuse duplicates. */
export const validators = {
  [ACCESS](context: { row: Row; reject(message: string, fields?: Record<string, string>): never }) {
    for (const column of ['report', 'report_bundle', 'person', 'role', 'job']) if (exact(context.row[column]).trim() === '') context.row[column] = null
    const checked = accessKey(context.row)
    if ('problem' in checked) context.reject(checked.problem)
    context.row.access_key = (checked as { key: string }).key
  },
  [MEMBER](context: { row: Row; reject(message: string, fields?: Record<string, string>): never }) {
    if (!exact(context.row.report_bundle) || !exact(context.row.report)) context.reject('A bundle member names a bundle and a report')
    context.row.member_key = `${exact(context.row.report_bundle)}/${exact(context.row.report)}`
  },
}
