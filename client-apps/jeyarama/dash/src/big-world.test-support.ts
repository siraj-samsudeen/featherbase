// #1277: a large made-up company for the Who Would Gain Or Lose Access tests: stores, floors, sections,
// departments, clusters, regions, buyers, Buyer Sections, hand changes, grants of every kind, retired rows,
// people who have left. Made-up names and ids only. Not part of the backend inventory: nothing the server imports reaches it.
import { addStartingRoles } from './business-roles-server.ts'
import { istToday } from './report.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export const today = istToday()

/** A small seeded random source, so every run builds the same company. */
function random(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

const REPORTS = [
  { report_key: 'sales', report_name: 'Sales', filter_shape: 'One store and subcategories' },
  { report_key: 'stock', report_name: 'Stock', filter_shape: 'Stores and subcategories' },
  { report_key: 'targets', report_name: 'Targets', filter_shape: 'Whole stores' },
  { report_key: 'notice', report_name: 'Notice Board', filter_shape: 'No filter' },
  { report_key: 'vendor', report_name: 'Vendor Sales', filter_shape: 'Stores and subcategories' },
  { report_key: 'ageing', report_name: 'Stock Ageing', filter_shape: 'One store and subcategories' },
]

/** The company: `people` employees over `stores` stores. */
export function bigWorld({ people = 10_000, stores = 60, seed = 7 }: { people?: number; stores?: number; seed?: number } = {}): Record<string, Row[]> {
  const r = random(seed)
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]
  const regions = ['East', 'West', 'North', 'South']
  const clusters = Array.from({ length: Math.max(2, Math.floor(stores / 6)) }, (_, i) => ({ row_id: `CL${i}`, name: `Cluster ${i}`, cluster_manager: null as string | null }))
  const t: Record<string, Row[]> = {
    Employee: [], 'Job Assignment': [], Designation: [{ row_id: 'D-OPS', designation: 'Operations Executive' }, { row_id: 'D-SA', designation: 'Sales Associate' }, { row_id: 'D-ODD', designation: 'Visual Merchandiser' }],
    Site: [], Plant: [], 'Store Floor': [], Section: [], 'Section Subcategory': [], Subcategory: [], Category: [], Subdivision: [], Division: [],
    Department: [], 'Department Section': [], Cluster: clusters, 'Merchandise Assignment': [], 'Buyer Section': [], 'Buyer Section Subcategory': [],
    'Operating Region': regions.map(row_id => ({ row_id })),
    'dash.report': REPORTS.map(r => ({ row_id: r.report_key, ...r })),
    'dash.report_access': [], 'dash.report_bundle': [{ row_id: 'B1', bundle_name: 'Store pack' }], 'dash.report_bundle_member': [
      { row_id: 'BM1', report_bundle: 'B1', report: 'sales' }, { row_id: 'BM2', report_bundle: 'B1', report: 'stock' }],
    'dash.business_role': [], 'dash.business_role_permission': [], 'dash.title_map': [], 'dash.role_assignment': [], 'dash.switch_over_log': [],
  }
  // Merchandise: two divisions, ten categories, 200 subcategories (some consumables).
  const categories = Array.from({ length: 10 }, (_, i) => `CAT${i}`)
  for (let i = 0; i < 200; i++) {
    const category = categories[i % 10]
    t.Subcategory.push({ row_id: `SC${String(i).padStart(3, '0')}`, subcategory: `Subcategory ${i}`, category, subdivision: `SUB${i % 4}`, division: `DIV${i % 2}`, subcategory_type: i % 17 === 0 ? 'Consumable' : 'Merchandise' })
  }
  t.Site.push({ row_id: 'HOF', name: 'Head Office', is_store: false, cluster: null, operating_region: 'East' })
  const storeIds: string[] = []
  for (let s = 0; s < stores; s++) {
    const id = `ST${String(s).padStart(2, '0')}`
    storeIds.push(id)
    // Every tenth store sits in no cluster; one store is closed (not a store any more).
    t.Site.push({ row_id: id, name: `Store ${s}`, is_store: s !== stores - 1, cluster: s % 10 === 9 ? null : clusters[s % clusters.length].row_id, operating_region: s % 13 === 12 ? null : regions[s % regions.length] })
    t.Plant.push({ row_id: `${9000 + s}`, site: id, plant_type: 'Store' })
    if (s % 5 === 0) t.Plant.push({ row_id: `${8000 + s}`, site: id, plant_type: 'Shop-in-shop' })
    if (s % 7 === 0) t.Plant.push({ row_id: `${7000 + s}`, site: id, plant_type: 'Warehouse' })
    for (let f = 0; f < 3; f++) {
      const floor = `${id}-F${f}`
      t['Store Floor'].push({ row_id: floor, name: `Floor ${f}`, site: id })
      for (let k = 0; k < 2; k++) {
        const section = `${floor}-S${k}`
        t.Section.push({ row_id: section, name: `Section ${f}${k}`, site: id, floor })
        // Store 3 has sections with nothing placed in them.
        if (s !== 3) for (let p = 0; p < 4; p++)
          t['Section Subcategory'].push({ row_id: `${section}-P${p}`, store: id, section, subcategory: `SC${String((s * 7 + f * 11 + k * 13 + p * 3) % 200).padStart(3, '0')}`, starts_on: '2026-01-01', ends_on: p === 3 && s % 4 === 0 ? '2026-02-01' : null })
      }
    }
    for (let d = 0; d < 2; d++) t.Department.push({ row_id: `${id}-D${d}`, name: `Department ${d}`, store: id, manager: null, starts_on: '2026-01-01', ends_on: null })
    for (let f = 0; f < 3; f++) for (let k = 0; k < 2; k++)
      if (s % 6 !== 5) t['Department Section'].push({ row_id: `${id}-DS${f}${k}`, store: id, department: `${id}-D${f % 2}`, section: `${id}-F${f}-S${k}`, starts_on: '2026-01-01', ends_on: null })
  }
  // Buyer Sections: a few, each taking some subcategories in a region.
  for (let b = 0; b < 6; b++) {
    t['Buyer Section'].push({ row_id: `BS${b}`, name: `Buyer Section ${b}`, operating_region: regions[b % 4], buyer: null, starts_on: '2026-01-01', ends_on: b === 5 ? '2026-03-01' : null })
    for (let k = 0; k < 5; k++) t['Buyer Section Subcategory'].push({ row_id: `BSL${b}-${k}`, buyer_section: `BS${b}`, subcategory: `SC${String(b * 20 + k).padStart(3, '0')}`, starts_on: '2026-01-01', ends_on: null })
  }
  // People.
  let job = 0
  const addJob = (employee: string, name: string, site: string, over: Row = {}) =>
    t['Job Assignment'].push({ row_id: `J${String(job++).padStart(6, '0')}`, employee, job: name, designation: null, site, floor: null, section: null, acting: false, reports_to: null, starts_on: '2026-01-01', ends_on: null, ...over })
  for (let i = 0; i < people; i++) {
    const emp = `E${String(i).padStart(5, '0')}`
    const status = i % 37 === 5 ? 'Left' : 'Current'
    // Some staff have no sign-in (no person).
    const person = i % 53 === 7 ? '' : `psn_${String(i).padStart(5, '0')}`
    t.Employee.push({ row_id: emp, name: `Person ${i}`, employee_code: `C${i}`, status, person })
    const s = i % stores
    const store = storeIds[s]
    const slot = Math.floor(i / stores)
    if (slot === 0) addJob(emp, 'Store Manager', store, i % 11 === 0 ? { designation: 'D-OPS' } : {})
    else if (slot <= 3) addJob(emp, 'Floor Manager', store, { floor: `${store}-F${slot - 1}`, acting: slot === 3 && s % 3 === 0 })
    else if (slot <= 5) {
      addJob(emp, 'Department Manager', store)
      t.Department.find(d => d.row_id === `${store}-D${slot - 4}`)!.manager = emp
    } else if (slot <= 11) addJob(emp, 'Team Leader', store, { section: `${store}-F${(slot - 6) % 3}-S${(slot - 6) % 2}` })
    else if (slot === 12 && s < clusters.length) {
      addJob(emp, 'Cluster Manager', s % 4 === 0 ? 'HOF' : store)
      clusters[s].cluster_manager = emp
    } else if (slot === 13 && s < 3) addJob(emp, pick(['Director', 'Managing Director', 'Chief Operating Officer']), 'HOF')
    else if (slot >= 14 && slot < 18) addJob(emp, 'Head office staff', 'HOF', i % 9 === 0 ? { designation: 'D-ODD' } : {})
    else if (slot === 18 && s < 30) {
      // Buyers and category heads, by subcategory, category or division, in a region or every region.
      const level = pick(['subcategory', 'category', 'subdivision', 'division'] as const)
      const value = level === 'subcategory' ? `SC${String(Math.floor(r() * 200)).padStart(3, '0')}` : level === 'category' ? pick(categories) : level === 'subdivision' ? `SUB${Math.floor(r() * 4)}` : `DIV${Math.floor(r() * 2)}`
      t['Merchandise Assignment'].push({ row_id: `M${i}`, employee: emp, responsibility: s % 5 === 0 ? 'Category head' : 'Buyer', division: null, subdivision: null, category: null, subcategory: null,
        [level]: value, operating_region: s % 3 === 0 ? null : pick(regions), starts_on: '2026-01-01', ends_on: s % 11 === 0 ? '2026-02-01' : null })
      addJob(emp, 'Head office staff', 'HOF')
      if (s < 6) t['Buyer Section'][s].buyer = emp
    } else {
      // Staff: most in a section; some ended, some retired rows, some with a designation, some with no section.
      const section = `${store}-F${slot % 3}-S${slot % 2}`
      addJob(emp, 'Staff', store, { section: i % 41 === 3 ? null : section, designation: i % 19 === 0 ? 'D-SA' : null, ends_on: i % 29 === 4 ? '2026-03-01' : null, retired: i % 31 === 6 })
      if (i % 43 === 8) addJob(emp, 'Team Leader', store, { section, acting: true })
    }
  }
  return t
}

export interface Counted { reads: { table: string; filters: Filter[] }[]; rolesOf: number; rolesOfMany: number }

/** The platform's reads over the tables, counting every read: only the fields asked for come back, retired rows only when asked. */
export function bigContext(tables: Record<string, Row[]>, { person, roles = ['Report Access Manager'], peopleRoles, bulkRoles = true }:
  { person?: string; roles?: string[]; peopleRoles: (person: string) => string[]; bulkRoles?: boolean }) {
  const counted: Counted = { reads: [], rolesOf: 0, rolesOfMany: 0 }
  const index = new Map<string, Map<string, Row[]>>()
  const byColumn = (table: string, column: string) => {
    const k = `${table}\u0000${column}`
    if (!index.has(k)) {
      const m = new Map<string, Row[]>()
      for (const row of tables[table] ?? []) { const v = String(row[column] ?? ''); m.set(v, [...(m.get(v) ?? []), row]) }
      index.set(k, m)
    }
    return index.get(k)!
  }
  // As a database would: an index answers the first filter, the rest are checked on what it finds.
  const list = async (table: string, args: { fields?: string[]; filters?: Filter[]; limit_start?: number; limit_page_length?: number; with_retired?: boolean }) => {
    const filters = args.filters ?? []
    counted.reads.push({ table, filters })
    const [first, ...rest] = filters
    let rows = tables[table] ?? []
    if (first) {
      const m = byColumn(table, first[0])
      const values = first[1] === 'in' ? [...new Set((first[2] as unknown[]).map(v => String(v ?? '')))] : [String(first[2] ?? '')]
      const order = new Map(rows.map((row, i) => [row, i]))
      rows = values.flatMap(v => m.get(v) ?? []).sort((a, b) => order.get(a)! - order.get(b)!)
    }
    rows = rows.filter(row => (args.with_retired || !row.retired) && rest.every(([c, op, v]) =>
      op === 'in' ? (v as unknown[]).map(x => String(x ?? '')).includes(String(row[c] ?? '')) : String(row[c] ?? '') === String(v ?? '')))
    const start = args.limit_start ?? 0
    const picked = rows.slice(start, start + (args.limit_page_length ?? 500))
    return args.fields?.length ? picked.map(row => Object.fromEntries(['row_id', ...args.fields!].filter(f => f in row).map(f => [f, row[f]]))) : picked
  }
  let n = 0
  return {
    counted,
    ctx: {
      user: 'mgr', roles, payload: person ? { person } : {}, userName: 'Made-up Manager',
      reject(message: string): never { throw new Error(message) },
      baseTables: { list, available: async (table: string) => table in tables },
      documents: {
        list, async create(table: string, values: Row) { const row = { row_id: `${table}-${++n}`, updated_at: '2026-11-17T00:00:00Z', ...values }; (tables[table] ??= []).push(row); index.clear(); return row },
        async update(table: string, values: Row) { const row = tables[table].find(x => x.row_id === values.row_id)!; Object.assign(row, values); index.clear(); return row },
      },
      people: {
        names: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, null])),
        rolesOf: async (p: string) => { counted.rolesOf++; return peopleRoles(p) },
        ...(bulkRoles ? { rolesOfMany: async (ps: string[]) => { counted.rolesOfMany++; return Object.fromEntries(ps.map(p => [p, peopleRoles(p)])) } } : {}),
      },
    },
  }
}

/** Platform roles spread over the people: Dash Reader, Dash All-Stores Reader, a manager or two, and none. */
export function platformRoles(p: string): string[] {
  const i = Number(p.replace(/\D/g, '')) || 0
  if (p === 'psn_00000') return ['Report Access Manager']
  return i % 10 < 4 ? ['Dash Reader'] : i % 10 === 4 ? ['Dash All-Stores Reader'] : i % 10 === 5 ? ['Dash Reader', 'Team Report Manager'] : []
}

/** The starting roles written, grants of every kind and hand changes, over the company. */
export async function seededBigWorld(options: Parameters<typeof bigWorld>[0] = {}) {
  const tables = bigWorld(options)
  await addStartingRoles(bigContext(tables, { peopleRoles: platformRoles }).ctx as never)
  const role = (name: string) => String(tables['dash.business_role'].find(x => x.role_name === name)!.row_id)
  const people = tables.Employee.map(e => String(e.person)).filter(Boolean)
  const grant = (row: Row) => tables['dash.report_access'].push({ row_id: `A${tables['dash.report_access'].length}`, report: null, report_bundle: null, person: null, role: null, job: null, business_role: null, removed: false, ...row })
  grant({ report: 'sales', job: 'Store Manager' })
  grant({ report_bundle: 'B1', job: 'Floor Manager' })
  grant({ report: 'stock', role: 'Dash Reader' })
  grant({ report: 'targets', role: 'Dash All-Stores Reader' })
  grant({ report: 'notice', role: 'Dash Reader' })
  grant({ report: 'vendor', business_role: role('Buyer') })
  grant({ report_bundle: 'B1', business_role: role('Store Manager') })
  grant({ report: 'ageing', business_role: role('Team Leader') })
  grant({ report: 'ageing', job: 'Team Leader', removed: true })
  grant({ report: 'notice', job: 'Staff' })
  // A bad row naming two receivers gives nothing.
  grant({ report: 'targets', job: 'Staff', role: 'Dash Reader' })
  for (let i = 0; i < people.length; i += 97) grant({ report: pick2(i), person: people[i] })
  // Hand changes: Also give, Correct (with and without a store), ended, removed, an Owner Director or two.
  const hand = (row: Row) => tables['dash.role_assignment'].push({ row_id: `H${tables['dash.role_assignment'].length}`, ends_on: null, reason: null, removed: false, site: null, updated_at: '2026-11-17T00:00:00Z', ...row })
  for (let i = 0; i < people.length; i += 211) hand({ person: people[i], change: 'Also give', business_role: role(i % 2 ? 'Tester' : 'Regional Head'), site: i % 3 ? 'ST01' : null })
  for (let i = 5; i < people.length; i += 307) hand({ person: people[i], change: 'Correct', business_role: role(i % 2 ? 'Store Manager' : 'Cluster Manager'), site: i % 4 ? null : 'ST02' })
  for (let i = 9; i < people.length; i += 401) hand({ person: people[i], change: 'Also give', business_role: role('Buyer'), ends_on: '2026-01-01' })
  for (let i = 11; i < people.length; i += 503) hand({ person: people[i], change: 'Also give', business_role: role('Category Head'), removed: true })
  hand({ person: people[1], change: 'Also give', business_role: role('Owner Director') })
  hand({ person: 'psn_outsider', change: 'Also give', business_role: role('Owner Director') })
  hand({ person: 'psn_tester', change: 'Also give', business_role: role('Tester'), site: 'ST04' })
  return tables
}
const pick2 = (i: number) => REPORTS[i % REPORTS.length].report_key
