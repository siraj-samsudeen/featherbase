// Who the signed-in person is on the live org chart (#1438), so each manager's page opens for them: their Person →
// their current Employee rows (Employee.person, as Dash's own pages match it) → today's top-of-chain jobs. Store
// Managers and category heads are matched on the page against the chain's people by the same Employee ids; nobody
// is ever matched by name (two employees share one). Read with the app's own access (baseTables.read).

type Row = Record<string, unknown>
interface BaseTables {
  list(table: string, args: { fields: string[]; filters?: [string, string, unknown][]; limit_start?: number; limit_page_length?: number; order_by?: string }): Promise<Row[]>
  available?(table: string, columns?: string[]): Promise<boolean>
}

/** The org chart's jobs that review the whole chain as its Chief Executive (RB Review). The Job choices hold no
 *  "Chief Executive": these are the all-store head-office jobs, the same three Dash gives every store (coverage.ts). */
export const CHIEF_EXECUTIVE_JOBS = ['Managing Director', 'Director', 'Chief Operating Officer']

/** Someone holding a Chief Executive job today: their Employee row, their name, and the job as the org chart says it. */
export interface Chief { id: string; name: string; job: string }
export interface SignedIn {
  /** A System Manager or the Administrator: may view any manager's page as someone else (?as=<Employee id>). */
  admin: boolean
  /** Whether this instance has the org chart to find anyone on (the made-up one has not). */
  orgChart: boolean
  /** The signed-in person's current Employee rows (one person can have one per region). */
  employees: string[]
  /** Today's Chief Executive jobs: the signed-in person's own, or for an administrator everyone's. */
  chiefs: Chief[]
}

const day = (v: unknown) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v == null ? '' : String(v))
  return m ? m[1] : null
}
/** A Job Assignment applies on `today`, its Ends On being its last day. */
const throughEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! >= today)

async function all(base: BaseTables, table: string, fields: string[], filters: [string, string, unknown][]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await base.list(table, { fields, filters, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: 500 })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

export const isAdmin = (user: string, roles: string[]) => user === 'Administrator' || roles.includes('System Manager')

export async function signedIn(base: BaseTables | undefined, user: string, roles: string[], today: string): Promise<SignedIn> {
  const admin = isAdmin(user, roles)
  // an instance without the org chart (the made-up one) knows no one: an administrator still views any page
  if (!base || !(await (base.available?.('Employee', ['person', 'status']) ?? Promise.resolve(true)))) return { admin, orgChart: false, employees: [], chiefs: [] }
  // one read at a time: the platform refuses a handler's base Table reads awaited together
  const mine = await all(base, 'Employee', ['row_id', 'name'], [['person', '=', user], ['status', '=', 'Current']])
  const employees = mine.map(e => String(e.row_id))
  if (!admin && !employees.length) return { admin, orgChart: true, employees, chiefs: [] }
  const jobs = (await all(base, 'Job Assignment', ['employee', 'job', 'starts_on', 'ends_on'],
    [['job', 'in', CHIEF_EXECUTIVE_JOBS], ...(admin ? [] : [['employee', 'in', employees] as [string, string, unknown]])])).filter(j => throughEnd(j, today) && j.employee)
  const ids = [...new Set(jobs.map(j => String(j.employee)))]
  // a Chief Executive job held by someone who has left is not today's
  const names = new Map((ids.length ? await all(base, 'Employee', ['row_id', 'name'], [['row_id', 'in', ids], ['status', '=', 'Current']]) : [])
    .map(e => [String(e.row_id), String(e.name ?? e.row_id)]))
  const chiefs: Chief[] = []
  for (const j of jobs) {
    const id = String(j.employee)
    if (names.has(id) && !chiefs.some(c => c.id === id)) chiefs.push({ id, name: names.get(id)!, job: String(j.job) })
  }
  // the Managing Director first, then by Employee row, so the page opens on the same person every load
  chiefs.sort((a, b) => CHIEF_EXECUTIVE_JOBS.indexOf(a.job) - CHIEF_EXECUTIVE_JOBS.indexOf(b.job) || a.id.localeCompare(b.id))
  return { admin, orgChart: true, employees, chiefs }
}

/** One job the signed-in person holds today, as a reviewer of the Run's lines: the role a page names, and where
 *  ("LKS · Girls" for a Team Leader, the site for a Store Manager, the region(s) for a category head, every store for
 *  the Chief Executive). */
export interface LiveJob { role: 'Team Leader' | 'Store Manager' | 'Department Manager' | 'Category Head' | 'Chief Executive'; area: string }
/** The signed-in person on the live org chart (#1430): their name(s) and Employee rows, from their Person, and every
 *  job they hold today. Null where the instance has no org chart (the made-up one). */
export interface LivePerson { names: string[]; employees: string[]; jobs: LiveJob[] }

/** A Merchandise Assignment applies on `today`, its Ends On being the first day it no longer applies. */
const beforeEnd = (r: Row, today: string) => (!day(r.starts_on) || day(r.starts_on)! <= today) && (!day(r.ends_on) || day(r.ends_on)! > today)

export async function livePerson(base: BaseTables | undefined, user: string, today: string): Promise<LivePerson | null> {
  if (!base) return null
  for (const [table, columns] of [['Employee', ['person', 'status']], ['Job Assignment', undefined]] as const)
    if (!(await (base.available?.(table, columns as string[] | undefined) ?? Promise.resolve(true)))) return null
  const mine = await all(base, 'Employee', ['row_id', 'name'], [['person', '=', user], ['status', '=', 'Current']])
  const employees = mine.map(e => String(e.row_id)), names = [...new Set(mine.map(e => String(e.name ?? '')).filter(Boolean))]
  if (!employees.length) return { names, employees, jobs: [] }
  const held = (await all(base, 'Job Assignment', ['employee', 'job', 'site', 'section', 'starts_on', 'ends_on'], [['employee', 'in', employees]])).filter(j => throughEnd(j, today))
  const sectionIds = [...new Set(held.filter(j => j.job === 'Team Leader' && j.section).map(j => String(j.section)))]
  const sectionName = new Map((sectionIds.length ? await all(base, 'Section', ['row_id', 'name', 'status'], [['row_id', 'in', sectionIds]]) : [])
    .filter(s => String(s.status ?? 'Active') !== 'Closed').map(s => [String(s.row_id), String(s.name)]))
  const jobs: LiveJob[] = []
  for (const j of held) {
    if (j.job === 'Team Leader' && j.section && sectionName.has(String(j.section))) jobs.push({ role: 'Team Leader', area: `${String(j.site)} · ${sectionName.get(String(j.section))}` })
    else if (j.job === 'Store Manager' || j.job === 'Department Manager') jobs.push({ role: j.job, area: String(j.site) })
    else if (CHIEF_EXECUTIVE_JOBS.includes(String(j.job))) jobs.push({ role: 'Chief Executive', area: 'every store' })
  }
  if (await (base.available?.('Merchandise Assignment') ?? Promise.resolve(true))) {
    const heads = (await all(base, 'Merchandise Assignment', ['employee', 'responsibility', 'operating_region', 'starts_on', 'ends_on'],
      [['employee', 'in', employees], ['responsibility', '=', 'Category head']])).filter(m => beforeEnd(m, today))
    if (heads.length) jobs.push({ role: 'Category Head', area: [...new Set(heads.map(m => String(m.operating_region ?? '')).filter(Boolean))].join(' and ') || 'their merchandise' })
  }
  return { names, employees, jobs }
}
