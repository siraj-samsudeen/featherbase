// What the pages read, each as one cached query. Rows of the instance's own tables (Plant,
// Site and the rest) come through the same generic route as the app's, under the reader's
// own grants.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import manifest from '../featherbase.json'
import { api, listAll, runRead } from './api'
import { chainOf, type Line, type Version } from './plRules'

export interface Me { row_id: string; roles: string[]; capabilities?: { admin?: boolean; manage?: boolean; tables?: string[] } }
export function me(): Me {
  try { return JSON.parse(localStorage.getItem('fc_user') ?? 'null') ?? { row_id: '', roles: [] } } catch { return { row_id: '', roles: [] } }
}
/** Only a Budget Editor is offered anything that changes a row. The server refuses a Viewer whatever is drawn. */
export const canEdit = () => me().roles.includes('Budget Editor')
/** Whether this person can open a row of one of the instance's own tables in Featherbase. */
export const canOpen = (table: string) => { const c = me().capabilities; return !!c?.manage || (!!c?.admin && !!c.tables?.includes(table)) }

type Base = { row_id: string; updated_at: string }
export interface Plant extends Base { plant_name: string | null; plant_type: string | null; site: string | null; legal_company: string | null }
export interface Site extends Base { name: string; operating_region: string | null; opened_on: string | null }
export interface Named extends Base { name: string }
export type PlLine = Line & Base & { line_key: string }
export interface Account extends Base { account_code: string; account_name: string; statement: string; pl_line: string | null; store_rule: string | null; falls_back_to_cost_centre: boolean; note: string | null }
export interface BudgetVersion extends Version, Base { version_name: string; fiscal_year: string; approved_by: string | null; based_on: string | null; source_file: string | null; note: string | null }
export interface BudgetCell extends Base { budget_version: string; plant: string; budget_month: string; pl_line: string; amount: string | number }
export interface Close extends Base { legal_company: string; close_month: string; version_no: number; downloaded_at: string; close_state: 'Open' | 'Published' | 'Replaced'; published_at: string | null; published_by: string | null; note: string | null }
export interface Adjustment extends Base { month_close: string; withdrawn_in: string | null; plant: string; gl_account: string; pl_line: string | null; amount: string | number; adjustment_type: string; reason: string
  owner: string | null; corrects_sap_document: string | null; reverses: string | null; adjustment_state: string; matched_sap_document: string | null; matched_amount: string | number | null; remaining_amount: string | number | null; ticket: string | null }
export interface Rule extends Base { rule_name: string; rule_kind: string; run_order: number; source_plant: string | null; source_line: string | null; target_line: string; basis: string; rate_per_sqft: string | number | null
  operating_region: string | null; starts_on: string; ends_on: string | null; note: string | null }
export interface RuleSegment extends Base { allocation_rule: string; business_line_segment: string }
export interface RuleStore extends Base { allocation_rule: string; plant: string; treatment: string; share_percent: number | null; amount: string | number | null; area_sqft: number | null }
export interface Area extends Base { plant: string; starts_on: string; ends_on: string | null; area_sqft: number; business_line_segment: string | null; note: string | null }
export interface Person { row_id: string; full_name?: string | null; name?: string | null; email?: string | null }
export interface Actual { company_code: string; close_month: string; close_version: number; plant_code: string; line_key: string; as_posted: number; as_published: number }

/** Every column of one of the app's tables, as its manifest declares them. */
export const columnsOf = (table: string) => manifest.tables.find(t => t.name === table)?.columns ?? []
export const titleOf = (table: string) => (manifest.tables.find(t => t.name === table) as { title_column?: string } | undefined)?.title_column
export const tableLabel = (table: string) => manifest.tables.find(t => t.name === table)?.label ?? table
const fields = (table: string) => ['row_id', 'updated_at', ...columnsOf(table).map(column => column.column_name)]
const own = <T,>(name: string, order_by?: string, filters?: unknown[]) => listAll<T>(`budgets.${name}`, { fields: fields(`budgets.${name}`), ...(order_by ? { order_by } : {}), ...(filters ? { filters } : {}) })

const KEY = 'budgets'
const table = <T,>(name: string, order_by?: string) => () => useQuery({ queryKey: [KEY, name], queryFn: () => own<T>(name, order_by) })

export const useLines = table<PlLine>('pl_line', 'line_order asc')
export const useAccounts = table<Account>('gl_account', 'account_code asc')
export const useVersions = table<BudgetVersion>('budget_version', 'covers_from desc')
export const useCloses = table<Close>('month_close', 'close_month desc')
export const useAdjustments = table<Adjustment>('close_adjustment', 'created_at asc')
export const useRules = table<Rule>('allocation_rule', 'run_order asc')
export const useRuleSegments = table<RuleSegment>('allocation_rule_segment')
export const useRuleStores = table<RuleStore>('allocation_rule_store')
export const useAreas = table<Area>('store_area', 'starts_on desc')

/** The versions to read to know some versions' figures: each one and every version it is based on. */
export const withBases = (versions: BudgetVersion[] | undefined, ids: string[]) => [...new Set(ids.flatMap(id => chainOf(versions ?? [], id).map(v => v.row_id)))]

/** The budget amounts of some versions; asked for only once the versions are known. */
export const useBudget = (versions: string[]) => useQuery({
  queryKey: [KEY, 'pl_budget', ...[...versions].sort()], enabled: versions.length > 0,
  queryFn: () => own<BudgetCell>('pl_budget', undefined, [['budget_version', 'in', versions]]),
})

const instance = <T,>(name: string, columns: string[]) => () => useQuery({ queryKey: [KEY, 'instance', name], staleTime: 300_000, queryFn: () => listAll<T>(name, { fields: ['row_id', ...columns], order_by: 'row_id asc' }) })
export const usePlants = instance<Plant>('Plant', ['plant_name', 'plant_type', 'site', 'legal_company'])
export const useSites = instance<Site>('Site', ['name', 'operating_region', 'opened_on'])
export const useCompanies = instance<Named>('Legal Company', ['name'])
export const useSegments = instance<Named>('Business Line Segment', ['name'])

/** The people who can open Budgets: who an adjustment can belong to, and the names behind the IDs the tables hold. */
export const usePeople = () => useQuery({ queryKey: [KEY, 'people'], staleTime: 300_000, queryFn: () => api.get<{ data: Person[] }>('/api/table_members/budgets.budget_version').then(result => result.data) })

/** The actual P&L of some months, from the warehouse. `connected: false` when no warehouse is set up. */
export const useActuals = (months: string[]) => useQuery({
  queryKey: [KEY, 'actuals', ...months], enabled: months.length > 0, staleTime: 300_000,
  queryFn: () => runRead<{ connected: boolean; rows: Actual[] }>('actuals', { months }),
})

/** After a change: read the app's tables again. */
export function useRefresh() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [KEY] })
}

export interface Activity { versions?: { author_name: string; created_at: string; data: { created?: boolean; changed: [string, unknown, unknown][] } }[]; created?: { author_name: string; created_at: string } }
export const useActivity = (tableName: string, id: string) => useQuery({ queryKey: [KEY, 'activity', tableName, id], queryFn: () => api.get<Activity>(`/api/activity/${encodeURIComponent(tableName)}/${encodeURIComponent(id)}`) })
export const useRecord = (tableName: string, id: string) => useQuery({ queryKey: [KEY, 'record', tableName, id], queryFn: () => api.get<Record<string, unknown>>(`/api/table/${encodeURIComponent(tableName)}/${encodeURIComponent(id)}`) })
