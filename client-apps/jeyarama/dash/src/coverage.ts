// #1223: what one person, or one department, covers, rolled up across the hops a record page can't
// show: Employee → their jobs → section or floor; Department Manager → Department → Department
// Section → Section → subcategories; buyers and heads → Merchandise Assignment → subcategories.
// The hop rules are reach's (provider.ts reachOf): the same dates (holdsOn) and the same deepest
// merchandise level. Unlike reach, an empty link is kept and named as a gap, which is the point.
import { istToday } from './report.ts'
import { exact, holdsOn, text } from './values.ts'
import { FALLBACK_ROLE, SECTION_FIELDS, T, all, byId, isActive, list, myEmployees, myJobs, unique, type ReadContext, type Row } from './my-sections.ts'
import { areasOf } from './my-store.ts'
import { inArea, jobInArea, type Area } from './areas.ts'

const DEPARTMENT = 'Department'
const DEPARTMENT_SECTION = 'Department Section'
const MERCHANDISE = 'Merchandise Assignment'
const JOB_FIELDS = ['employee', 'job', 'site', 'floor', 'section', 'reports_to', 'starts_on', 'ends_on']
const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const
/** How many subcategory names a merchandise line lists before "and N more". */
const NAMES_SHOWN = 12

export interface SectionCover { id: string; name: string; floor: string | null; floor_id: string | null; active: boolean; subcategories: number }
export interface DepartmentCover { id: string; name: string; store: string; store_id: string; manager: string | null; manager_code: string | null; sections: SectionCover[]; gaps: string[] }
export interface JobCover { job: string; job_id: string | null; store: string; store_id: string | null; floor: string | null; floor_id: string | null; reports_to: string | null; reports_to_code: string | null; sections: SectionCover[]; departments: DepartmentCover[]; whole_store: boolean; gaps: string[] }
export interface MerchandiseCover { assignment: string; responsibility: string; level: string; named: string; region: string | null; subcategories: { code: string; name: string }[]; more: number; gaps: string[] }

/** Sections at `site` with their in-force subcategory counts and floor names. A link to a section of
 *  another store is never followed, as reach never follows it: it is counted in `elsewhere` instead. */
async function sectionCovers(ctx: ReadContext, ids: string[], today: string, site: string, within?: Area[]): Promise<SectionCover[] & { elsewhere?: number }> {
  if (!ids.length) return []
  const found = await all(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', ids]])
  const atSite = found.filter(s => exact(s.site) === site)
  const elsewhere = found.length - atSite.length
  // An area viewer sees only sections inside their own area, whichever path led here (#1223, Codex 11–14).
  const sections = within ? atSite.filter(s => within.some(a => inArea(a, s))) : atSite
  const floors = byId(await all(ctx, T.floor, ['name'], [['row_id', 'in', unique(sections.map(s => exact(s.floor)))]]))
  const placed = (await all(ctx, T.placement, ['store', 'section', 'subcategory', 'starts_on', 'ends_on'], [['section', 'in', ids]])).filter(p => holdsOn(p, today))
  const covers: SectionCover[] & { elsewhere?: number } = sections.map(s => ({ id: exact(s.row_id), name: text(s.name), floor: text(floors.get(exact(s.floor))?.name) || null, floor_id: exact(s.floor) || null, active: isActive(s),
    subcategories: placed.filter(p => exact(p.section) === exact(s.row_id) && exact(p.store) === exact(s.site)).length }))
    .sort((a, b) => (a.floor ?? '').localeCompare(b.floor ?? '') || a.name.localeCompare(b.name))
  covers.elsewhere = elsewhere
  return covers
}

/** The gap a link to another store's section leaves. */
const elsewhereGap = (sections: { elsewhere?: number }) => sections.elsewhere ? [`${sections.elsewhere} linked ${sections.elsewhere === 1 ? 'section belongs' : 'sections belong'} to another store`] : []

/** Gap lines for sections: closed, or holding no subcategory. */
const sectionGaps = (sections: SectionCover[]) => sections.flatMap(s => [
  ...(!s.active ? [`${s.name} is closed`] : []),
  ...(s.subcategories === 0 ? [`${s.name} · no subcategories`] : []),
])

/** `within`: an area viewer's areas; only the department's sections inside them are returned. */
async function departmentCover(ctx: ReadContext, department: Row, today: string, names: (id: unknown) => Promise<string | null>, within?: Area[]): Promise<DepartmentCover> {
  const links = (await all(ctx, DEPARTMENT_SECTION, ['store', 'department', 'section', 'starts_on', 'ends_on'], [['department', '=', exact(department.row_id)]]))
    .filter(l => holdsOn(l, today) && exact(l.store) === exact(department.store))
  const sections = await sectionCovers(ctx, unique(links.map(l => exact(l.section))), today, exact(department.store), within)
  const [store] = await list(ctx, T.site, ['name'], [['row_id', '=', exact(department.store)]])
  return { id: exact(department.row_id), name: text(department.name) || 'Unnamed department', store: text(store?.name), store_id: exact(department.store), manager: await names(department.manager), manager_code: exact(department.manager) || null,
    sections, gaps: [...(sections.length ? sectionGaps(sections) : sections.elsewhere ? [] : ['No sections are linked to this department']), ...(within ? [] : elsewhereGap(sections))] }
}

/** Who may see whose coverage, and how much: the master data team and the person themselves see it
 *  all ('full'); a Store or Floor Manager sees only the jobs inside their own area ('area'), judged as
 *  Your store judges a staff row; anyone else nothing. */
async function viewOf(ctx: ReadContext, today: string, at: { employee?: string; jobs?: Row[]; department?: Row }):
  Promise<{ kind: 'full' } | { kind: 'area'; jobs: Row[]; areas: Area[] } | { kind: 'none' }> {
  if (ctx.roles?.includes(FALLBACK_ROLE)) return { kind: 'full' }
  const { employees, areas } = await areasOf(ctx, today)
  const mine = new Set(employees.map(e => exact(e.row_id)))
  if (at.employee && mine.has(at.employee)) return { kind: 'full' }
  if (at.department) {
    // Its manager only while it is their area today (areas.ts: the department, their job and its links all in force).
    const managesIt = areas.some(a => a.kind === 'department' && a.department?.id === exact(at.department!.row_id))
    if (managesIt || areas.some(a => a.kind === 'store' && a.site === exact(at.department!.store))) return { kind: 'full' }
    return { kind: 'none' }
  }
  if (!at.jobs?.length || !areas.length) return { kind: 'none' }
  const sections = byId(await all(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', unique(at.jobs.map(j => exact(j.section)))]]))
  const inside = at.jobs.filter(j => areas.some(a => jobInArea(a, j, sections.get(exact(j.section)))))
  return inside.length ? { kind: 'area', jobs: inside, areas } : { kind: 'none' }
}

/** A person in a search result, with the identity line of #1216: code · job · store. */
/** `seen`: for an area search, the jobs the viewer may see, by employee; the line names only those. */
async function identities(ctx: ReadContext, employees: Row[], today: string, seen?: Map<string, Row[]>) {
  if (!employees.length) return []
  const every = (await all(ctx, T.job, JOB_FIELDS, [['employee', 'in', employees.map(e => exact(e.row_id))]])).filter(j => holdsOn(j, today))
  const jobs = seen ? every.filter(j => seen.get(exact(j.employee))?.some(s => exact(s.row_id) === exact(j.row_id)) ?? true) : every
  const sites = byId(jobs.length ? await all(ctx, T.site, ['name'], [['row_id', 'in', unique(jobs.map(j => exact(j.site)))]]) : [])
  return employees.map(e => {
    const job = jobs.find(j => exact(j.employee) === exact(e.row_id))
    return { code: exact(e.row_id), name: text(e.name), line: [exact(e.row_id), text(job?.job), text(sites.get(exact(job?.site))?.name)].filter(Boolean).join(' · ') }
  })
}

export const coverageReads = {
  /** #1223 spec item 15: people to look up by name or code, only those the viewer may see (at most 12). */
  async coverage_people(ctx: ReadContext) {
    const q = String((ctx.payload as { q?: unknown } | undefined)?.q ?? '').trim().toLowerCase()
    if (q.length < 2) return []
    const today = istToday()
    const matches = (e: Row) => text(e.name).toLowerCase().includes(q) || exact(e.row_id).toLowerCase().startsWith(q)
    if (ctx.roles?.includes(FALLBACK_ROLE)) {
      const byName = await list(ctx, T.employee, ['name', 'status'], [['name', 'like', `%${q}%`], ['status', '=', 'Current']], 12)
      const byCode = await list(ctx, T.employee, ['name', 'status'], [['row_id', 'like', `${q}%`], ['status', '=', 'Current']], 12)
      return identities(ctx, [...byId([...byCode, ...byName]).values()].slice(0, 12), today)
    }
    // Everyone else: themselves, and the staff whose job sits in one of their areas.
    const { employees, areas } = await areasOf(ctx, today)
    const sites = unique(areas.map(a => a.site))
    const jobs = sites.length ? (await all(ctx, T.job, JOB_FIELDS, [['site', 'in', sites]])).filter(j => holdsOn(j, today)) : []
    const sections = byId(jobs.length ? await all(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', unique(jobs.map(j => exact(j.section)))]]) : [])
    const inArea = jobs.filter(j => areas.some(a => jobInArea(a, j, sections.get(exact(j.section)))))
    const mine = new Set(employees.map(e => exact(e.row_id)))
    const visible = unique([...mine, ...inArea.map(j => exact(j.employee))])
    const rows = visible.length ? (await all(ctx, T.employee, ['name', 'status'], [['row_id', 'in', visible]])).filter(e => text(e.status) === 'Current' && matches(e)) : []
    // Someone else's line names only their jobs inside my area, never another store's (Codex 24); my own line is mine.
    const seen = new Map<string, Row[]>()
    for (const j of inArea) if (!mine.has(exact(j.employee))) seen.set(exact(j.employee), [...(seen.get(exact(j.employee)) ?? []), j])
    for (const code of mine) seen.delete(code)
    return identities(ctx, rows.sort((a, b) => text(a.name).localeCompare(text(b.name))).slice(0, 12), today, seen)
  },

  /** One employee's or one department's coverage. Payload: { employee } (code) or { department } (id). */
  async coverage(ctx: ReadContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const today = istToday()
    const nameCache = new Map<string, string | null>()
    const names = async (id: unknown) => {
      const key = exact(id)
      if (!key) return null
      if (!nameCache.has(key)) nameCache.set(key, text((await list(ctx, T.employee, ['name'], [['row_id', '=', key]]))[0]?.name) || null)
      return nameCache.get(key)!
    }

    // #1223: one section, for anyone whose area holds it (Team Leaders included) and the master data team.
    if (typeof payload.section === 'string' && payload.section) {
      const [section] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', payload.section]])
      if (!section) return { state: 'not_found' as const }
      if (!ctx.roles?.includes(FALLBACK_ROLE) && !(await areasOf(ctx, today)).areas.some(a => inArea(a, section))) return { state: 'not_allowed' as const }
      const site = exact(section.site)
      const placed = (await all(ctx, T.placement, ['store', 'section', 'subcategory', 'starts_on', 'ends_on'], [['section', '=', exact(section.row_id)], ['store', '=', site]])).filter(p => holdsOn(p, today))
      const subs = placed.length ? byId(await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', unique(placed.map(p => exact(p.subcategory)))]])) : new Map<string, Row>()
      const jobs = (await all(ctx, T.job, JOB_FIELDS, [['section', '=', exact(section.row_id)], ['site', '=', site]])).filter(j => holdsOn(j, today))
      const people = jobs.length ? byId(await all(ctx, T.employee, ['name', 'status'], [['row_id', 'in', unique(jobs.map(j => exact(j.employee)))]])) : new Map<string, Row>()
      const staff = jobs.filter(j => text(people.get(exact(j.employee))?.status) === 'Current')
        .map(j => ({ code: exact(j.employee), name: text(people.get(exact(j.employee))?.name) || 'Unnamed', job: text(j.job) }))
        .sort((a, b) => a.job.localeCompare(b.job) || a.name.localeCompare(b.name))
      const [store] = await list(ctx, T.site, ['name'], [['row_id', '=', site]])
      const [floor] = exact(section.floor) ? await list(ctx, T.floor, ['name'], [['row_id', '=', exact(section.floor)]]) : []
      const subcategories = placed.map(p => ({ code: exact(p.subcategory), name: text(subs.get(exact(p.subcategory))?.subcategory) || 'Unnamed subcategory' })).sort((a, b) => a.name.localeCompare(b.name))
      const leaders = staff.filter(s => s.job === 'Team Leader')
      return { state: 'ok' as const, kind: 'section' as const, section: { id: exact(section.row_id), name: text(section.name), active: isActive(section),
        store: text(store?.name), store_id: site, floor: text(floor?.name) || null, floor_id: exact(section.floor) || null, subcategories, staff,
        gaps: [...(!isActive(section) ? ['Closed'] : []), ...(isActive(section) && !leaders.length ? ['No Team Leader'] : []), ...(!subcategories.length ? ['No subcategories'] : [])] } }
    }

    if (typeof payload.department === 'string' && payload.department) {
      const [department] = await list(ctx, DEPARTMENT, ['department_id', 'store', 'name', 'manager', 'starts_on', 'ends_on'], [['row_id', '=', payload.department]])
      if (!department) return { state: 'not_found' as const }
      if ((await viewOf(ctx, today, { department })).kind === 'none') return { state: 'not_allowed' as const }
      const cover = await departmentCover(ctx, department, today, names)
      return { state: 'ok' as const, kind: 'department' as const, department: { ...cover, ended: !holdsOn(department, today) } }
    }

    // Without an employee named, a person sees their own.
    const code = typeof payload.employee === 'string' && payload.employee ? payload.employee : exact((await myEmployees(ctx))[0]?.row_id)
    if (!code) return { state: 'not_found' as const }
    const [employee] = await list(ctx, T.employee, ['name', 'status'], [['row_id', '=', code]])
    if (!employee) return { state: 'not_found' as const }
    // A leaver covers nothing, as reach reads them: their open rows are not current coverage.
    const current = text(employee.status) === 'Current'
    const held = current ? (await all(ctx, T.job, JOB_FIELDS, [['employee', '=', code]])).filter(j => holdsOn(j, today)) : []
    const view = await viewOf(ctx, today, { employee: code, jobs: held })
    if (view.kind === 'none') return { state: 'not_allowed' as const }
    // A manager sees only the jobs inside their own area: never another store's, nor a buyer's merchandise.
    const jobs = view.kind === 'area' ? view.jobs : held
    const full = view.kind === 'full'

    const sites = byId(jobs.length ? await all(ctx, T.site, ['name'], [['row_id', 'in', unique(jobs.map(j => exact(j.site)))]]) : [])
    const floorNames = byId(jobs.some(j => exact(j.floor)) ? await all(ctx, T.floor, ['name'], [['row_id', 'in', unique(jobs.map(j => exact(j.floor)))]]) : [])
    const managed = jobs.length ? (await all(ctx, DEPARTMENT, ['department_id', 'store', 'name', 'manager', 'starts_on', 'ends_on'], [['manager', '=', code]])).filter(d => holdsOn(d, today)) : []
    const within = view.kind === 'area' ? view.areas : undefined
    const jobCovers: JobCover[] = []
    for (const job of jobs) {
      const name = text(job.job)
      const site = exact(job.site)
      const base = { job: name, job_id: exact(job.row_id), store: text(sites.get(site)?.name), store_id: site, floor: text(floorNames.get(exact(job.floor))?.name) || null, floor_id: exact(job.floor) || null,
        reports_to: await names(job.reports_to), reports_to_code: exact(job.reports_to) || null,
        sections: [] as SectionCover[], departments: [] as DepartmentCover[], whole_store: false, gaps: [] as string[] }
      if (name === 'Staff' || name === 'Team Leader') {
        const covers = await sectionCovers(ctx, exact(job.section) ? [exact(job.section)] : [], today, site, within)
        base.sections = covers
        base.gaps = exact(job.section) ? [...sectionGaps(covers), ...elsewhereGap(covers)] : ['No section is set against this job']
      } else if (name === 'Floor Manager') {
        const onFloor = exact(job.floor) ? await all(ctx, T.section, ['floor'], [['floor', '=', exact(job.floor)]]) : []
        base.sections = await sectionCovers(ctx, onFloor.map(s => exact(s.row_id)), today, site, within)
        base.gaps = !exact(job.floor) ? ['No floor is set against this job'] : base.sections.length ? sectionGaps(base.sections) : ['No sections on this floor']
      } else if (name === 'Department Manager') {
        for (const department of managed.filter(d => exact(d.store) === site))
          base.departments.push(await departmentCover(ctx, department, today, names, within))
        base.gaps = base.departments.length ? [] : ['No department at this store names them as its manager']
      } else if (name === 'Cluster Manager') {
        // As reach: the job site's cluster, else a Cluster row naming them; neither is a gap, not whole coverage.
        const [at] = await list(ctx, T.site, ['cluster'], [['row_id', '=', site]])
        const named = (await all(ctx, 'Cluster', ['cluster_manager'], [['cluster_manager', '=', code]])).length > 0
        if (exact(at?.cluster) || named) base.whole_store = true
        else base.gaps = ['This site belongs to no cluster, and no cluster names them as its head']
      } else if (name === 'Store Manager' || ['Director', 'Managing Director', 'Chief Operating Officer'].includes(name)) {
        base.whole_store = true
      } else {
        base.gaps = ['A head-office job: it covers no section']
      }
      jobCovers.push(base)
    }

    // A named cluster head covers their cluster's stores whole, as reach reads it (rama_dw #4588).
    if (current && full) for (const cluster of await all(ctx, 'Cluster', ['cluster_manager'], [['cluster_manager', '=', code]]))
      jobCovers.push({ job: `Named head of cluster ${exact(cluster.row_id)}`, job_id: null, store: 'Every store in the cluster', store_id: null, floor: null, floor_id: null, reports_to: null, reports_to_code: null,
        sections: [], departments: [], whole_store: true, gaps: [] })

    // Buyers and heads: the deepest level named decides, as reach reads it. Shown in full views only.
    const merchandise: MerchandiseCover[] = []
    const assignments = current && full ? (await all(ctx, MERCHANDISE, ['employee', 'responsibility', ...LEVELS, 'operating_region', 'starts_on', 'ends_on'], [['employee', '=', code]])).filter(r => holdsOn(r, today)) : []
    for (const a of assignments) {
      const level = LEVELS.find(l => exact(a[l]))
      const named = level ? exact(a[level]) : ''
      const subs = !level ? [] : await all(ctx, T.subcategory, ['subcategory', 'subcategory_type'],
        [[level === 'subcategory' ? 'row_id' : level, '=', named], ['subcategory_type', '=', 'Merchandise']])
      const listed = subs.map(s => ({ code: exact(s.row_id), name: text(s.subcategory) })).sort((x, y) => x.name.localeCompare(y.name))
      merchandise.push({ assignment: exact(a.row_id), responsibility: text(a.responsibility), level: level ?? 'nothing', named: level === 'subcategory' ? listed[0]?.name ?? named : named,
        region: exact(a.operating_region) || null, subcategories: listed.slice(0, NAMES_SHOWN), more: Math.max(0, listed.length - NAMES_SHOWN),
        gaps: !level ? ['Names no division, category or subcategory'] : !subs.length ? [`${named} · no subcategories`] : [] })
    }

    const gaps = [...(current ? [] : [`No longer on the staff list (${text(employee.status) || 'no status'}): covers nothing`]), ...jobCovers.flatMap(j => [...j.gaps, ...j.departments.flatMap(d => d.gaps.map(g => `${d.name} › ${g}`))]), ...merchandise.flatMap(m => m.gaps)]
    const own = (await myEmployees(ctx)).some(e => exact(e.row_id) === code)
    return { state: 'ok' as const, kind: 'employee' as const, own, employee: { code, name: text(employee.name), status: text(employee.status) },
      jobs: jobCovers, merchandise, gaps: unique(gaps), area_only: !full,
      // #1223 spec item 17: the page links each gap's section by name.
      section_ids: Object.fromEntries(jobCovers.flatMap(j => [...j.sections, ...j.departments.flatMap(d => d.sections)]).map(s => [s.name, s.id])),
      nothing: !jobCovers.length && !merchandise.length }
  },
}
