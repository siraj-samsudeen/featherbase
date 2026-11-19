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
import { BUYER_TABLES } from './buyers.ts'
import { DESIGNATION, SHADOW_TABLES } from './business-roles-server.ts'
import { READ_ROLES } from './report-eligibility.ts'
import { ACCESS_SOURCE } from './access-source.ts'
import { SWITCH_OVER_LOG } from './switch-over.ts'
import { PERMISSION_CHANGE } from './permission-grid-server.ts'
import { OPTIONAL_PROVIDER_TABLES } from './provider.ts'
import { REACHES_CHOICES } from './business-roles.ts'

type Dataset = { name: string; source: string; query: string; columns: { name: string; type: string }[]; keys: string[]; filters: Record<string, string>
  guard?: { kind: string; column?: string; value?: number; within?: string }[] }
const datasets = (manifest as unknown as { datasets: Dataset[] }).datasets
const sales = () => datasets.find(d => d.name === SALES_DATASET)!
const operations = manifest.reads.operations as Record<string, { policy: { kind: string; readRoles?: string[] }; outbound?: boolean; needs?: string[] }>
const ROLES = ['Dash All-Stores Reader', 'Dash Reader', 'Report Access Manager', 'Team Report Manager', 'View As Tester']

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
      .toEqual(['stores', 'report', 'embed_session'].map(name => [name, 'person_scope', ROLES.filter(role => role !== 'Report Access Manager' && role !== 'Team Report Manager' && role !== 'View As Tester')]))
  })

  it('declares only the two Dive openers and the Dive list for Add a Dive (#1169) as calling out', () => {
    expect(Object.entries(operations).filter(([, o]) => o.outbound).map(([name]) => name).sort()).toEqual(['dive_choices', 'embed_open', 'embed_session'])
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
      .toEqual(['dash.report', ['dash.report', 'dash.report_bundle', 'dash.report_bundle_member', 'dash.report_access', ...SHADOW_TABLES, ACCESS_SOURCE, SWITCH_OVER_LOG, PERMISSION_CHANGE]])
  })

  // #1277: the business role Tables and the switch decide who reaches what, so only a System Manager writes them; the
  // report access Tables stay ordinary, so role grants decide who gives reports.
  it('decides scope with the business role Tables and the switch, and nothing else of its own', () => {
    expect(manifest.tables.filter(table => (table as { decides_scope?: boolean }).decides_scope).map(table => table.name)).toEqual([...SHADOW_TABLES, ACCESS_SOURCE])
  })

  it("declares a read of every Table its scope provider and Your sections read, and of nothing else", () => {
    // #1046: and its own report access Tables, read as the app so a reader needs no grant on them.
    expect(Object.keys(manifest.baseTables.read).sort()).toEqual([...new Set([...PROVIDER_TABLES, ...BASE_TABLES, ...BUYER_TABLES,
      'dash.report_access', 'dash.report_bundle', 'dash.report_bundle_member',
      // #1218: the business roles in shadow, and the HR title they map from.
      ...SHADOW_TABLES, DESIGNATION,
      // #1277: the switch and the switch-over's log.
      ACCESS_SOURCE, SWITCH_OVER_LOG])].sort())
  })

  // #1277: and the business role Tables, the switch and HR's titles, which business roles read.
  it('declares the Tables the scope provider reads, as the provider lists them', () => {
    expect(manifest.scopeProvider.tables).toEqual([...PROVIDER_TABLES, ...SHADOW_TABLES, ACCESS_SOURCE, DESIGNATION])
    expect(manifest.scopeProvider.unmarkedTables).toEqual([...PROVIDER_TABLES, DESIGNATION])
    expect(manifest.scopeProvider.optionalTables).toEqual([...OPTIONAL_PROVIDER_TABLES, DESIGNATION])
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
  // #1192 (same day): Dash All-Stores Reader reaches every store. #1217: Team Report Manager gives reports to their team.
  it('declares only the roles Dash uses', () => {
    expect(manifest.roles).toEqual(['Dash All-Stores Reader', 'Dash Reader', 'Report Access Manager', 'Team Report Manager', 'View As Tester'])
  })

  // #1218: how far a business role reaches is a required choice on the role, in the step that adds the Table and in its declaration.
  it('declares Reaches on the business role, the same in its step and its Table', () => {
    const step = manifest.migrations.find(m => m.id === 'business_roles_shadow')!.operations as { table: { name: string; columns: { column_name: string }[] } }[]
    const inStep = step.find(op => op.table.name === 'dash.business_role')!.table.columns.find(c => c.column_name === 'reaches')
    const declared = manifest.tables.find(t => t.name === 'dash.business_role')!.columns.find(c => c.column_name === 'reaches')
    // #1277 adds Region with an alterColumn step.
    const widened = (manifest.migrations.find(m => m.id === 'business_roles_live')!.operations as { kind: string; column?: string; to?: object }[]).find(op => op.kind === 'alterColumn' && op.column === 'reaches')!
    expect([{ ...inStep, ...widened.to }, (declared as { choices?: string }).choices?.split('\n')]).toEqual([declared, [...REACHES_CHOICES]])
  })

  // #1218: the comparison judges today's reports by the same roles the platform enforces on these reads.
  it('names in report-eligibility.ts the roles its report and embed reads require', () => {
    expect(['report', 'embed_session'].map(name => [...operations[name].policy.readRoles!].sort())).toEqual([[...READ_ROLES].sort(), [...READ_ROLES].sort()])
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

  it('grant reads only, apart from the Report Access Manager on the report access Tables (#1046) and adding reports (#1169)', () => {
    const writes = manifest.permissions.filter(p => Object.keys(p).sort().join() !== 'can_read,role,table' || (p as { can_read?: boolean }).can_read !== true)
    expect(writes.map(p => [p.role, p.table])).toEqual([['Report Access Manager', 'dash.report'],
      ['Report Access Manager', 'dash.report_bundle'], ['Report Access Manager', 'dash.report_bundle_member'], ['Report Access Manager', 'dash.report_access'],
      // #1217: a Team Report Manager writes only the access rows they made, and the save rule takes them only from Dash's own actions.
      ['Team Report Manager', 'dash.report_access'],
      // #1218: the business roles in shadow; no delete, a hand change is marked removed.
      // A System Manager writes them all the same (#437); the grid's change log is read here and written by the grid's save.
      ...SHADOW_TABLES.map(table => ['Report Access Manager', table])])
    expect(manifest.permissions.find(p => p.role === 'Team Report Manager' && p.table === 'dash.report_access')).toEqual({
      table: 'dash.report_access', role: 'Team Report Manager', scope_mode: 'creator', operations: { read: '@basic', create: '@basic', update: '@basic' } })
  })

  it('lets a Report Access Manager read and create reports, never change or delete one (#1169)', () => {
    expect(manifest.permissions.find(p => p.table === 'dash.report' && p.role === 'Report Access Manager'))
      .toEqual({ table: 'dash.report', role: 'Report Access Manager', operations: { read: '@basic', create: '@basic' } })
  })
})

// #1192: production runs 0.12.10; this version's ledger extends it with one step that changes no Table.
describe('the version step for Dash All-Stores Reader', () => {
  it('follows production\'s 0.12.10 history exactly, then adds the role, then Your sections (#1175, #1191), then Your department (#1195), then who a person is (#1216), then managers add Dives (#1169), then team report giving (#1217), then grant from Waiting for access (#1173), then the department name follows its sections (#1209), then a named cluster head (#4588), then one top bar and sidebar (#1227), with no Table change', () => {
    // From 0.12.5 on, every step in order, each with its versions: read by
    // position from that step, so a step added at the end moves nothing here.
    const from = manifest.migrations.findIndex(m => m.id === 'pickers_in_dive')
    const steps = manifest.migrations.slice(from).map(m => [m.id, m.fromVersion, m.toVersion, m.operations.length])
    expect(steps).toEqual([
      ['pickers_in_dive', '0.12.5', '0.12.6', steps[0][3]],
      ['merchandise_reach', '0.12.6', '0.12.9', 0],
      ['opens_for_dash_roles', '0.12.9', '0.12.10', 0],
      ['all_stores_reader', '0.12.10', '0.12.11', 0],
      ['sections_not_mine', '0.12.11', '0.13.0', 0],
      ['department_self_setup', '0.13.0', '0.13.1', 0],
      ['person_identity', '0.13.1', '0.13.2', 0],
      // #1169: after #1216's 0.13.2, one more step that changes no Table, only access and reads.
      ['report_access_managers_add_dives', '0.13.2', '0.13.3', 0],
      ['team_report_giving', '0.13.3', '0.13.4', 0],
      // #1173: the Waiting for access drawer gives Dash reports
      ['waiting_for_access_grant', '0.13.4', '0.13.5', 0],
      // #1209: the department name follows its sections
      ['department_name_follows_sections', '0.13.5', '0.13.6', 0],
      // #4588: a Cluster row names its head
      ['named_cluster_head', '0.13.6', '0.13.7', 0],
      // #1227: one top bar and sidebar for every app
      ['one_app_chrome', '0.13.7', '0.13.8', 0],
      // #1243: ends_on is a row's last day
      ['ends_on_inclusive', '0.13.8', '0.13.9', 0],
      // #1223: Your store, floor, department and sections, and What they cover
      ['manager_area', '0.13.9', '0.13.10', 0],
      // #1240: "Report an issue" reads the report's context
      ['report_an_issue', '0.13.10', '0.13.12', 0],
      // #1225: the Report access redesign
      ['report_access_redesign', '0.13.12', '0.13.13', 0],
      // #1223: a "+N more" list closes on Escape and on a click outside it
      ['more_list_closes', '0.13.13', '0.13.14', 0],
      // #1245: who runs a store, under the area's title
      ['store_run_by', '0.13.14', '0.13.15', 0],
      // 0.13.16 shipped buyer_section_desks before the move was renamed: kept byte for byte so an instance on it can upgrade.
      ['buyer_section_desks', '0.13.15', '0.13.16', 0],
      ['buyer_section_moves', '0.13.16', '0.13.17', 0],
      // #1236: the switcher says what Dash is for.
      ['switcher_summary', '0.13.17', '0.13.19', 0],
      // #1248: the sidebar's rail shows each report's initials.
      ['sidebar_icon_rail', '0.13.19', '0.13.21', 0],
      // #1222: View As Tester and its people read
      ['view_as', '0.13.21', '0.13.22', 0],
      // #1254: Waiting for you reads who decides in a few queries
      ['waiting_reads_fast', '0.13.22', '0.13.23', 0],
      // #1254: who holds a section is read whole, so a decision and Waiting for you agree
      ['holders_read_whole', '0.13.23', '0.13.24', 0],
      // #1254: who may decide is asked about every waiting change at once
      ['deciders_read_together', '0.13.24', '0.13.25', 0],
      // #1219: the master data team's Put back action; no Table change, and no new read.
      ['mde_review', '0.13.25', '0.13.26', 0],
      // #1267: the platform asks Dash who people are (describe_people); no Table change.
      ['people_describe', '0.13.26', '0.13.27', 0],
      // #1218: business roles in shadow, four Tables that decide no one's access yet
      ['business_roles_shadow', '0.13.27', '0.13.28', 4],
      // #1269: a Dive's reach goes as wholly held code prefixes; no Table change, and no new read.
      ['reach_prefixes', '0.13.28', '0.13.29', 0],
      // #1277: business roles decide Dash access: four Tables marked as deciding scope, grants to business roles, the switch and its log
      ['business_roles_live', '0.13.29', '0.13.30', 9],
      // #1277: an old grant naming more than one thing is given to no role; no Table change.
      ['old_grants_one_receiver', '0.13.30', '0.13.31', 0],
      // #1277: a role viewing every report gets every report; the comparison reads the company once. No Table change.
      ['every_report_and_bulk_comparison', '0.13.31', '0.13.32', 0],
      // #1280: Site's kind and status join Dash's reads, used where the instance's Site has them; no Table of Dash's changes.
      ['site_kind', '0.13.32', '0.13.33', 0],
      // #1277: Division Head and visual merchandising's two roles join the starting roles, and old grants carry only Dash Reader's to the manager roles; no Table change.
      ['division_head_and_visual_merchandising', '0.13.33', '0.13.34', 0],
      // #1282: the platform Map's Why for a Person, with no Table change.
      ['why_on_the_map', '0.13.34', '0.13.35', 0],
      // #1282: the Map's Why draws each App · Level once (UI owner), with no Table change.
      ['why_app_levels_merged', '0.13.35', '0.13.36', 0],
      // #1313: Report access dates are the day in India, with no Table change.
      ['report_access_days_in_india', '0.13.36', '0.13.37', 0],
      // #1282: the area picker on Also Give, with no Table change.
      ['area_picker', '0.13.37', '0.13.38', 0],
      // #1282: the permission grid: a permission's removed mark and its unique key, and the grid's change log.
      ['permission_grid', '0.13.38', '0.13.39', 3],
      // #1282: the Lens's worked-out sections, a read only, with no Table change.
      ['worked_out_sections', '0.13.39', '0.13.40', 0],
      ['people_sections', '0.13.40', '0.13.41', 0],
    ])
    expect(manifest.actions.operations.put_back).toEqual({ policy: { kind: 'table' }, authorization: { kind: 'generic' } })
    expect(manifest.baseTables.read['Section Subcategory']).not.toContain('updated_by')
    expect(manifest.people).toEqual({ describe: 'describe_people', sections: 'worked_out' })
    expect(manifest.reads.operations.describe_people).toEqual({ policy: { kind: 'table' }, authorization: { kind: 'generic' } })
    expect(manifest.baseTables.read.Site).toEqual(['name', 'is_store', 'cluster', 'operating_region', 'site_kind', 'status'])
    expect(pkg.version).toBe('0.13.41')
  })
})
