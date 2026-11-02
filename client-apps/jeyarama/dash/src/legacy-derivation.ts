// Today's scope derivation, moved here from featherbase's
// apps/server/src/sales-target.ts (derivedFromSections, sectionsOf and
// currentAssignments at featherbase 15072f3f) for stores not yet live on the
// new org chart. The rules are unchanged; only the medium is: the SQL became
// functions over the rows a scope provider reads (it cannot run SQL).
//  - section_staff: the person's Employee Section Map subcategories, resolved
//    to subcategory codes through Section Merchandise Map;
//  - team_leader / department_manager: every subcategory of every Section
//    the CURRENT roster names them TL or DM of. A Section's current rows are
//    its latest effective_from on or before today; two TLs can share a date;
//    an undated row is in force from the start; a row whose date is not an ISO
//    day is dropped (a slash date is never read month-first). Section Name
//    Alias maps a roster Section onto every merchandise Section it names;
//  - store_manager: every subcategory of the Store Manager's store;
//  - assignment: the person's own Sales Target Assignment rows.
// Names compare trimmed and case-folded (lower(trim(...)) in the SQL), codes
// trimmed and upper-cased. An ambiguous employee code gives the person
// nothing at all (#408 D10). A store code that is not four digits refuses the
// whole derivation; a subcategory code that is not nine digits is dropped.
import { MATERIAL_GROUP, PLANT_CODE } from './values.ts'

type Row = Record<string, unknown>
export type LegacyBasis = 'assignment' | 'section_staff' | 'team_leader' | 'department_manager' | 'store_manager'

/** The rows of the old Tables, as their Table names say. */
export interface LegacyTables {
  /** Sales Target Assignment */
  assignments: Row[]
  /** Employee Section Map */
  employeeSections: Row[]
  /** Section Ownership */
  ownership: Row[]
  /** Store Manager */
  storeManagers: Row[]
  /** Section Merchandise Map */
  merchandise: Row[]
  /** Section Name Alias */
  aliases: Row[]
}

/** The Feather Dash Table names behind each part of LegacyTables. */
export const LEGACY_TABLES: Record<keyof LegacyTables, string> = {
  assignments: 'Sales Target Assignment',
  employeeSections: 'Employee Section Map',
  ownership: 'Section Ownership',
  storeManagers: 'Store Manager',
  merchandise: 'Section Merchandise Map',
  aliases: 'Section Name Alias',
}

/** Who the old rules are asked about: the Person, and their current employee codes. */
export interface LegacyPerson {
  id: string
  codes: string[]
  /** One of the codes is current on another person too. */
  ambiguous: boolean
}

export interface LegacyStore {
  plant_code: string
  store_label: string | null
  material_groups: string[]
  section_by_material_group: Record<string, string>
  scope_basis: LegacyBasis[]
  basis_by_material_group: Record<string, LegacyBasis[]>
}

interface Derived { plant_code: string; material_group: string; basis: LegacyBasis }

// SQL's semantics, exactly (#4438 Codex round 3): `trim` removes spaces only,
// NULL stays NULL through trim, lower and upper, and NULL never equals
// anything, NULL included. Values are otherwise compared raw: a subcategory code (`material_group`)
// is never trimmed, so one padded with spaces fails the nine-digit check.
type Sql = string | null
const sqlText = (value: unknown): Sql => (value == null ? null : String(value))
const sqlTrim = (value: unknown): Sql => { const v = sqlText(value); return v === null ? null : v.replace(/^ +| +$/g, '') }
const lowerTrim = (value: unknown): Sql => sqlTrim(value)?.toLowerCase() ?? null
const upperTrim = (value: unknown): Sql => sqlTrim(value)?.toUpperCase() ?? null
/** SQL `=`: false when either side is NULL. */
const eq = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b)
/** `x is not null and x <> ''`. */
const present = (value: unknown) => value != null && String(value) !== ''
const ISO_DAY = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/

function realDay(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function derivedFromSections(codes: string[], tables: LegacyTables, today: string): Derived[] {
  if (!codes.length) return []
  // upper(trim(x)) = any(codes): the codes are the identifier values, as stored.
  const held = (value: unknown) => { const v = upperTrim(value); return v !== null && codes.includes(v) }
  const out: Derived[] = []
  const push = (plant: unknown, group: unknown, basis: LegacyBasis) => {
    if (present(group)) out.push({ plant_code: String(plant), material_group: String(group), basis })
  }

  for (const e of tables.employeeSections) {
    if (!held(e.employee_code)) continue
    for (const m of tables.merchandise)
      if (eq(m.store_code, e.store_code) && eq(lowerTrim(m.mch_subcategory), lowerTrim(e.subcategory))) push(e.store_code, m.material_group, 'section_staff')
  }

  // The roster. effective_from is read through text: `~ ISO day` then
  // left(10)::date, which fails the whole query on a day like 2026-02-30;
  // blank (NULL or spaces) is in force from the start. Rows in force today,
  // then per (store, Section) only the latest date's rows; a NULL store or
  // Section name matches no group in that correlated max, so the row is out.
  const roster = tables.ownership.flatMap(o => {
    const raw = sqlText(o.effective_from)
    const undated = (sqlTrim(raw) ?? '') === ''
    let from: string | null = null
    if (raw !== null && ISO_DAY.test(raw)) {
      from = raw.slice(0, 10)
      if (!realDay(from)) throw new Error(`Section Ownership effective_from ${JSON.stringify(raw)} is not a real day; today's derivation fails on it`)
    }
    if (!(undated || (from !== null && from <= today))) return []
    return [{ row: o, from: from ?? '1900-01-01', section: lowerTrim(o.section_name) }]
  })
  const key = (store: unknown, section: Sql) => `${String(store)}\u0000${section}`
  const latest = new Map<string, string>()
  for (const r of roster) {
    if (r.row.store_code == null || r.section === null) continue
    const k = key(r.row.store_code, r.section)
    if ((latest.get(k) ?? '') < r.from) latest.set(k, r.from)
  }
  const current = roster.filter(r => r.row.store_code != null && r.section !== null && latest.get(key(r.row.store_code, r.section)) === r.from)
  for (const [basis, column] of [['team_leader', 'tl_employee_code'], ['department_manager', 'dm_employee_code']] as const) {
    // led: the roster Sections, union every Section Name Alias target (union drops duplicates).
    const led: [unknown, Sql][] = []
    const seenLed = new Set<string>()
    const lead = (store: unknown, section: Sql) => { const k = key(store, section); if (!seenLed.has(k)) { seenLed.add(k); led.push([store, section]) } }
    for (const r of current) {
      if (!held(r.row[column])) continue
      lead(r.row.store_code, r.section)
      for (const a of tables.aliases)
        if (eq(a.store_code, r.row.store_code) && eq(lowerTrim(a.roster_section_name), r.section)) lead(r.row.store_code, lowerTrim(a.merch_section_name))
    }
    const seen = new Set<string>()
    for (const [store, section] of led)
      for (const m of tables.merchandise) {
        if (!eq(m.store_code, store) || !eq(lowerTrim(m.section_name), section) || !present(m.material_group)) continue
        const pair = key(m.store_code, String(m.material_group))
        if (!seen.has(pair)) { seen.add(pair); push(m.store_code, m.material_group, basis) }
      }
  }

  for (const s of tables.storeManagers) {
    if (!held(s.employee_code)) continue
    for (const m of tables.merchandise) if (eq(m.store_code, s.store_code)) push(s.store_code, m.material_group, 'store_manager')
  }
  return out
}

/** Each subcategory's merchandise Section at a store: min(section_name) where it is present. */
function sectionsOf(plant: string, groups: string[], merchandise: Row[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of merchandise) {
    if (!eq(m.store_code, plant) || m.material_group == null || !groups.includes(String(m.material_group)) || !present(m.section_name)) continue
    const group = String(m.material_group)
    const section = String(m.section_name)
    if (!(group in out) || section < out[group]) out[group] = section
  }
  return out
}

/** What the old rules give `person` today: one entry per store, sorted by store code. */
export function legacyCoverage(person: LegacyPerson, tables: LegacyTables, today: string): LegacyStore[] {
  if (person.ambiguous) return []
  // `where employee = $user order by material_group`
  const explicit = tables.assignments.filter(r => eq(r.employee, person.id))
    .sort((a, b) => (a.material_group == null ? 1 : b.material_group == null ? -1 : String(a.material_group) < String(b.material_group) ? -1 : String(a.material_group) > String(b.material_group) ? 1 : 0))
  const derived = derivedFromSections(person.codes, tables, today)
  const plants = [...new Set([...explicit.map(r => String(r.plant_code)), ...derived.map(r => r.plant_code)])].sort()
  const badPlant = plants.find(p => !PLANT_CODE.test(p))
  if (badPlant !== undefined) throw new Error(`The account maps to a store code that is not four digits (${JSON.stringify(badPlant)})`)
  return plants.map(plant => {
    const mine = explicit.filter(r => String(r.plant_code) === plant)
    const theirs = derived.filter(r => r.plant_code === plant)
    const basisByGroup: Record<string, Set<LegacyBasis>> = {}
    const note = (group: string, basis: LegacyBasis) => { (basisByGroup[group] ??= new Set()).add(basis) }
    for (const r of mine) note(String(r.material_group), 'assignment')
    for (const r of theirs) note(r.material_group, r.basis)
    const groups = Object.keys(basisByGroup).filter(g => MATERIAL_GROUP.test(g)).sort()
    const basis = new Set<LegacyBasis>(theirs.map(r => r.basis))
    if (mine.length) basis.add('assignment')
    return {
      plant_code: plant,
      store_label: (mine[0]?.store_label as string | null | undefined) ?? null,
      material_groups: groups,
      section_by_material_group: sectionsOf(plant, groups, tables.merchandise),
      scope_basis: [...basis].sort(),
      basis_by_material_group: Object.fromEntries(groups.map(g => [g, [...basisByGroup[g]].sort()])),
    }
  })
}
