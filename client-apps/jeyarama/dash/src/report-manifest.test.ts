// What featherbase.json declares for the report: the cached dataset,
// the reads and their policies, the bar's store picker, the Dive's outside
// site, its settings and secret, and every read grant the report and stage D
// will need (an upgrade can never add one: featherbase #617).
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }
import { EMBED_ORIGIN, LAST_MONTH_DATASET, LAST_SALES_DATASET, MONTH_DATASET, SALES_DATASET, reads } from './server.ts'
import type { SalesRow } from './report.ts'

type Dataset = { name: string; source: string; query: string; columns: { name: string; type: string }[]; keys: string[]; filters: Record<string, string>
  guard?: { kind: string; column?: string; value?: number; within?: string }[] }
const datasets = (manifest as unknown as { datasets: Dataset[] }).datasets
const sales = () => datasets.find(d => d.name === SALES_DATASET)!
const operations = manifest.reads.operations as Record<string, { policy: { kind: string; readRoles?: string[] }; outbound?: boolean }>
const ROLES = ['Dash Reader', 'Dash Section Editor', 'Dash Section Reviewer']

describe("the app's name in the manifest", () => {
  it('is Dash everywhere: title, identifier, roles and Table group', () => {
    expect(manifest.title).toBe('Dash')
    expect(manifest.name).toBe('dash')
    expect(manifest.roles).toEqual(ROLES)
    expect([...new Set(manifest.tables.map(table => table.module))]).toEqual(['Dash'])
  })
})

describe('the report in the manifest', () => {
  // The old report's checks (featherbase sales-target-mtd.ts `validate`): a refresh with no
  // target at all, or with under half the active snapshot's target day rows, keeps the last good
  // one. The day rows are `target_days` summed over the snapshot; the drops compare within one
  // month only (featherbase #676), as the old check did by keying its snapshots by month. The
  // targeted subcategories and the total target are guarded too, as extra protection.
  it("refuses a refresh with no target, or with under half the month's target days, targeted subcategories or total target", () => {
    expect(sales().guard).toEqual([
      { kind: 'not_all_zero', column: 'target' },
      { kind: 'max_drop_pct', column: 'target', value: 50, within: 'period_start' },
      { kind: 'max_sum_drop_pct', column: 'target', value: 50, within: 'period_start' },
      { kind: 'max_sum_drop_pct', column: 'target_days', value: 50, within: 'period_start' },
    ])
  })

  it("declares the cached dataset on the instance's MotherDuck source", () => {
    expect(sales().source).toBe('motherduck')
  })

  it('declares every column the report reads, typed', () => {
    const row: Record<keyof SalesRow, string> = {
      store_code: 'text', store_name: 'text', short_code: 'text', subcategory_code: 'text', subcategory: 'text',
      target: 'money', actual: 'money', days_with_actual: 'integer', days: 'integer', period_start: 'date', data_through: 'date',
      targets_available: 'boolean', target_days: 'integer', target_quantity: 'number', actual_quantity: 'number',
    }
    expect(sales().columns).toEqual(Object.entries(row).map(([name, type]) => ({ name, type })))
  })

  it("maps the scope's store and subcategory filters to the dataset's columns", () => {
    expect(sales().filters).toEqual({ store: 'store_code', subcategory: 'subcategory_code' })
  })

  it('lets a read narrow the dataset to one store', () => {
    expect(sales().keys).toContain('store_code')
  })

  it("keeps today's personalisation out of the query: no store or subcategory is ever written into it", () => {
    expect(sales().query).not.toMatch(/plant_code\s*=\s*'|hierarchy_code\s+in\s*\(/i)
  })

  it('works out the month to date in India Standard Time inside the query', () => {
    expect(sales().query).toMatch(/timezone\('Asia\/Kolkata', now\(\)\)/)
  })

  it('declares a handler for every read, and a read for every handler', () => {
    expect(Object.keys(operations).sort()).toEqual(Object.keys(reads).sort())
  })

  it("scopes the report's reads by the reader's places", () => {
    expect(['stores', 'report', 'embed_session'].map(name => [name, operations[name].policy.kind, operations[name].policy.readRoles]))
      .toEqual(['stores', 'report', 'embed_session'].map(name => [name, 'person_scope', ROLES]))
  })

  it('declares only embed_session as calling out', () => {
    expect(Object.entries(operations).filter(([, o]) => o.outbound).map(([name]) => name)).toEqual(['embed_session'])
  })

  it('draws the store picker and the month picker (#750) in the top bar, setting ?store= and ?month=', () => {
    expect(manifest.bar).toEqual([{ picker: 'Store', options: 'stores', sets: 'store', hiddenWhen: 'view' }, { picker: 'Month', options: 'months', sets: 'month', hiddenWhen: 'view' }])
  })

  it("lets anyone who can open the app read the month picker's options: they hold no figure", () => {
    expect(operations.months.policy).toEqual(operations.me.policy)
  })

  it("frames only MotherDuck's embed site", () => {
    expect(manifest.frameOrigins).toEqual([EMBED_ORIGIN])
  })

  it('reads the Dive from optional settings, so an instance without one gets the quick view', () => {
    expect(manifest.settings).toEqual([
      { name: 'dive_id', required: false }, { name: 'embed_service_account', required: false },
      { name: 'dive_ready_signal', required: false }, { name: 'linked_tables', required: false }])
  })

  it('reads the MotherDuck token as a secret', () => {
    expect(manifest.secrets).toEqual(['MOTHERDUCK_TOKEN'])
  })
})

describe("the month's metadata dataset", () => {
  const month = () => datasets.find(d => d.name === 'sales_month')!

  it("declares the month's metadata per store and subcategory, and no figure", () => {
    expect(month().columns).toEqual([
      { name: 'store_code', type: 'text' }, { name: 'store_name', type: 'text' }, { name: 'subcategory_code', type: 'text' },
      { name: 'period_start', type: 'date' }, { name: 'data_through', type: 'date' }, { name: 'targets_available', type: 'boolean' }])
  })

  it('is limited to the reader by the same scope mapping as the figures', () => {
    expect([month().source, month().filters, month().keys]).toEqual(['motherduck', sales().filters, ['store_code']])
  })
})

// #750: last month's figures and metadata are this month's datasets over last month whole, kept
// apart so each refresh holds one period_start (the guards compare within one).
describe("last month's datasets", () => {
  const named = (name: string) => datasets.find(d => d.name === name)!
  const THIS = "cast(date_trunc('month', cast(timezone('Asia/Kolkata', now()) as date)) as date) as period_start,\n         cast(timezone('Asia/Kolkata', now()) as date) as period_end"
  const LAST = "cast(date_trunc('month', cast(timezone('Asia/Kolkata', now()) as date)) - interval 1 month as date) as period_start,\n         cast(date_trunc('month', cast(timezone('Asia/Kolkata', now()) as date)) - interval 1 day as date) as period_end"

  it.each([[LAST_SALES_DATASET, SALES_DATASET], [LAST_MONTH_DATASET, MONTH_DATASET]])('%s is %s with only its period changed', (last, current) => {
    const { name: _a, query: lastQuery, ...lastRest } = named(last)
    const { name: _b, query: thisQuery, ...thisRest } = named(current)
    expect([lastRest, lastQuery]).toEqual([thisRest, thisQuery.replace(THIS, LAST)])
  })

  it("changes this month's period, which each query works out once", () => {
    expect([named(SALES_DATASET).query.split(THIS).length, named(MONTH_DATASET).query.split(THIS).length]).toEqual([2, 2])
  })
})

describe('the read grants, declared before the first install', () => {
  const ORG_CHART = ['dash.store_floor', 'dash.department', 'dash.section', 'dash.section_subcategory',
    'dash.display_location', 'dash.job_assignment', 'dash.section_alias', 'dash.floor_alias', 'dash.job_alias',
    'dash.designation', 'dash.designation_alias']
  const granted = (role: string) => manifest.permissions.filter(p => p.role === role).map(p => p.table).sort()

  it('give every app role a read of the entry Table, which opening the app needs', () => {
    expect(ROLES.every(role => granted(role).includes('dash.store_rollout'))).toBe(true)
  })

  it('give the Reader nothing else: the report reads the cached dataset through its places, never a Table', () => {
    expect(granted('Dash Reader')).toEqual(['dash.store_rollout'])
  })

  it("give stage D's Section Editor a read of every org chart Table", () => {
    expect(granted('Dash Section Editor')).toEqual([...ORG_CHART, 'dash.store_rollout'].sort())
  })

  it("give stage D's Section Reviewer a read of every org chart Table", () => {
    expect(granted('Dash Section Reviewer')).toEqual([...ORG_CHART, 'dash.store_rollout'].sort())
  })

  it('give no app role the people Tables: who reads contacts and stints is the scopes\' to decide (#683)', () => {
    expect(manifest.permissions.filter(p => ['dash.employee', 'dash.employment'].includes(p.table))).toEqual([])
  })

  it('grant reads only: writing a Table that decides scope waits for featherbase #462', () => {
    expect(manifest.permissions.every(p => Object.keys(p).sort().join() === 'can_read,role,table' && p.can_read === true)).toBe(true)
  })
})
