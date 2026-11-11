// What featherbase.json declares for the report: the cached dataset,
// the reads and their policies, the bar's store picker, the Dive's outside
// site, its settings and secret, and every read grant the report and stage D
// will need (an upgrade adds a grant only for a role it newly declares: featherbase #617, #1192).
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }
import pkg from '../package.json' with { type: 'json' }
import { DASH_ROLES, EMBED_ORIGIN, LAST_MONTH_DATASET, LAST_SALES_DATASET, MONTH_DATASET, SALES_DATASET, reads } from './server.ts'
import type { SalesRow } from './report.ts'
import { PROVIDER_FIELDS, PROVIDER_TABLES } from './provider.ts'
import { BASE_TABLES } from './my-sections.ts'

type Dataset = { name: string; source: string; query: string; columns: { name: string; type: string }[]; keys: string[]; filters: Record<string, string>
  guard?: { kind: string; column?: string; value?: number; within?: string }[] }
const datasets = (manifest as unknown as { datasets: Dataset[] }).datasets
const sales = () => datasets.find(d => d.name === SALES_DATASET)!
const operations = manifest.reads.operations as Record<string, { policy: { kind: string; readRoles?: string[] }; outbound?: boolean; needs?: string[] }>
const ROLES = ['Dash All-Stores Reader', 'Dash Reader', 'Report Access Manager']

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
      .toEqual(['stores', 'report', 'embed_session'].map(name => [name, 'person_scope', ROLES.filter(role => role !== 'Report Access Manager')]))
  })

  it('declares only the two Dive openers as calling out', () => {
    expect(Object.entries(operations).filter(([, o]) => o.outbound).map(([name]) => name).sort()).toEqual(['embed_open', 'embed_session'])
  })

  it('draws the store picker and the month picker (#750) in the top bar, setting ?store= and ?month=', () => {
    expect(manifest.bar).toEqual([{ picker: 'Store', options: 'stores', sets: 'store', hiddenWhen: 'view', dependsOn: ['report'] }, { picker: 'Month', options: 'months', sets: 'month', hiddenWhen: 'view', dependsOn: ['report'] }])
  })

  it("lets anyone who can open the app read the month picker's options: they hold no figure", () => {
    expect(operations.months.policy).toEqual(operations.me.policy)
  })

  it("opens Dash for exactly the app's own roles (#1172)", () => {
    expect([...DASH_ROLES].sort()).toEqual([...manifest.roles].sort())
  })

  it("frames only MotherDuck's embed site", () => {
    expect(manifest.frameOrigins).toEqual([EMBED_ORIGIN])
  })

  it("takes the Dive's account from an optional setting, so an instance without one gets the quick view; each Dive's id is on its report's row", () => {
    expect(manifest.settings).toEqual([{ name: 'embed_service_account', required: false }, { name: 'linked_tables', required: false }])
  })

  it('reads the MotherDuck token as a secret, and the embed token as an optional one', () => {
    expect(manifest.secrets).toEqual(['MOTHERDUCK_TOKEN', { name: 'MOTHERDUCK_EMBED_TOKEN', optional: true }])
  })

  it('gives the embed token only to the two reads that open a Dive (#1139)', () => {
    expect(Object.entries(operations).filter(([, o]) => o.needs?.includes('MOTHERDUCK_EMBED_TOKEN')).map(([name]) => name).sort())
      .toEqual(['embed_open', 'embed_session'])
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

describe('what Dash owns and what it reads', () => {
  it('owns its list of Dives, its entry Table, and the report access Tables (#1046)', () => {
    expect([manifest.entryTable, manifest.tables.map(table => table.name)])
      .toEqual(['dash.report', ['dash.report', 'dash.report_bundle', 'dash.report_bundle_member', 'dash.report_access']])
  })

  it('decides scope with none of its own Tables, so role grants decide who gives reports', () => {
    expect(manifest.tables.filter(table => (table as { decides_scope?: boolean }).decides_scope)).toEqual([])
  })

  it("declares a read of every Table its scope provider and Your sections read, and of nothing else", () => {
    // #1046: and its own report access Tables, read as the app so a reader needs no grant on them.
    expect(Object.keys(manifest.baseTables.read).sort()).toEqual([...new Set([...PROVIDER_TABLES, ...BASE_TABLES,
      'dash.report_access', 'dash.report_bundle', 'dash.report_bundle_member'])].sort())
  })

  it('declares the Tables the scope provider reads, as the provider lists them', () => {
    expect(manifest.scopeProvider.tables).toEqual(PROVIDER_TABLES)
  })

  it('asks for every column the provider reads', () => {
    const read = manifest.baseTables.read as Record<string, string[]>
    for (const table of PROVIDER_TABLES) expect(read[table], table).toEqual(expect.arrayContaining(PROVIDER_FIELDS[table]))
  })

  it("says Dash report, so people don't take it for the platform's Report Table", () => {
    const added = manifest.migrations.flatMap(m => m.operations as { kind: string; table?: { name: string; label: string } }[]).filter(o => o.kind === 'addTable' && o.table?.name === 'dash.report')
    expect([manifest.tables[0].label, added.map(o => o.table?.label)]).toEqual(['Dash report', ['Dash report']])
  })

  // #1159: off by default, so every report keeps the bar until its Dive has its own pickers.
  it("marks a report whose Dive has its own Store and Month pickers, with a check that's off until set, added by a migration step", () => {
    const column = manifest.tables[0].columns.find(c => c.column_name === 'pickers_in_dive') as { column_type?: string; default?: unknown } | undefined
    const added = manifest.migrations.flatMap(m => m.operations as unknown as { kind: string; table?: string; column?: { column_name: string } }[])
      .filter(o => o.kind === 'addColumn' && o.table === 'dash.report' && o.column?.column_name === 'pickers_in_dive')
    expect([column?.column_type, column?.default ?? null, added.length]).toEqual(['Check', null, 1])
  })

  it('offers the three filter shapes and no filter on a report', () => {
    const shape = manifest.tables[0].columns.find(column => column.column_name === 'filter_shape') as { choices?: string } | undefined
    expect(shape?.choices?.split('\n')).toEqual(['One store and subcategories', 'Whole stores', 'Stores and subcategories', 'No filter'])
  })
})

describe('the read grants, declared before the first install', () => {
  const granted = (role: string) => manifest.permissions.filter(p => p.role === role).map(p => p.table).sort()

  it('give every app role a read of the entry Table, which opening the app needs', () => {
    expect(ROLES.every(role => granted(role).includes('dash.report'))).toBe(true)
  })

  it('give the Reader nothing else: the report reads the cached dataset through its places, never a Table', () => {
    expect(granted('Dash Reader')).toEqual(['dash.report'])
  })

  // Siraj, 11-Nov-2026 ("Drop whatever is not implemented"): no section editor or reviewer role.
  // #1192 (same day): Dash All-Stores Reader reaches every store.
  it('declares only the roles Dash uses', () => {
    expect(manifest.roles).toEqual(['Dash All-Stores Reader', 'Dash Reader', 'Report Access Manager'])
  })

  it('give the All-Stores Reader only the read of the entry Table, and every read the Reader has', () => {
    expect(granted('Dash All-Stores Reader')).toEqual(['dash.report'])
    const scoped = Object.entries(operations).filter(([, op]) => op.policy.readRoles?.includes('Dash Reader')).map(([name]) => name)
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.filter(name => !operations[name].policy.readRoles!.includes('Dash All-Stores Reader'))).toEqual([])
  })

  it('give no app role the people Tables: who reads contacts and stints is the scopes\' to decide (#683)', () => {
    expect(manifest.permissions.filter(p => ['Employee', 'Job Assignment'].includes(p.table))).toEqual([])
  })

  it('grant reads only, apart from the Report Access Manager on the report access Tables (#1046)', () => {
    const writes = manifest.permissions.filter(p => Object.keys(p).sort().join() !== 'can_read,role,table' || (p as { can_read?: boolean }).can_read !== true)
    expect(writes.map(p => [p.role, p.table])).toEqual([
      ['Report Access Manager', 'dash.report_bundle'], ['Report Access Manager', 'dash.report_bundle_member'], ['Report Access Manager', 'dash.report_access']])
  })
})

// #1192: production runs 0.12.10; this version's ledger extends it with one step that changes no Table.
describe('the version step for Dash All-Stores Reader', () => {
  it('follows production\'s 0.12.10 history exactly, then adds the role, then Your sections (#1175, #1191), with no Table change', () => {
    const tail = manifest.migrations.slice(-5).map(m => [m.id, m.fromVersion, m.toVersion, m.operations.length])
    expect(tail).toEqual([['pickers_in_dive', '0.12.5', '0.12.6', tail[0][3]], ['merchandise_reach', '0.12.6', '0.12.9', 0],
      ['opens_for_dash_roles', '0.12.9', '0.12.10', 0], ['all_stores_reader', '0.12.10', '0.12.11', 0], ['sections_not_mine', '0.12.11', '0.13.0', 0]])
    expect(pkg.version).toBe('0.13.0')
  })
})
