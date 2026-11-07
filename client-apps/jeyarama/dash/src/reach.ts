// Which stores a person administers (featherbase#919): the platform calls
// this fresh on every request that a grant limited to reach decides, and
// reads only the Tables featherbase.json's `administration.tables` declares,
// each marked decides_scope. The job assignments current today decide:
//  - a Store Manager administers the assignment's store;
//  - a Cluster Manager every plant whose site is in the assignment's cluster
//    (Plant.site → Site Master.cluster: a store's cluster comes from its site,
//    never typed per person);
//  - a Chief Operating Officer or Director every store (open question 1 of the
//    store-administration change).
// No job of these, or nothing they reach, is no reach at all.
import { exact, holdsOn } from './values.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
interface Documents {
  list(table: string, args?: { filters?: Filter[]; fields?: string[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
}
interface ReachContext {
  readonly person: { readonly id: string }
  readonly documents: Documents
}
export interface ReachAnswer { role: string; stores: '*' | string[] }

/** The job role a store administrator holds (featherbase.json's `administration.jobRoles`). */
export const STORE_ADMINISTRATOR = 'Dash Store Administrator'
/** The role a store administrator may give their staff. */
export const STORE_EDITOR = 'Dash Store Editor'

export type Level = 'store' | 'cluster' | 'all'
/** Each job's reach. A job not listed administers nothing. */
export const JOB_REACH: Readonly<Record<string, Level>> = {
  'Store Manager': 'store',
  'Cluster Manager': 'cluster',
  'Chief Operating Officer': 'all',
  'Director': 'all',
}

/** The instance's organisation masters, by their Table names on the instance. */
export const MASTERS = { plant: 'Plant', site: 'Site Master' } as const
const T = { jobs: 'dash.job_assignment' } as const
/** Every Table the provider may read: featherbase.json's `administration.tables`. */
export const REACH_TABLES: string[] = [T.jobs, MASTERS.plant, MASTERS.site]

const PAGE = 500
async function all(documents: Documents, table: string, filters: Filter[], fields: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

/** The plant codes of the plants whose site is in one of `clusters`. */
async function clusterStores(documents: Documents, clusters: string[]): Promise<string[]> {
  if (!clusters.length) return []
  const sites = (await all(documents, MASTERS.site, [['cluster', 'in', clusters]], ['row_id'])).map(row => exact(row.row_id))
  if (!sites.length) return []
  return (await all(documents, MASTERS.plant, [['site', 'in', sites]], ['plant_code'])).map(row => exact(row.plant_code)).filter(Boolean)
}

export interface ReachOptions {
  today?: () => string
  jobReach?: Readonly<Record<string, Level>>
}

export function storeReachProvider({ today = istToday, jobReach = JOB_REACH }: ReachOptions = {}) {
  return async function storeReach({ person, documents }: ReachContext): Promise<ReachAnswer[]> {
    const on = today()
    const jobs = (await all(documents, T.jobs, [['person', '=', person.id]], ['job', 'store', 'cluster', 'starts_on', 'ends_on']))
      .filter(row => holdsOn(row, on))
    const levels = new Map<Level, string[]>()
    for (const row of jobs) {
      const level = jobReach[exact(row.job)]
      if (level) levels.set(level, [...(levels.get(level) ?? []), exact(row[level === 'cluster' ? 'cluster' : 'store'])])
    }
    if (levels.has('all')) return [{ role: STORE_ADMINISTRATOR, stores: '*' }]
    const stores = new Set((levels.get('store') ?? []).filter(Boolean))
    for (const code of await clusterStores(documents, [...new Set((levels.get('cluster') ?? []).filter(Boolean))])) stores.add(code)
    return stores.size ? [{ role: STORE_ADMINISTRATOR, stores: [...stores].sort() }] : []
  }
}
