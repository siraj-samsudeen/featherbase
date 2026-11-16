// Team report giving (#1217): a Team Report Manager gives reports they can open to the people
// who report to them, and nothing else. Who is in the team is read fresh from the org chart; the
// rules themselves are applied in report-access-server.ts.
import { AsyncLocalStorage } from 'node:async_hooks'
import { EMPLOYEE_STATUS, exact, holdsOn, text } from './values.ts'
import type { Documents } from './provider.ts'

type Row = Record<string, unknown>

/** The role that gives reports to its holder's own team only. */
export const TEAM_MANAGER = 'Team Report Manager'

const PAGE = 500
async function all(documents: Documents, table: string, fields: string[], filters: [string, string, unknown][]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { fields: ['row_id', ...fields], filters, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}
const current = (row: Row) => text(row[EMPLOYEE_STATUS]) === 'Current'

/**
 * `me`'s team on `on`, person to name: everyone with a sign-in, on the staff list, one of whose
 * current Job Assignments reports to one of `me`'s current Employee records or current Job
 * Assignments. `reports_to` may hold either id. Direct reports only; never `me`.
 */
export async function teamOf(base: Documents, me: string, on: string): Promise<Map<string, string>> {
  const team = new Map<string, string>()
  const mine = (await all(base, 'Employee', ['person', EMPLOYEE_STATUS], [['person', '=', me]])).filter(current).map(row => exact(row.row_id))
  if (!mine.length) return team
  const myJobs = (await all(base, 'Job Assignment', ['starts_on', 'ends_on'], [['employee', 'in', mine]])).filter(row => holdsOn(row, on)).map(row => exact(row.row_id))
  const reporting = (await all(base, 'Job Assignment', ['employee', 'reports_to', 'starts_on', 'ends_on'], [['reports_to', 'in', [...mine, ...myJobs]]]))
    .filter(row => holdsOn(row, on))
  const employees = [...new Set(reporting.map(row => exact(row.employee)).filter(Boolean))]
  if (!employees.length) return team
  const staff = (await all(base, 'Employee', ['name', 'person', EMPLOYEE_STATUS], [['row_id', 'in', employees]]))
    .filter(row => current(row) && exact(row.person) && exact(row.person) !== me)
    .sort((a, b) => text(a.name).localeCompare(text(b.name)))
  for (const row of staff) if (!team.has(exact(row.person))) team.set(exact(row.person), text(row.name))
  return team
}

/** The bundles a Team Report Manager may give: not empty, and every report in them one they can open. */
export function givableBundles(bundles: string[], members: { report_bundle: string; report: string }[], held: ReadonlySet<string>): Set<string> {
  return new Set(bundles.filter(bundle => {
    const inside = members.filter(member => member.report_bundle === bundle)
    return inside.length > 0 && inside.every(member => held.has(member.report))
  }))
}

/**
 * A save of the access Table that Dash's own give or remove action has checked: the writer, and
 * the access key it gives or the row it takes away. Only this module's `checkedSave` sets it, and
 * only around the one save it checked, so a write through the platform's own Table API never
 * carries one.
 */
type Checked = { user: string; key?: string; row?: string }
const checked = new AsyncLocalStorage<Checked>()

/** Runs `save` as the one save the caller's checks allow. */
export const checkedSave = <T>(ticket: Checked, save: () => Promise<T>): Promise<T> => checked.run(Object.freeze({ ...ticket }), save)

/** The check this save carries, if any. */
export const checkedFor = (): Checked | undefined => checked.getStore()
