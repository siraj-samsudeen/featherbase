// Dash's scope provider: the places a person covers, from the core Tables. The platform calls it
// fresh on every person_scope request and reads only the Tables declared here, which it names
// in `unmarkedTables` so role grants decide who edits them (#967). An empty answer is an empty scope, which the platform reads as
// no access. Who sees what is #967's table; `reachOf` is the one place it is written.
import { EMPLOYEE_STATUS, checked, day, exact, holdsOn, text } from './values.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
/** The platform's document reads, and an app's base Table reads, as far as this file uses them. */
export interface Documents {
  list(table: string, args: { fields: string[]; filters?: Filter[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
}
interface ProviderContext {
  /** `roles`: the roles the platform enforces for the person (featherbase #1192). */
  readonly person: { readonly id: string; readonly email: string | null; readonly roles?: readonly string[] }
  readonly documents: Documents
}
export interface Reason { text: string; since?: string; until?: string }

export interface Place {
  label: string
  filters: Record<string, string[]>
  basis?: string
  /** Why the person has the place, and from and to when. */
  reasons?: Reason[]
}

const T = { employee: 'Employee', job: 'Job Assignment', site: 'Site', plant: 'Plant', section: 'Section', placement: 'Section Subcategory',
  merchandise: 'Merchandise Assignment', subcategory: 'Subcategory', department: 'Department', departmentSection: 'Department Section' } as const

/** Every Table the provider reads: featherbase.json's scopeProvider.tables. */
export const PROVIDER_TABLES: string[] = Object.values(T)

/** The columns the provider reads, Table by Table. */
export const PROVIDER_FIELDS: Record<string, string[]> = {
  [T.employee]: ['person', EMPLOYEE_STATUS],
  [T.job]: ['employee', 'job', 'site', 'floor', 'section', 'acting', 'starts_on', 'ends_on'],
  [T.site]: ['name', 'is_store', 'cluster', 'operating_region'],
  [T.plant]: ['site', 'plant_type'],
  [T.section]: ['name', 'site', 'floor'],
  [T.placement]: ['store', 'section', 'subcategory', 'starts_on', 'ends_on'],
  [T.merchandise]: ['employee', 'responsibility', 'division', 'subdivision', 'category', 'subcategory', 'operating_region', 'starts_on', 'ends_on'],
  [T.subcategory]: ['division', 'subdivision', 'category', 'subcategory_type'],
  [T.department]: ['store', 'manager', 'starts_on', 'ends_on'],
  [T.departmentSection]: ['store', 'department', 'section', 'starts_on', 'ends_on'],
}

const PAGE = 500
/** Every row of a list: at most 500 a call, in row_id order so pages neither skip nor repeat. Reads are one at a time, as the platform requires. */
async function all(documents: Documents, table: string, filters: Filter[] = []): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields: ['row_id', ...PROVIDER_FIELDS[table]], order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const id = (row: Row) => exact(row.row_id)

/** Today in India Standard Time. */
function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

/** The label of a section's place; the report reads a section's name back from it. */
export const sectionLabel = (store: string, section: string) => `${store} / Section: ${section}`

/** The label of a store's assigned subcategories: never a section's, so the page names no section for them. */
export const assignedLabel = (store: string) => `${store} / Assigned subcategories`

/** Why someone's job gives them no place: the page says so plainly. */
export type NoReach = 'no_job' | 'no_section' | 'departments_not_filled' | 'store_sections_not_set_up' | 'head_office' | 'no_cluster' | 'nothing_placed' | 'nothing_assigned'

export interface Reach {
  places: Place[]
  /** Why each job that reaches nothing does; empty when everything reaches something. */
  problems: NoReach[]
}

const BASIS: Record<string, string> = {
  'Staff': 'section_staff', 'Team Leader': 'team_leader', 'Floor Manager': 'floor_manager', 'Department Manager': 'department_manager',
  'Store Manager': 'store_manager', 'Cluster Manager': 'cluster_manager', 'Chief Operating Officer': 'chief_operating_officer',
  'Director': 'director', 'Managing Director': 'managing_director',
}
const EVERY_STORE = new Set(['Director', 'Managing Director', 'Chief Operating Officer'])
/** #1192 (owner, 11-Nov-2026): the role that reaches every store, as an every-store job does, for head-office staff. */
export const ALL_STORES_ROLE = 'Dash All-Stores Reader'
/** The plant types a store sells through, which a site's readers reach. */
const SOLD_THROUGH = ['Store', 'Shop-in-shop', 'E-commerce fulfilment']

class Places {
  private merged = new Map<string, { store: string; codes: Set<string> | null; basis: Set<string>; reasons: Map<string, Reason> }>()
  add(label: string, store: string, codes: string[] | null, basis: string, reason: Reason) {
    const place = this.merged.get(label) ?? { store, codes: codes ? new Set<string>() : null, basis: new Set<string>(), reasons: new Map<string, Reason>() }
    if (codes && place.codes) for (const code of codes) place.codes.add(code)
    place.basis.add(basis)
    place.reasons.set(JSON.stringify(reason), reason)
    this.merged.set(label, place)
  }
  list(): Place[] {
    return [...this.merged].sort(([a], [b]) => a.localeCompare(b)).map(([label, place]) => ({
      label,
      filters: { store: [place.store], ...(place.codes ? { subcategory: [...place.codes].sort() } : {}) },
      basis: [...place.basis].sort().join(', '),
      reasons: [...place.reasons].sort(([a], [b]) => a.localeCompare(b)).map(([, reason]) => reason),
    }))
  }
}

const basisOf = (job: Row) => `${checked(job.acting) ? 'acting_' : ''}${BASIS[exact(job.job)]}`
const reasonOf = (job: Row): Reason => ({ text: `${checked(job.acting) ? 'Acting ' : ''}${exact(job.job)} job assignment`, since: day(job.starts_on),
  ...(day(job.ends_on) ? { until: day(job.ends_on) } : {}) })

/** A Merchandise Assignment's level, most specific first: the deepest link filled decides what it covers. */
const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const

/** What `person`, holding `roles`, reaches on `on`, by the who-sees-what table in #967. */
export async function reachOf(documents: Documents, person: string, on: string, roles: readonly string[] = []): Promise<Reach> {
  const employees = (await all(documents, T.employee, [['person', '=', person]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  const mine: Filter[] = [['employee', 'in', employees.map(id)]]
  const jobs = employees.length ? (await all(documents, T.job, mine)).filter(row => holdsOn(row, on)) : []
  // rama_dw #4588: buyers, category heads and the heads above them, from their Merchandise Assignments.
  const assignments = employees.length ? (await all(documents, T.merchandise, mine)).filter(row => holdsOn(row, on)) : []
  const everyStore = roles.includes(ALL_STORES_ROLE)
  if (!jobs.length && !assignments.length && !everyStore) return { places: [], problems: ['no_job'] }

  const sites = await all(documents, T.site)
  const stores = sites.filter(site => checked(site.is_store))
  const siteOf = new Map(sites.map(site => [id(site), site]))
  // #1155 (owner, 10-Nov-2026): a site's readers reach every plant on it that sells: Store,
  // Shop-in-shop (a Gold House inside it) and E-commerce fulfilment. A warehouse sells nothing. A
  // retired plant the platform's reads leave out. Plant.is_active waits for every instance to have
  // the column (#1161): a provider read that fails refuses every reader.
  const plantsOf = new Map<string, string[]>()
  for (const plant of await all(documents, T.plant, [['plant_type', 'in', SOLD_THROUGH]]))
    plantsOf.set(exact(plant.site), [...(plantsOf.get(exact(plant.site)) ?? []), id(plant)])

  const places = new Places()
  const problems: NoReach[] = []
  if (everyStore)
    for (const store of stores) for (const plant of plantsOf.get(id(store)) ?? []) places.add(plant, plant, null, 'all_stores_reader', { text: `${ALL_STORES_ROLE} role` })
  const sectionJobs: { job: Row; sections: Row[] }[] = []
  for (const job of jobs) {
    const name = exact(job.job)
    const site = exact(job.site)
    const reason = reasonOf(job)
    const whole = (sitesCovered: Row[]) => {
      for (const covered of sitesCovered)
        for (const plant of plantsOf.get(id(covered)) ?? []) places.add(plant, plant, null, basisOf(job), reason)
    }
    if (name === 'Staff' || name === 'Team Leader') {
      if (!exact(job.section)) { problems.push('no_section'); continue }
      sectionJobs.push({ job, sections: await all(documents, T.section, [['row_id', '=', exact(job.section)]]) })
    } else if (name === 'Floor Manager') {
      if (!exact(job.floor)) { problems.push('no_section'); continue }
      sectionJobs.push({ job, sections: await all(documents, T.section, [['floor', '=', exact(job.floor)]]) })
    } else if (name === 'Department Manager') {
      // #1195: the sections of the department they manage at this job's store, on the day.
      const departments = (await all(documents, T.department, [['manager', 'in', employees.map(id)], ['store', '=', site]])).filter(row => holdsOn(row, on))
      const links = departments.length
        ? (await all(documents, T.departmentSection, [['department', 'in', departments.map(id)], ['store', '=', site]])).filter(row => holdsOn(row, on))
        : []
      if (!links.length) {
        const storeHasSections = (await all(documents, T.section, [['site', '=', site]])).length > 0
        problems.push(storeHasSections ? 'departments_not_filled' : 'store_sections_not_set_up')
        continue
      }
      sectionJobs.push({ job, sections: await all(documents, T.section, [['row_id', 'in', links.map(row => exact(row.section))]]) })
    } else if (name === 'Store Manager') {
      whole(sites.filter(row => id(row) === site))
    } else if (name === 'Cluster Manager') {
      const cluster = exact(siteOf.get(site)?.cluster)
      if (!cluster) { problems.push('no_cluster'); continue }
      whole(stores.filter(row => exact(row.cluster) === cluster))
    } else if (EVERY_STORE.has(name)) {
      whole(stores)
    } else {
      problems.push('head_office')
    }
  }

  if (assignments.length) {
    // Buyers buy merchandise only: a consumable or service under the same category stays out.
    const subcategories = await all(documents, T.subcategory, [['subcategory_type', '=', 'Merchandise']])
    for (const assignment of assignments) {
      const level = LEVELS.find(column => exact(assignment[column]))
      const named = level && exact(assignment[level])
      const codes = !named ? [] : level === 'subcategory'
        ? subcategories.filter(row => id(row) === named).map(id)
        : subcategories.filter(row => exact(row[level]) === named).map(id)
      const region = exact(assignment.operating_region)
      const covered = stores.filter(site => !region || exact(site.operating_region) === region)
      const plants = covered.flatMap(site => plantsOf.get(id(site)) ?? [])
      if (!codes.length || !plants.length) { problems.push('nothing_assigned'); continue }
      const reason: Reason = { text: `${exact(assignment.responsibility)} merchandise assignment`, since: day(assignment.starts_on),
        ...(day(assignment.ends_on) ? { until: day(assignment.ends_on) } : {}) }
      for (const plant of plants) places.add(assignedLabel(plant), plant, codes, 'assignment', reason)
    }
  }

  for (const { job, sections } of sectionJobs) {
    const reason = reasonOf(job)
    let reached = false
    for (const section of sections) {
      // A section on another site's job row reaches nothing: the store on the job decides.
      const plants = plantsOf.get(exact(section.site)) ?? []
      if (!plants.length || exact(section.site) !== exact(job.site)) continue
      const codes = (await all(documents, T.placement, [['section', '=', id(section)]]))
        .filter(row => holdsOn(row, on) && exact(row.store) === exact(section.site)).map(row => exact(row.subcategory))
      if (!codes.length) continue
      for (const plant of plants) places.add(sectionLabel(plant, text(section.name)), plant, codes, basisOf(job), reason)
      reached = true
    }
    if (!reached) problems.push('nothing_placed')
  }
  // Every store is reached: no job's shortfall is worth telling them.
  const list = places.list()
  return { places: list, problems: everyStore && list.length ? [] : [...new Set(problems)] }
}

export interface ProviderOptions { today?: () => string }

export function orgChartProvider({ today = istToday }: ProviderOptions = {}) {
  return async function orgChart({ person, documents }: ProviderContext): Promise<Place[]> {
    return (await reachOf(documents, person.id, today(), person.roles)).places
  }
}
