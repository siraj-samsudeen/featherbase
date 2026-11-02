// A store's org chart conflicts (featherbase#630, "Org-chart conflicts are
// listed, and never change coverage"): the rules a single row cannot check,
// listed with their reasons so the store can clean its rows before it goes
// live. Nothing here feeds coverage.ts.
import { JOB_LEVEL, type OrgChart, type Row } from './coverage.ts'
import { checked, day, exact, holdsOn, text } from './values.ts'

export type ConflictKind =
  | 'link_to_another_store' | 'too_many_team_leaders' | 'team_leader_on_several_sections' | 'no_reporting_line'
  | 'section_without_team_leader' | 'section_without_department' | 'department_without_manager' | 'department_without_name'
  | 'team_leader_outside_department' | 'department_manager_outside_floors' | 'overlapping_placement'
  | 'several_stores_at_once' | 'several_store_managers' | 'unknown_job' | 'alias_target_invalid' | 'store_code_not_canonical'

export interface Conflict {
  kind: ConflictKind
  message: string
  /** The rows to fix, by row id. */
  rows: string[]
}

const id = (row: Row) => exact(row.row_id)
const overlap = (a: Row, b: Row) => {
  const [as, ae, bs, be] = [day(a.starts_on), day(a.ends_on), day(b.starts_on), day(b.ends_on)]
  return as < (be || '9999-12-31') && bs < (ae || '9999-12-31')
}

/** The conflicts of `store` on `on`. `chart` holds the store's rows, and every job row of its people in any store. */
export function conflictsOf(store: string, chart: OrgChart, on: string, name: (person: string) => string = p => p): Conflict[] {
  const out: Conflict[] = []
  const add = (kind: ConflictKind, message: string, rows: string[]) => out.push({ kind, message, rows })
  const mine = (rows: Row[]) => rows.filter(r => exact(r.store) === store)
  const byId = (rows: Row[]) => new Map(rows.map(r => [id(r), r]))
  const floors = byId(chart.floors)
  const departments = byId(chart.departments)
  const sections = byId(chart.sections)
  const local = (map: Map<string, Row>, ref: unknown) => { const r = map.get(exact(ref)); return r && exact(r.store) === store ? r : undefined }
  const deptName = (d: Row) => text(d.name) || text(d.department_key)
  const storeSections = mine(chart.sections)
  const storeJobs = mine(chart.jobs)
  const current = storeJobs.filter(r => holdsOn(r, on))
  const holding = (job: string, acting = true) => current.filter(r => text(r.job) === job && (acting || !checked(r.acting)))

  // Links that leave the store: coverage ignores them, so they are listed here.
  const foreign = (label: string, kind: string, map: Map<string, Row>, ref: unknown, show: (r: Row) => string, row: string) => {
    const target = map.get(exact(ref))
    if (target && exact(target.store) !== store) add('link_to_another_store', `${label} names ${kind} ${show(target)} of store ${exact(target.store)}`, [row])
  }
  for (const s of storeSections) {
    foreign(text(s.section_name), 'floor', floors, s.floor, f => text(f.floor_name), id(s))
    foreign(text(s.section_name), 'department', departments, s.department, deptName, id(s))
  }
  for (const r of storeJobs) {
    const level = JOB_LEVEL[text(r.job)]
    if (level === 'floor') foreign(`${name(text(r.person))} (${text(r.job)})`, 'floor', floors, r.floor, f => text(f.floor_name), id(r))
    if (level === 'department') foreign(`${name(text(r.person))} (${text(r.job)})`, 'department', departments, r.department, deptName, id(r))
    if (level === 'section') foreign(`${name(text(r.person))} (${text(r.job)})`, 'section', sections, r.section, s => text(s.section_name), id(r))
  }
  for (const p of mine(chart.placements)) foreign(`Subcategory ${text(p.subcategory)}`, 'section', sections, p.section, s => text(s.section_name), id(p))

  // Team Leaders: per section, and per person.
  const leaders = holding('Team Leader', false)
  for (const s of storeSections) {
    const on_s = leaders.filter(r => text(r.section) === id(s))
    const allowed = Number(s.team_leaders_allowed ?? 1) || 1
    if (on_s.length > allowed)
      add('too_many_team_leaders', `${text(s.section_name)} has ${on_s.length} Team Leaders, allows ${allowed}: ${on_s.map(r => name(text(r.person))).sort().join(', ')}`, on_s.map(id))
    if (!holding('Team Leader').some(r => text(r.section) === id(s))) add('section_without_team_leader', `${text(s.section_name)} has no Team Leader`, [id(s)])
    if (!text(s.department)) add('section_without_department', `${text(s.section_name)} has no department`, [id(s)])
  }
  for (const person of new Set(leaders.map(r => text(r.person)))) {
    const rows = leaders.filter(r => text(r.person) === person)
    const led = new Set(rows.map(r => text(r.section)))
    if (led.size > 1) add('team_leader_on_several_sections', `${name(person)} leads ${led.size} sections: ${[...led].map(s => text(sections.get(s)?.section_name ?? s)).sort().join(', ')}`, rows.map(id))
  }

  // Departments.
  for (const d of mine(chart.departments)) {
    if (!holding('Department Manager').some(r => text(r.department) === id(d))) add('department_without_manager', `${deptName(d)} has no Department Manager`, [id(d)])
    if (!text(d.name)) add('department_without_name', `Department ${text(d.department_key)} has no name: name this department`, [id(d)])
  }

  // Reporting lines.
  for (const r of current) {
    const job = text(r.job)
    if (['Team Leader', 'Department Manager', 'Floor Manager'].includes(job) && !text(r.reports_to))
      add('no_reporting_line', `${name(text(r.person))} (${job}) has no reporting line`, [id(r)])
  }
  const managed = (person: string, job: string) => current.filter(r => text(r.person) === person && text(r.job) === job)
  // Every current Team Leader row, acting included: acting is exempt from the leader count, not from its reporting line.
  for (const r of holding('Team Leader')) {
    const section = local(sections, r.section)
    const department = section && local(departments, section.department)
    const boss = text(r.reports_to)
    const theirs = managed(boss, 'Department Manager')
    if (!section || !department || !boss || !theirs.length) continue
    if (!theirs.some(m => text(m.department) === id(department))) {
      const names = theirs.map(m => local(departments, m.department)).filter(Boolean).map(d => deptName(d!)).sort().join(', ')
      add('team_leader_outside_department', `${name(text(r.person))} leads ${text(section.section_name)} (${deptName(department)}) but reports to ${name(boss)}, Department Manager of ${names}`, [id(r)])
    }
  }
  // Each Department Manager assignment against its own reporting line.
  for (const r of holding('Department Manager')) {
    const boss = text(r.reports_to)
    const theirs = boss ? managed(boss, 'Floor Manager') : []
    const department = local(departments, r.department)
    if (!theirs.length || !department) continue
    const floorsHeld = storeSections.filter(s => text(s.department) === id(department)).map(s => text(s.floor))
    if (!theirs.some(f => floorsHeld.includes(text(f.floor)))) {
      const floorNames = theirs.map(f => local(floors, f.floor)).filter(Boolean).map(f => text(f!.floor_name)).sort().join(', ')
      add('department_manager_outside_floors', `${name(text(r.person))} manages ${deptName(department)} but reports to ${name(boss)}, Floor Manager of ${floorNames}, which holds none of its sections`, [id(r)])
    }
  }

  // Placements: one owning section per subcategory at any date.
  const placements = mine(chart.placements)
  placements.forEach((a, i) => placements.slice(i + 1).forEach(b => {
    if (text(a.subcategory) === text(b.subcategory) && overlap(a, b))
      add('overlapping_placement', `Subcategory ${text(a.subcategory)} is placed in ${text(sections.get(text(a.section))?.section_name)} and ${text(sections.get(text(b.section))?.section_name)} on overlapping dates`, [id(a), id(b)])
  }))

  // One store at a time: two overlapping jobs in different stores are allowed only when both are Cluster Manager.
  const cluster = (r: Row) => text(r.job) === 'Cluster Manager'
  for (const person of new Set(storeJobs.map(r => text(r.person)))) {
    const rows = chart.jobs.filter(r => text(r.person) === person)
    const clash = (a: Row, b: Row) => exact(b.store) !== exact(a.store) && overlap(a, b) && !(cluster(a) && cluster(b))
    const here = rows.filter(r => exact(r.store) === store && rows.some(o => clash(r, o)))
    const elsewhere = rows.filter(r => here.some(h => clash(h, r)))
    for (const other of new Set(elsewhere.map(r => exact(r.store))))
      add('several_stores_at_once', `${name(person)} holds jobs in ${[store, other].sort().join(' and ')} on overlapping dates`,
        [...here, ...elsewhere.filter(r => exact(r.store) === other)].map(id))
  }

  const managers = holding('Store Manager', false)
  if (managers.length > 1) add('several_store_managers', `${store} has ${managers.length} Store Managers: ${managers.map(r => name(text(r.person))).sort().join(', ')}`, managers.map(id))
  for (const r of current)
    if (!JOB_LEVEL[text(r.job)]) add('unknown_job', `${name(text(r.person))} holds ${text(r.job)}, which no coverage rule knows: it covers nothing`, [id(r)])
  return out
}

/** Section aliases of `store` whose target is not an existing section of that store. Such an alias matches nothing. */
export function aliasConflicts(store: string, aliases: Row[], sections: Row[]): Conflict[] {
  return aliases.filter(a => exact(a.store) === store).flatMap((a): Conflict[] => {
    const target = sections.find(s => id(s) === text(a.section))
    const label = `Section alias "${text(a.alias)}" (${text(a.source)})`
    if (!target) return [{ kind: 'alias_target_invalid', message: `${label} points at a section that does not exist (${text(a.section)})`, rows: [id(a)] }]
    if (exact(target.store) !== store)
      return [{ kind: 'alias_target_invalid', message: `${label} points at ${text(target.section_name)} of store ${exact(target.store)}, not a section of ${store}`, rows: [id(a)] }]
    return []
  })
}

/**
 * Rows whose store code is this store's only after trimming. The provider
 * matches codes exactly, so such a row covers nothing; the save rules refuse
 * it now, but a row saved before them, or written outside them, is listed.
 */
export function storeCodeConflicts(store: string, chart: OrgChart, rollout: Row[], aliases: Row[]): Conflict[] {
  const sets: [string, Row[], (r: Row) => string][] = [
    ['Store rollout row', rollout, () => ''], ['Floor', chart.floors, r => text(r.floor_name)],
    ['Department', chart.departments, r => text(r.name) || text(r.department_key)], ['Section', chart.sections, r => text(r.section_name)],
    ['Placement of subcategory', chart.placements, r => text(r.subcategory)], ['Job assignment', chart.jobs, r => `${text(r.job)} for ${text(r.person)}`],
    ['Section alias', aliases, r => text(r.alias)],
  ]
  return sets.flatMap(([what, rows, show]) => rows.filter(r => text(r.store) === store && exact(r.store) !== store).map((r): Conflict => ({
    kind: 'store_code_not_canonical',
    message: `${[what, show(r)].filter(Boolean).join(' ')} has store code ${JSON.stringify(exact(r.store))}, not ${JSON.stringify(store)}: it covers nothing until corrected`,
    rows: [id(r)],
  })))
}
