// Coverage on the new org chart (featherbase#630 D6): worked out from a
// person's job assignments current on a date, never stored. Every job matches
// within its own store: a link to another store's floor, department or section
// covers nothing (it is on the conflict list). Conflicts never change coverage.
import { checked, exact, holdsOn, text } from './values.ts'

export type Row = Record<string, unknown>

/** The org chart rows coverage reads, for the stores in question. */
export interface OrgChart {
  floors: Row[]
  departments: Row[]
  sections: Row[]
  placements: Row[]
  jobs: Row[]
}

/** One unit of the layout a person covers, from one job assignment. */
export interface CoveredUnit {
  store: string
  kind: 'store' | 'floor' | 'department' | 'section'
  /** The floor, department or section row; empty for a whole store. */
  unit: string
  unitName: string
  job: string
  acting: boolean
  jobRow: string
  wholeStore: boolean
  /** The sections covered, by row id. */
  sections: string[]
  /** The subcategories those sections own on the date. */
  subcategories: string[]
}

type Kind = CoveredUnit['kind']
/** Each job's coverage rule: the level of the layout it is assigned to. */
export const JOB_LEVEL: Record<string, Kind> = {
  'Store Manager': 'store',
  'Cluster Manager': 'store',
  'Floor Manager': 'floor',
  'Department Manager': 'department',
  'Team Leader': 'section',
  'Staff': 'section',
}

const id = (row: Row) => exact(row.row_id)
// Codes and ids match exactly as stored, as the provider's filters match them.
const sameStore = (row: Row, store: string) => exact(row.store) === store

/** The subcategories each section owns on `on`, keyed by section row id. */
export function ownedOn(chart: OrgChart, on: string): Map<string, string[]> {
  const owned = new Map<string, string[]>()
  for (const placement of chart.placements) {
    if (!holdsOn(placement, on)) continue
    const section = chart.sections.find(s => id(s) === exact(placement.section))
    // A placement in another store's section credits nothing (a conflict).
    if (!section || !sameStore(section, exact(placement.store))) continue
    owned.set(id(section), [...(owned.get(id(section)) ?? []), exact(placement.subcategory)])
  }
  return owned
}

/** The current job rows of a person on a date. */
export function currentJobs(chart: OrgChart, person: string, on: string): Row[] {
  return chart.jobs.filter(row => exact(row.person) === person && holdsOn(row, on))
}

/** What `person` covers on `on`: one unit per current job assignment that reaches anything. */
export function coverageOf(person: string, chart: OrgChart, on: string): CoveredUnit[] {
  const owned = ownedOn(chart, on)
  const units: CoveredUnit[] = []
  for (const row of currentJobs(chart, person, on)) {
    const store = exact(row.store)
    const job = exact(row.job)
    const kind = JOB_LEVEL[job]
    if (!kind) continue
    const inStore = chart.sections.filter(s => sameStore(s, store))
    let unit = ''
    let unitName = store
    let sections: Row[] = inStore
    if (kind !== 'store') {
      unit = exact(row[kind])
      const table = kind === 'floor' ? chart.floors : kind === 'department' ? chart.departments : chart.sections
      const target = table.find(r => id(r) === unit && sameStore(r, store))
      if (!target) continue
      unitName = kind === 'floor' ? text(target.floor_name)
        : kind === 'department' ? text(target.name) || text(target.department_key) : text(target.section_name)
      sections = kind === 'section' ? [target] : inStore.filter(s => exact(s[kind]) === unit)
    }
    const sectionIds = sections.map(id).sort()
    units.push({ store, kind, unit, unitName, job, acting: checked(row.acting), jobRow: id(row), wholeStore: kind === 'store',
      sections: sectionIds, subcategories: [...new Set(sectionIds.flatMap(s => owned.get(s) ?? []))].sort() })
  }
  return units
}

