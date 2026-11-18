// #1223: the part of a store each manager looks after, worked out in one place for Your store /
// floor / department / sections, for Move and its approval, and for What they cover. Read from the
// person's own in-force jobs, as reach reads them (holdsOn); never from the page.
//   Store Manager       their whole store
//   Floor Manager       the sections on their floor
//   Department Manager  the sections their in-force department links name, at its own store
//   Team Leader         their own sections; they move Staff only
import { EMPLOYEE_STATUS, exact, holdsOn, text } from './values.ts'
import { JOB_FIELDS, SECTION_FIELDS, T, all, list, type Row } from './my-sections.ts'
import { BUSINESS_ROLES, accessSource, liveBusinessAccess } from './access-source.ts'
import type { Base } from './business-access.ts'
import { DASH_APP } from './business-roles.ts'
import { SECTIONS_THING } from './starting-roles.ts'

type Ctx = Parameters<typeof list>[0]
export const DEPARTMENT = 'Department'
export const DEPARTMENT_SECTION = 'Department Section'
const DEPARTMENT_FIELDS = ['department_id', 'store', 'name', 'manager', 'starts_on', 'ends_on']
const LINK_FIELDS = ['store', 'department', 'section', 'starts_on', 'ends_on']

export interface Area {
  kind: 'store' | 'floor' | 'department' | 'section'
  /** The manager's job that gives the area (one of them, for a Team Leader with several sections). */
  job: string
  site: string
  floor: string | null
  /** The sections a department or a Team Leader's area holds; null for a store or a floor. */
  sections: Set<string> | null
  department: { id: string; name: string } | null
}

/** The jobs whose holder has an area, and the rows that authority rests on (for locking). */
export const MANAGING_JOBS = ['Store Manager', 'Floor Manager', 'Department Manager', 'Team Leader']

/** Whether a section sits in the area. */
export function inArea(area: Area, section: Row | undefined): boolean {
  if (!section || exact(section.site) !== area.site) return false
  if (area.kind === 'store') return true
  if (area.kind === 'floor') return exact(section.floor) === area.floor
  return area.sections!.has(exact(section.row_id))
}

/** Whether a job sits in the area: by its section when it has one, by its floor only when it has none. */
export function jobInArea(area: Area, job: Row, section: Row | undefined): boolean {
  if (exact(job.site) !== area.site) return false
  if (area.kind === 'store') return true
  if (exact(job.section)) return inArea(area, section)
  return area.kind === 'floor' && exact(job.floor) === area.floor
}

/** What a manager may move in the area: never another manager; a Team Leader moves Staff only. */
export const movableIn = (area: Area, job: Row) =>
  area.kind === 'section' ? text(job.job) === 'Staff' : ['Staff', 'Team Leader'].includes(text(job.job))

/** The areas of these staff rows (one person's), on `today`. */
export async function areasFor(ctx: Ctx, employees: Row[], today: string): Promise<Area[]> {
  const ids = employees.map(e => exact(e.row_id))
  if (!ids.length) return []
  const jobs = (await all(ctx, T.job, JOB_FIELDS, [['employee', 'in', ids]])).filter(j => holdsOn(j, today))
  const areas: Area[] = []
  const base = (job: Row) => ({ job: exact(job.row_id), site: exact(job.site), floor: null, sections: null, department: null })
  for (const job of jobs.filter(j => exact(j.site))) {
    const name = text(job.job)
    if (name === 'Store Manager') areas.push({ ...base(job), kind: 'store' })
    else if (name === 'Floor Manager' && exact(job.floor)) areas.push({ ...base(job), kind: 'floor', floor: exact(job.floor) })
  }
  // A Department Manager: each in-force department at this job's store naming them, with its in-force links there.
  const departmentJobs = jobs.filter(j => text(j.job) === 'Department Manager' && exact(j.site))
  if (departmentJobs.length) {
    const departments = (await all(ctx, DEPARTMENT, DEPARTMENT_FIELDS, [['manager', 'in', ids]])).filter(d => holdsOn(d, today))
    const links = departments.length ? (await all(ctx, DEPARTMENT_SECTION, LINK_FIELDS, [['department', 'in', departments.map(d => exact(d.row_id))]])).filter(l => holdsOn(l, today)) : []
    for (const job of departmentJobs)
      for (const d of departments.filter(d => exact(d.store) === exact(job.site)))
        areas.push({ ...base(job), kind: 'department', department: { id: exact(d.row_id), name: text(d.name) },
          sections: new Set(links.filter(l => exact(l.department) === exact(d.row_id) && exact(l.store) === exact(d.store)).map(l => exact(l.section))) })
  }
  // A Team Leader: their sections at each store, as one area per store.
  const bySite = new Map<string, Row[]>()
  for (const job of jobs.filter(j => text(j.job) === 'Team Leader' && exact(j.section) && exact(j.site))) bySite.set(exact(job.site), [...(bySite.get(exact(job.site)) ?? []), job])
  for (const [site, held] of bySite)
    areas.push({ kind: 'section', job: exact(held[0].row_id), site, floor: null, sections: new Set(held.map(j => exact(j.section))), department: null })
  return businessRolesAllow(ctx, employees, today, areas, jobs)
}

/** How wide each Reaches is, for whether a role covers an area its job gives. */
const WIDTH: Record<string, number> = { Section: 1, Floor: 2, Department: 2, Store: 3, Cluster: 4, 'Whole company': 5 }
/** How wide a role must reach to edit sections in an area of each kind. */
const NEEDS: Record<Area['kind'], number> = { section: 1, floor: 2, department: 2, store: 3 }

/**
 * #1277 (owner, 18-Nov-2026): when business roles decide, the jobs from which a person may edit a section's name and
 * which subcategories sit under it, each with how wide the widest such role reaches: a role holding the Dash
 * permission Edit Section names and subcategories, coming from that very job (from their HR title, or corrected or
 * also given by hand at that job, at its own store). Null under the old rules: the jobs alone decide.
 */
export async function sectionEditingJobs(ctx: Ctx, person: string, today: string, jobs: Row[]): Promise<Map<string, number> | null> {
  const base = ctx.baseTables as unknown as Base
  if (await accessSource(base) !== BUSINESS_ROLES) return null
  const allowed = new Map<string, number>()
  if (!person) return allowed
  const { access, model } = await liveBusinessAccess(base, person, today)
  const edits = new Set(model.permissions.filter(p => p.app === DASH_APP && p.verb === 'Edit' && p.thing === SECTIONS_THING).map(p => p.role))
  const reaches = new Map(model.roles.map(r => [r.id, WIDTH[r.reaches ?? ''] ?? 0]))
  const siteOf = new Map(jobs.map(j => [exact(j.row_id), exact(j.site)]))
  for (const h of access.held) {
    // A hand change naming another store puts the role there, not at the job's own store: that job's area doesn't count.
    if (!edits.has(h.role) || h.spot.kind !== 'job' || (h.spot.site && h.spot.site !== siteOf.get(h.spot.job))) continue
    allowed.set(h.spot.job, Math.max(allowed.get(h.spot.job) ?? 0, reaches.get(h.role) ?? 0))
  }
  return allowed
}

/**
 * Under business roles an area stays only when a role from its job may edit sections and reaches at least as wide
 * as the area (a Store Manager corrected to Floor Manager keeps no store-wide area). This only narrows.
 */
async function businessRolesAllow(ctx: Ctx, employees: Row[], today: string, areas: Area[], jobs: Row[]): Promise<Area[]> {
  if (!areas.length) return areas
  const allowed = await sectionEditingJobs(ctx, exact(employees[0]?.person), today, jobs)
  if (!allowed) return areas
  // A Team Leader's area stands for every section job at that store; any one of them carrying the permission keeps it.
  const jobsOf = (area: Area) => area.kind === 'section' ? jobs.filter(j => text(j.job) === 'Team Leader' && exact(j.site) === area.site).map(j => exact(j.row_id)) : [area.job]
  return areas.filter(area => jobsOf(area).some(job => (allowed.get(job) ?? 0) >= NEEDS[area.kind]))
}

/** Under business roles, whether this job of theirs lets the person change their own section's subcategories (Your sections). */
export async function mayEditOwnSection(ctx: Ctx, person: string, job: Row, today: string): Promise<boolean> {
  const allowed = await sectionEditingJobs(ctx, person, today, [job])
  return !allowed || (allowed.get(exact(job.row_id)) ?? 0) >= NEEDS.section
}

/** The current staff rows of a person, by their person id. */
export const staffRowsOf = (ctx: Ctx, person: string) =>
  list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', '=', person], [EMPLOYEE_STATUS, '=', 'Current']])

/** Every row a person's authority at a store rests on, so it can be held still while a move is decided:
 *  their staff rows, their managing jobs there, and their departments and department links there. */
export async function authorityRows(ctx: Ctx, person: string, site: string) {
  const employees = await list(ctx, T.employee, ['person'], [['person', '=', person]])
  const ids = employees.map(e => exact(e.row_id))
  const jobs = ids.length ? await all(ctx, T.job, JOB_FIELDS, [['employee', 'in', ids], ['site', '=', site], ['job', 'in', MANAGING_JOBS]]) : []
  const departments = ids.length ? await all(ctx, DEPARTMENT, DEPARTMENT_FIELDS, [['manager', 'in', ids], ['store', '=', site]]) : []
  const links = departments.length ? await all(ctx, DEPARTMENT_SECTION, LINK_FIELDS, [['department', 'in', departments.map(d => exact(d.row_id))]]) : []
  return { jobs: jobs.map(j => exact(j.row_id)), employees: ids, departments: departments.map(d => exact(d.row_id)), links: links.map(l => exact(l.row_id)) }
}

/** Whether `person` may move `job` to `destination` today: one of their areas holds both ends and lets them move it. */
export async function mayMove(ctx: Ctx, person: string, job: Row, destination: Row | undefined, today: string): Promise<boolean> {
  const employees = await staffRowsOf(ctx, person)
  if (employees.some(e => exact(e.row_id) === exact(job.employee))) return false
  const areas = await areasFor(ctx, employees, today)
  const [from] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
  return areas.some(a => jobInArea(a, job, from) && inArea(a, destination) && movableIn(a, job))
}

/** Whether `person` may change which subcategories sit in `section` today: it lies in their store, floor
 *  or department. A Team Leader changes their own sections on Your sections instead. Returns the area. */
export async function sectionAreaOf(ctx: Ctx, person: string, section: Row | undefined, today: string, alsoHolding: Row[] = []): Promise<Area | undefined> {
  if (!section) return undefined
  const areas = await areasFor(ctx, await staffRowsOf(ctx, person), today)
  // A subcategory moved from another section: one area must hold both, so no manager empties a section outside theirs.
  return areas.find(a => a.kind !== 'section' && inArea(a, section) && alsoHolding.every(other => inArea(a, other)))
}
