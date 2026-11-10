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
  readonly person: { readonly id: string; readonly email: string | null }
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

const T = { employee: 'Employee', job: 'Job Assignment', site: 'Site', plant: 'Plant', section: 'Section', placement: 'Section Subcategory' } as const

/** Every Table the provider reads: featherbase.json's scopeProvider.tables. */
export const PROVIDER_TABLES: string[] = Object.values(T)

/** The columns the provider reads, Table by Table. */
export const PROVIDER_FIELDS: Record<string, string[]> = {
  [T.employee]: ['person', EMPLOYEE_STATUS],
  [T.job]: ['employee', 'job', 'site', 'floor', 'section', 'acting', 'starts_on', 'ends_on'],
  [T.site]: ['name', 'is_store', 'cluster'],
  [T.plant]: ['site', 'plant_type'],
  [T.section]: ['name', 'site', 'floor'],
  [T.placement]: ['store', 'section', 'subcategory', 'starts_on', 'ends_on'],
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

/** Why someone's job gives them no place: the page says so plainly. */
export type NoReach = 'no_job' | 'no_section' | 'departments_not_filled' | 'head_office' | 'no_cluster' | 'nothing_placed'

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
/** The plant types a store sells through, which a site's readers reach. */
const SOLD_THROUGH = ['Store', 'Shop-in-shop']

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

/** What `person` reaches on `on`, by the who-sees-what table in #967. */
export async function reachOf(documents: Documents, person: string, on: string): Promise<Reach> {
  const employees = (await all(documents, T.employee, [['person', '=', person]])).filter(row => text(row[EMPLOYEE_STATUS]) === 'Current')
  const jobs = employees.length
    ? (await all(documents, T.job, [['employee', 'in', employees.map(id)]])).filter(row => holdsOn(row, on))
    : []
  if (!jobs.length) return { places: [], problems: ['no_job'] }

  const sites = await all(documents, T.site)
  const stores = sites.filter(site => checked(site.is_store))
  const siteOf = new Map(sites.map(site => [id(site), site]))
  // A store sells through its Store plants and, the owner decided on 10-Nov-2026, its Shop-in-shop
  // plants (a Gold House inside it): a site's readers reach each of them (#1155). A warehouse or an
  // e-commerce fulfilment plant holds no store's sales; whether its readers reach the latter is open.
  const plantsOf = new Map<string, string[]>()
  for (const plant of await all(documents, T.plant, [['plant_type', 'in', SOLD_THROUGH]]))
    plantsOf.set(exact(plant.site), [...(plantsOf.get(exact(plant.site)) ?? []), id(plant)])

  const places = new Places()
  const problems: NoReach[] = []
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
      problems.push('departments_not_filled')
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
  return { places: places.list(), problems: [...new Set(problems)] }
}

export interface ProviderOptions { today?: () => string }

export function orgChartProvider({ today = istToday }: ProviderOptions = {}) {
  return async function orgChart({ person, documents }: ProviderContext): Promise<Place[]> {
    return (await reachOf(documents, person.id, today())).places
  }
}
