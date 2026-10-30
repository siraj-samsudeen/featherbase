// The per-store coverage comparison (featherbase#630 D10): before a store goes
// live, every person's coverage under the old rules and the new org chart,
// every difference with its reason, the store's conflicts and what still
// needs matching. A store goes live only when both lists are empty and the
// comparison is accepted. Pure: compare-cli.ts loads the rows.
import { aliasConflicts, conflictsOf, storeCodeConflicts, type Conflict } from './conflicts.ts'
import { coverageOf, ownedOn, currentJobs, type CoveredUnit, type OrgChart, type Row } from './coverage.ts'
import { legacyCoverage, LEGACY_TABLES, type LegacyTables } from './legacy-derivation.ts'
import { day, exact, fold, text } from './values.ts'

/** Everything the comparison reads. The CLI fills it from an instance or a JSON file. */
export interface Snapshot {
  rollout: Row[]
  chart: OrgChart
  sectionAliases: Row[]
  legacy: LegacyTables
  /** Each employee code (trimmed, upper case) and the people it is current on. */
  codeHolders: Record<string, string[]>
  /** Each person's display name, by Person id. */
  people: Record<string, string>
  /** Each person's current employee codes, as stored. Without it, a person's codes are the codeHolders keys that list them. */
  personCodes?: Record<string, string[]>
  /** People whose current employee codes could not all be read, with the reason: no old coverage is asserted for them. */
  incomplete?: Record<string, string>
}

export interface Difference { subcategory: string; reason: string }
export interface PersonComparison {
  person: string
  name: string
  old: { subcategories: string[]; basis: string[] }
  /** Whole-store access is unrestricted store scope (the store filter alone): no subcategory list. */
  new: { subcategories: string[]; wholeStore: boolean; jobs: string[] }
  /** Why this person's old coverage could not be worked out; then nothing old is asserted. */
  incomplete: string | null
  /** Set when finite old access becomes the whole store: the widening and its reason. */
  widened: string | null
  added: Difference[]
  removed: Difference[]
}
export interface NeedsMatching { kind: 'employee_code' | 'section_name'; value: string; message: string }
export interface StoreComparison {
  store: string
  date: string
  live: boolean
  people: PersonComparison[]
  conflicts: Conflict[]
  needsMatching: NeedsMatching[]
}

/** upper(trim(x)) as SQL has it: spaces only, and NULL stays empty here (it names no code). */
const code = (value: unknown) => (value == null ? '' : String(value).replace(/^ +| +$/g, '').toUpperCase())
const unitText = (u: CoveredUnit) => `${u.job}${u.acting ? ' (acting)' : ''} of ${u.unitName}`

/** The employee codes the old Tables name at a store, with the Table each comes from. */
function storeCodes(store: string, legacy: LegacyTables): Map<string, string> {
  const found = new Map<string, string>()
  const note = (rows: Row[], columns: string[], table: string) => {
    for (const row of rows) if (String(row.store_code) === store)
      for (const c of columns) if (code(row[c]) && !found.has(code(row[c]))) found.set(code(row[c]), table)
  }
  note(legacy.employeeSections, ['employee_code'], LEGACY_TABLES.employeeSections)
  note(legacy.ownership, ['tl_employee_code', 'dm_employee_code'], LEGACY_TABLES.ownership)
  note(legacy.storeManagers, ['employee_code'], LEGACY_TABLES.storeManagers)
  return found
}

export function compareStore(store: string, snapshot: Snapshot, on: string): StoreComparison {
  const { chart, legacy, codeHolders } = snapshot
  const live = snapshot.rollout.some(r => exact(r.store) === store && !!day(r.live_since) && day(r.live_since) <= on)
  const codesHere = storeCodes(store, legacy)
  const codesOf = (person: string) => Object.keys(codeHolders).filter(c => codeHolders[c].includes(person)).sort()

  // Everyone either rule gives anything at this store.
  const people = new Set<string>()
  for (const c of codesHere.keys()) for (const p of codeHolders[c] ?? []) people.add(p)
  for (const r of legacy.assignments) if (String(r.plant_code) === store) people.add(text(r.employee))
  for (const r of chart.jobs) if (exact(r.store) === store && currentJobs(chart, exact(r.person), on).includes(r)) people.add(exact(r.person))

  const owned = ownedOn(chart, on)
  const storeSections = chart.sections.filter(s => exact(s.store) === store)
  const ownerOf = (group: string) => storeSections.find(s => (owned.get(exact(s.row_id)) ?? []).includes(group))
  const nameOf = (rows: Row[], ref: unknown, show: (r: Row) => string) => { const r = rows.find(x => exact(x.row_id) === exact(ref)); return r ? show(r) : '' }

  const display = (person: string) => snapshot.people[person] ?? person
  const compared = [...people].sort((a, b) => display(a).localeCompare(display(b)) || a.localeCompare(b)).map((person): PersonComparison => {
    const unknown = snapshot.incomplete?.[person]
    if (unknown) {
      const units = coverageOf(person, chart, on).filter(u => u.store === store)
      const whole = units.some(u => u.wholeStore)
      return { person, name: display(person), incomplete: unknown, old: { subcategories: [], basis: [] },
        new: { subcategories: whole ? [] : [...new Set(units.flatMap(u => u.subcategories))].sort(), wholeStore: whole, jobs: units.map(unitText) },
        widened: null, added: [], removed: [] }
    }
    const codes = snapshot.personCodes ? snapshot.personCodes[person] ?? [] : codesOf(person)
    const ambiguous = codes.some(c => (codeHolders[c] ?? []).length > 1)
    const oldStore = legacyCoverage({ id: person, codes, ambiguous }, legacy, on).find(s => s.plant_code === store)
    const oldGroups = oldStore?.material_groups ?? []
    const units = coverageOf(person, chart, on).filter(u => u.store === store)
    const whole = units.some(u => u.wholeStore)
    // The whole store is the store filter alone, unplaced subcategories included: nothing old is
    // removed, and the change from a finite set is one widening, not a list of additions.
    const newGroups = whole ? [] : [...new Set(units.flatMap(u => u.subcategories))].sort()
    const jobs = units.map(unitText)
    const widened = whole
      ? `new: ${units.filter(u => u.wholeStore).map(unitText).join(' and ')} covers the whole store, every subcategory placed or not; old: ${
        oldGroups.length ? `${oldGroups.length} subcategories (${oldStore!.scope_basis.join(', ')})` : 'nothing'}`
      : null

    const added = newGroups.filter(g => !oldGroups.includes(g)).map(g => {
      const givers = units.filter(u => u.wholeStore || u.subcategories.includes(g)).map(unitText).join(' and ')
      const why = ambiguous ? 'an employee code of theirs is current on someone else too, so the old rules give them nothing'
        : !codes.some(c => codesHere.has(c)) && !oldStore ? 'no employee code of theirs appears in the old Tables'
        : `no old rule gives it (old basis here: ${oldStore?.scope_basis.join(', ') || 'none'})`
      return { subcategory: g, reason: `new: ${givers}; old: ${why}` }
    })
    const removed = whole ? [] : oldGroups.filter(g => !newGroups.includes(g)).map(g => {
      const basis = (oldStore?.basis_by_material_group[g] ?? []).join(', ')
      const owner = ownerOf(g)
      let why: string
      if (!units.length) why = `no job assignment at ${store} on ${on}`
      else if (!owner) why = `not placed in any section on ${on}`
      else {
        const floor = nameOf(chart.floors, owner.floor, f => text(f.floor_name))
        const dept = nameOf(chart.departments, owner.department, d => text(d.name) || text(d.department_key))
        const where = [floor && `floor ${floor}`, dept && `department ${dept}`].filter(Boolean).join(', ')
        why = `owned by ${text(owner.section_name)}${where ? ` (${where})` : ''}, which their ${jobs.join(' and ')} does not reach`
      }
      return { subcategory: g, reason: `old: ${basis}; new: ${why}` }
    })
    return { person, name: display(person), old: { subcategories: oldGroups, basis: oldStore?.scope_basis ?? [] },
      new: { subcategories: newGroups, wholeStore: whole, jobs }, incomplete: null, widened, added, removed }
  })

  const needsMatching: NeedsMatching[] = []
  for (const [c, table] of [...codesHere].sort())
    if (!(codeHolders[c] ?? []).length) needsMatching.push({ kind: 'employee_code', value: c, message: `Employee code ${c} (${table}) matches no current person` })
  const known = new Set([...storeSections.map(s => fold(s.section_name)),
    // An alias counts only when it points at an existing section of this store.
    ...snapshot.sectionAliases.filter(a => exact(a.store) === store &&
      storeSections.some(s => exact(s.row_id) === exact(a.section))).map(a => fold(a.alias))])
  const oldNames = new Map<string, string>()
  for (const [rows, table] of [[legacy.ownership, LEGACY_TABLES.ownership], [legacy.merchandise, LEGACY_TABLES.merchandise]] as const)
    for (const r of rows) if (String(r.store_code) === store && text(r.section_name) && !oldNames.has(text(r.section_name))) oldNames.set(text(r.section_name), table)
  for (const [name, table] of [...oldNames].sort())
    if (!known.has(fold(name))) needsMatching.push({ kind: 'section_name', value: name, message: `Old section name "${name}" (${table}) matches no section or section alias` })

  const conflicts = [...conflictsOf(store, chart, on, p => snapshot.people[p] ?? p), ...aliasConflicts(store, snapshot.sectionAliases, chart.sections),
    ...storeCodeConflicts(store, chart, snapshot.rollout, snapshot.sectionAliases)]
  return { store, date: on, live, people: compared, conflicts, needsMatching }
}

/** A store's comparison as plain text. */
export function renderComparison(c: StoreComparison): string {
  const lines = [`Store ${c.store} on ${c.date}: ${c.live ? 'live on the new org chart' : 'not live yet (old rules)'}`, '']
  const changed = c.people.filter(p => p.widened || p.added.length || p.removed.length)
  const unknown = c.people.filter(p => p.incomplete)
  lines.push(`People: ${c.people.length}, ${changed.length} with differences${unknown.length ? `, ${unknown.length} INCOMPLETE` : ''}`, '')
  for (const p of c.people) {
    lines.push(`${p.name} (${p.person})`)
    if (p.incomplete) lines.push(`  old: INCOMPLETE, not assessed (${p.incomplete})`)
    else lines.push(`  old: ${p.old.subcategories.length ? `${p.old.subcategories.join(', ')} (${p.old.basis.join(', ')})` : 'nothing'}`)
    lines.push(`  new: ${p.new.wholeStore ? 'the whole store' : p.new.subcategories.length ? p.new.subcategories.join(', ') : 'nothing'}${p.new.jobs.length ? ` (${p.new.jobs.join('; ')})` : ''}`)
    if (p.widened) lines.push(`  + the whole store: ${p.widened}`)
    for (const d of p.added) lines.push(`  + ${d.subcategory}: ${d.reason}`)
    for (const d of p.removed) lines.push(`  - ${d.subcategory}: ${d.reason}`)
    lines.push('')
  }
  lines.push(`Conflicts: ${c.conflicts.length}`)
  for (const x of c.conflicts) lines.push(`  [${x.kind}] ${x.message}`)
  lines.push('', `Needs matching: ${c.needsMatching.length}`)
  for (const x of c.needsMatching) lines.push(`  [${x.kind}] ${x.message}`)
  return lines.join('\n') + '\n'
}
