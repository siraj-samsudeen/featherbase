// Feather Dash's scope provider (featherbase B2, #559): the places a person
// covers, in the platform's scope shape. The platform calls it fresh on every
// person_scope request and reads only the Tables declared here, each marked
// decides_scope. Per store, featherbase#630 D10:
//  - a store with a store_rollout row live on or before today uses the new
//    org chart (coverage.ts), its places `confirmed`;
//  - every other store uses today's derivation from the old Tables
//    (legacy-derivation.ts), its places `assumed`.
// An empty answer is an empty scope, which the platform reads as no access.
import { coverageOf, ownedOn, type CoveredUnit, type OrgChart } from './coverage.ts'
import { LEGACY_TABLES, legacyCoverage, type LegacyStore, type LegacyTables } from './legacy-derivation.ts'
import { day, exact, text } from './values.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
interface Documents {
  list(table: string, args?: { filters?: Filter[]; fields?: string[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
}
interface ProviderContext {
  readonly person: { readonly id: string; readonly email: string | null; readonly identifiers?: Readonly<Record<string, readonly Readonly<{ value: string; shared: boolean }>[]>> }
  readonly documents: Documents
}
export interface Place {
  label: string
  filters: Record<string, string[]>
  basis?: string
  confirmation?: Record<string, Record<string, 'confirmed' | 'assumed'>>
}

const APP = {
  rollout: 'feather_dash.store_rollout',
  floors: 'feather_dash.store_floor',
  departments: 'feather_dash.department',
  sections: 'feather_dash.section',
  placements: 'feather_dash.section_subcategory',
  jobs: 'feather_dash.job_assignment',
} as const

/** Every Table the provider reads: featherbase.json's scopeProvider.tables. */
export const PROVIDER_TABLES: string[] = [...Object.values(APP), ...Object.values(LEGACY_TABLES)]

/** A person's current employee codes, and whether one is current on someone else too. */
export interface EmployeeCodes { codes: string[]; ambiguous: boolean }

/** The identifier system today's derivation reads codes from; the manifest's scopeProvider.identifiers declares it. */
export const EMPLOYEE_CODE_SYSTEM = 'stylehr-employee-code'

/**
 * Where the old rules get a person's employee codes: the platform hands the
 * provider the person's values valid today in each identifier system it
 * declared (featherbase #660), each saying whether another person holds the
 * same value today too (#662). `null` means the old rules give the person
 * nothing.
 *
 * As the original rule (#408 D10): a person with any shared code gets nothing
 * from the old rules, explicit Sales Target Assignment rows included; a person
 * whose codes are all unshared gets what those codes derive plus their explicit
 * rows; a person with no code gets their explicit rows.
 */
async function fromIdentifiers(person: ProviderContext['person']): Promise<EmployeeCodes | null> {
  const held = person.identifiers?.[EMPLOYEE_CODE_SYSTEM]
  if (!held) return null
  return { codes: held.map(code => code.value), ambiguous: held.some(code => code.shared) }
}

/** Today in India Standard Time. */
function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

/**
 * The columns read from each Table. A list answers only the fields it names
 * (row_id alone when it names none), and naming a column a Table lacks fails
 * the read, and with it the whole scope: the old Tables must hold every column
 * below, Section Ownership's dm_employee_code included.
 */
const FIELDS: Record<string, string[]> = {
  [APP.rollout]: ['store', 'live_since'],
  [APP.jobs]: ['row_id', 'person', 'job', 'store', 'floor', 'department', 'section', 'acting', 'starts_on', 'ends_on'],
  [APP.floors]: ['row_id', 'store', 'floor_name'],
  [APP.departments]: ['row_id', 'store', 'department_key', 'name'],
  [APP.sections]: ['row_id', 'store', 'section_name', 'floor', 'department'],
  [APP.placements]: ['row_id', 'store', 'subcategory', 'section', 'starts_on', 'ends_on'],
  [LEGACY_TABLES.assignments]: ['employee', 'plant_code', 'store_label', 'material_group'],
  [LEGACY_TABLES.employeeSections]: ['store_code', 'employee_code', 'subcategory'],
  [LEGACY_TABLES.ownership]: ['store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from'],
  [LEGACY_TABLES.storeManagers]: ['store_code', 'employee_code'],
  [LEGACY_TABLES.merchandise]: ['store_code', 'material_group', 'mch_subcategory', 'section_name'],
  [LEGACY_TABLES.aliases]: ['store_code', 'roster_section_name', 'merch_section_name'],
}

const PAGE = 500
/** Every row of a list: at most 500 a call, in row_id order so pages neither skip nor repeat. Reads are one at a time, as the platform requires. */
async function all(documents: Documents, table: string, filters: Filter[] = []): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields: FIELDS[table], order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const BASIS: Record<string, string> = {
  'Store Manager': 'store_manager', 'Cluster Manager': 'cluster_manager', 'Floor Manager': 'floor_manager',
  'Department Manager': 'department_manager', 'Team Leader': 'team_leader', 'Staff': 'section_staff',
}

/** The label of a section's place; the report reads a subcategory's section back from it (`sectionOfPlace`). */
export const sectionLabel = (store: string, section: string) => `${store} / Section: ${section}`

function confirmation(filters: Record<string, string[]>, status: 'confirmed' | 'assumed') {
  return Object.fromEntries(['store', 'subcategory'].filter(name => filters[name])
    .map(name => [name, Object.fromEntries(filters[name].map(value => [value, status]))]))
}

/** Places by label: places with one label merge their filters and bases; listed by label. */
class Places {
  private merged = new Map<string, { filters: Record<string, Set<string>>; basis: Set<string> }>()
  add(label: string, store: string, subcategories: string[] | null, basis: string[]) {
    const place = this.merged.get(label) ?? { filters: { store: new Set() }, basis: new Set() }
    place.filters.store.add(store)
    if (subcategories) for (const code of subcategories) (place.filters.subcategory ??= new Set()).add(code)
    for (const b of basis) if (b) place.basis.add(b)
    this.merged.set(label, place)
  }
  list(status: 'confirmed' | 'assumed'): Place[] {
    return [...this.merged].sort(([a], [b]) => a.localeCompare(b)).map(([label, place]) => {
      const filters = Object.fromEntries(Object.entries(place.filters).map(([name, values]) => [name, [...values].sort()]))
      return { label, filters, basis: [...place.basis].sort().join(', '), confirmation: confirmation(filters, status) }
    })
  }
}

/**
 * Places from new-chart units (provisional, #4444): one per covered section that owns a
 * subcategory on the date, named by the section, plus the store itself for a whole-store
 * job. Filters name only the store and subcategories: a dataset of store and subcategory
 * cannot apply a floor or section row id, and the platform drops a place it cannot apply.
 */
function chartPlaces(units: CoveredUnit[], chart: OrgChart, on: string): Place[] {
  const owned = ownedOn(chart, on)
  const names = new Map(chart.sections.map(s => [exact(s.row_id), text(s.section_name)]))
  const places = new Places()
  for (const unit of units) {
    const basis = `${unit.acting ? 'acting_' : ''}${BASIS[unit.job]}`
    if (unit.wholeStore) places.add(unit.store, unit.store, null, [basis])
    for (const section of unit.sections) {
      const codes = owned.get(section) ?? []
      if (codes.length) places.add(sectionLabel(unit.store, names.get(section) ?? section), unit.store, codes, [basis])
    }
  }
  return places.list('confirmed')
}

/**
 * Places from the old rules: one per section of the merchandise map, and the store for subcategories
 * outside it. Each carries the bases of its own subcategories, never the store's union: the page says
 * which job gives which section (#4486).
 */
function legacyPlaces(stores: LegacyStore[]): Place[] {
  const places = new Places()
  for (const store of stores) {
    for (const code of store.material_groups) {
      const section = store.section_by_material_group[code]
      places.add(section ? sectionLabel(store.plant_code, section) : store.plant_code, store.plant_code, [code],
        store.basis_by_material_group[code] ?? store.scope_basis)
    }
  }
  return places.list('assumed')
}

/** Today's derivation for a person whose codes are known and unshared, for the stores not yet live. */
async function legacyStores(documents: Documents, person: string, codes: string[], on: string, live: Set<string>) {
  const legacy: LegacyTables = { assignments: [], employeeSections: [], ownership: [], storeManagers: [], merchandise: [], aliases: [] }
  legacy.assignments = await all(documents, LEGACY_TABLES.assignments, [['employee', '=', person]])
  if (codes.length) {
    legacy.employeeSections = await all(documents, LEGACY_TABLES.employeeSections)
    legacy.ownership = await all(documents, LEGACY_TABLES.ownership)
    legacy.storeManagers = await all(documents, LEGACY_TABLES.storeManagers)
    legacy.aliases = await all(documents, LEGACY_TABLES.aliases)
  }
  const stores = [...new Set([...legacy.assignments.map(r => r.plant_code), ...legacy.employeeSections.map(r => r.store_code),
    ...legacy.ownership.map(r => r.store_code), ...legacy.storeManagers.map(r => r.store_code)].map(String))]
  if (stores.length) legacy.merchandise = await all(documents, LEGACY_TABLES.merchandise, [['store_code', 'in', stores]])
  return legacyCoverage({ id: person, codes, ambiguous: false }, legacy, on).filter(store => !live.has(store.plant_code))
}

export interface ProviderOptions {
  today?: () => string
  employeeCodes?: (person: ProviderContext['person']) => Promise<EmployeeCodes | null>
}

export function orgChartProvider({ today = istToday, employeeCodes = fromIdentifiers }: ProviderOptions = {}) {
  return async function orgChart({ person, documents }: ProviderContext): Promise<Place[]> {
    const on = today()
    const live = new Set((await all(documents, APP.rollout))
      .filter(row => { const since = day(row.live_since); return !!since && since <= on })
      .map(row => exact(row.store)))

    // The new chart, for the live stores the person holds a job in.
    const jobs = await all(documents, APP.jobs, [['person', '=', person.id]])
    const stores = [...new Set(jobs.map(row => exact(row.store)).filter(store => live.has(store)))]
    const inStores = (table: string) => stores.length ? all(documents, table, [['store', 'in', stores]]) : Promise.resolve([])
    const chart: OrgChart = { jobs, floors: [], departments: [], sections: [], placements: [] }
    chart.floors = await inStores(APP.floors)
    chart.departments = await inStores(APP.departments)
    chart.sections = await inStores(APP.sections)
    chart.placements = await inStores(APP.placements)
    const units = coverageOf(person.id, chart, on).filter(unit => live.has(unit.store))

    // The old rules, for every store not yet live, only when the person's employee codes are known.
    const known = await employeeCodes(person)
    const old = known && !known.ambiguous ? await legacyStores(documents, person.id, known.codes, on, live) : []

    return [...chartPlaces(units, chart, on), ...legacyPlaces(old)]
  }
}
