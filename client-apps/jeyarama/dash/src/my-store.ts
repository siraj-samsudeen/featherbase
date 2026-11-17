// #1223 design B: what each manager looks after, in Dash, with no Featherbase admin. Store Managers
// see their store, Floor Managers their floor, Department Managers their department, Team Leaders their
// sections' team (areas.ts says which), category heads and buyers their categories. Every record carries
// its id, so the page links it. The one edit, Move, is Your sections' `job_section` proposal about a
// staff member's job, reviewed by the moved person's manager (else the master data team).
import { istToday } from './report.ts'
import { exact, holdsOn, text } from './values.ts'
import { APPROVAL_TYPE, OPEN, JOB_FIELDS, about as aboutOf, waitingOnNow, type ChangeProposal, PLACEMENT_FIELDS, SCHEDULED, SECTION_FIELDS, T, aboutTheJob, all, approversOf, byId, isActive, isMerchandise, jobStamp, list, myEmployees, proposeAdd, scheduledLater, sentView, unique, waitingName,
  type ActionContext, type ReadContext, type Row } from './my-sections.ts'
import { NO_BUYER_SECTIONS, answersWhere, buyerSources, knownRegions, onlyIn, openBuyerSections, rowAnswers } from './buyers.ts'
import { DEPARTMENT, DEPARTMENT_SECTION, areasFor, authorityRows, inArea, jobInArea, mayMove, sectionAreaOf, type Area } from './areas.ts'

export { inArea, type Area } from './areas.ts'

const MERCHANDISE = 'Merchandise Assignment'
const MERCHANDISE_FIELDS = ['employee', 'responsibility', 'division', 'subdivision', 'category', 'subcategory', 'operating_region', 'starts_on', 'ends_on']
/** The merchandise responsibilities that look after buyers: everyone above a buyer. */
const LEADS_BUYERS = new Set(['Category head', 'Subdivision head', 'Division head', 'Merchandising head'])
const LEVELS = ['subcategory', 'category', 'subdivision', 'division'] as const

/** The caller's staff rows, areas, the merchandise they lead and what they buy. */
export async function areasOf(ctx: ReadContext | ActionContext, today: string): Promise<{ employee: Row | undefined; employees: Row[]; areas: Area[]; leads: Row[]; buys: Row[];
  buyerSections: { section: Row; subcategories: string[] }[]; stillAnswers: (row: Row, codes: string[]) => string[]; partly: (row: Row, code: string) => string | null }> {
  const employees = await myEmployees(ctx)
  const areas = await areasFor(ctx, employees, today)
  const assignments = employees.length ? (await all(ctx, MERCHANDISE, MERCHANDISE_FIELDS, [['employee', 'in', employees.map(e => exact(e.row_id))]]))
    .filter(row => holdsOn(row, today)) : []
  // #1246: the Buyer Sections I buy for, and what each of my Buyer rows still answers for.
  const mine = new Set(employees.map(e => exact(e.row_id)))
  const open = employees.length ? await openBuyerSections(ctx, today) : NO_BUYER_SECTIONS
  const buyerSections = [...open.sections.values()].filter(d => mine.has(exact(d.buyer)))
    .map(section => ({ section, subcategories: open.links.filter(l => exact(l.buyer_section) === exact(section.row_id)).map(l => exact(l.subcategory)) }))
  const regions = open.sections.size ? knownRegions((await all(ctx, T.site, ['operating_region'], [])).map(r => r.operating_region),
    [...open.sections.values()].map(d => d.operating_region), assignments.map(r => r.operating_region)) : []
  // A Buyer row answers for the subcategories no Buyer Section has taken over in the regions it applies to (buyers.ts rowAnswers).
  const stillAnswers = (row: Row, codes: string[]) => codes.filter(code => rowAnswers(row, code, null, open, regions))
  const partly = (row: Row, code: string) => onlyIn(row, code, open, regions)
  return { employee: employees[0], employees, areas, leads: assignments.filter(r => LEADS_BUYERS.has(text(r.responsibility))),
    buys: assignments.filter(r => text(r.responsibility) === 'Buyer'), buyerSections, stillAnswers, partly }
}

/** What each kind of area is called on its page. */
const PAGE: Record<Area['kind'], string> = { store: 'Your store', floor: 'Your floor', department: 'Your department', section: 'Your sections' }

export const storeReads = {
  /** The sidebar's link for Your store / Your floor / Your categories; departments and sections have their own pages. */
  async manages_area(ctx: ReadContext) {
    const { areas, leads, buys, buyerSections } = await areasOf(ctx, istToday())
    if (areas.some(a => a.kind === 'store')) return PAGE.store
    if (areas.some(a => a.kind === 'floor')) return PAGE.floor
    return leads.length || buys.length || buyerSections.length ? 'Your categories' : null
  },

  /** Everything the page shows, for the signed-in manager alone. `kinds` narrows it for the page asking. */
  async my_store(ctx: ReadContext) {
    const today = istToday()
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as { kinds?: unknown }
    const kinds = Array.isArray(payload.kinds) ? new Set(payload.kinds.map(String)) : null
    const all_ = await areasOf(ctx, today)
    const { employee, employees } = all_
    const areas = all_.areas.filter(a => !kinds || kinds.has(a.kind))
    const leads = !kinds || kinds.has('categories') ? all_.leads : []
    const buysRows = !kinds || kinds.has('categories') ? all_.buys : []
    const myBuyerSections = !kinds || kinds.has('categories') ? all_.buyerSections : []
    if (!employee) return { state: 'unknown_person' as const }
    if (!areas.length && !leads.length && !buysRows.length && !myBuyerSections.length) return { state: 'nothing' as const }
    const mine = new Set(employees.map(e => exact(e.row_id)))
    const sites = unique(areas.map(a => a.site))
    const siteRows = sites.length ? byId(await list(ctx, T.site, ['name'], [['row_id', 'in', sites]])) : new Map<string, Row>()
    const sections = sites.length ? await all(ctx, T.section, SECTION_FIELDS, [['site', 'in', sites]]) : []
    const floors = sites.length ? byId(await all(ctx, T.floor, ['name', 'site'], [['site', 'in', sites]])) : new Map<string, Row>()
    const placements = sites.length ? (await all(ctx, T.placement, ['store', 'section', 'subcategory', 'starts_on', 'ends_on'], [['store', 'in', sites]])).filter(r => holdsOn(r, today)) : []
    const staffJobs = sites.length ? (await all(ctx, T.job, JOB_FIELDS, [['site', 'in', sites]])).filter(r => holdsOn(r, today)) : []
    const people = unique([...staffJobs.map(j => exact(j.employee)), ...staffJobs.map(j => exact(j.reports_to))])
    const names = people.length ? byId(await all(ctx, T.employee, ['name', 'status'], [['row_id', 'in', people]])) : new Map<string, Row>()
    const current = (id: unknown) => text(names.get(exact(id))?.status) === 'Current'
    const person = (id: unknown) => exact(id) ? { code: exact(id), name: text(names.get(exact(id))?.name) || 'Unnamed' } : null
    const sectionsById = byId(sections)
    // #1223 spec item 10: a section change waiting for review, by the job it is about now (the new row once applied).
    const waiting: Record<string, string> = {}
    if (areas.length) {
      // Every open proposal, page by page (as waitingForMe reads them), then the section changes at my stores.
      const open: ChangeProposal[] = []
      for (let start = 0; ; start += 500) {
        const page = await ctx.changeProposals.list({ states: OPEN, limit: 500, start })
        open.push(...page.filter(p => aboutOf(p).kind === 'section' && sites.includes(String(aboutOf(p).site ?? ''))))
        if (page.length < 500) break
      }
      // The reviewer now, from the job as it is now (as Your sections and decide read it), not as first routed.
      const rowOf = (p: ChangeProposal) => p.state === 'Not yet reviewed' && p.result_row ? exact(p.result_row) : exact(aboutOf(p).job_assignment)
      const jobRows = open.length ? byId(await all(ctx, T.job, JOB_FIELDS, [['row_id', 'in', unique(open.map(rowOf))]])) : new Map<string, Row>()
      for (const p of open) waiting[rowOf(p)] = await waitingOnNow(ctx, jobRows.get(rowOf(p)), p.maker, aboutOf(p))
    }
    // #1245: who runs a store is its open Store Manager and Cluster Manager jobs (the job, never a designation).
    const runBy = (site: string, title: string) => staffJobs.filter(j => exact(j.site) === site && text(j.job) === title && current(j.employee))
      .map(j => person(j.employee)!).filter((p, i, list) => list.findIndex(q => q.code === p.code) === i).sort((a, b) => a.name.localeCompare(b.name))
    const places = areas.map(area => {
      const held = sections.filter(s => inArea(area, s))
      const floorKey = (s: Row) => exact(s.floor)
      const groups = unique(held.map(floorKey)).concat(held.some(s => !floorKey(s)) ? [''] : [])
        .map(id => ({ floor_id: id || null, floor: id ? text(floors.get(id)?.name) || 'Unnamed floor' : 'No floor set',
          sections: held.filter(s => floorKey(s) === id).map(s => ({
            id: exact(s.row_id), name: text(s.name), active: isActive(s),
            team_leaders: staffJobs.filter(j => text(j.job) === 'Team Leader' && exact(j.section) === exact(s.row_id) && current(j.employee)).map(j => person(j.employee)!),
            subcategories: placements.filter(p => exact(p.section) === exact(s.row_id)).length,
          })).sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => a.floor.localeCompare(b.floor))
      const staff = staffJobs.filter(j => !mine.has(exact(j.employee)) && current(j.employee) && jobInArea(area, j, sectionsById.get(exact(j.section))))
        .map(j => ({ job_id: exact(j.row_id), ...person(j.employee)!, job: text(j.job),
          section: text(sectionsById.get(exact(j.section))?.name) || null, section_id: exact(j.section) || null, reports_to: person(j.reports_to),
          movable: area.kind === 'section' ? text(j.job) === 'Staff' : ['Staff', 'Team Leader'].includes(text(j.job)),
          waiting_for: waiting[exact(j.row_id)] ?? null }))
        .sort((a, b) => a.job.localeCompare(b.job) || a.name.localeCompare(b.name))
      return { kind: area.kind, page: PAGE[area.kind], store: text(siteRows.get(area.site)?.name), store_id: area.site,
        floor: area.floor ? text(floors.get(area.floor)?.name) : null, floor_id: area.floor, department: area.department,
        managers: { store: runBy(area.site, 'Store Manager'), cluster: runBy(area.site, 'Cluster Manager') },
        floors: groups, staff, sections: held.filter(isActive).map(s => ({ id: exact(s.row_id), name: text(s.name) })).sort((a, b) => a.name.localeCompare(b.name)) }
    })

    // Categories a head leads: who buys what, and what nobody buys yet. The deepest filled level decides,
    // as the report's reach reads it: a head of one subcategory sees that one only.
    const led = new Map<string, { category: string; region: string | null; responsibility: string; only: Set<string> | null }>()
    for (const lead of leads) {
      const level = LEVELS.find(l => exact(lead[l]))
      // An assignment naming no level covers nothing, as reach reads it (whatever its responsibility).
      const under = level ? await all(ctx, T.subcategory, ['category'], [[level === 'subcategory' ? 'row_id' : level, '=', exact(lead[level])], ['subcategory_type', '=', 'Merchandise']]) : []
      const region = exact(lead.operating_region) || null
      for (const category of unique(under.map(s => exact(s.category))).sort()) {
        const key = `${category}|${region}`
        const these = level === 'subcategory' ? new Set(under.filter(s => exact(s.category) === category).map(s => exact(s.row_id))) : null
        const had = led.get(key)
        // Two assignments on one category: the wider wins; two subcategory ones add up.
        const only = had && (had.only === null || these === null) ? null : new Set([...(had?.only ?? []), ...(these ?? [])])
        led.set(key, { category, region, responsibility: had?.responsibility ?? text(lead.responsibility), only: had || these ? only : null })
      }
    }
    const categories = []
    // #1246: Buyer Sections first; today's Merchandise Assignment Buyer rows only where none covers a subcategory.
    const buyerSections = led.size ? await openBuyerSections(ctx, today) : NO_BUYER_SECTIONS
    const openBuyerRows = led.size ? (await all(ctx, MERCHANDISE, MERCHANDISE_FIELDS, [['responsibility', '=', 'Buyer']])).filter(row => holdsOn(row, today)) : []
    // The regions with stores decide "every region" for a head of all of them; Buyer Sections and Buyer rows add any other region named.
    const siteRegions = led.size ? knownRegions((await all(ctx, T.site, ['operating_region'], [])).map(r => r.operating_region)) : []
    const regions = knownRegions(siteRegions, [...buyerSections.sections.values()].map(d => d.operating_region), openBuyerRows.map(r => r.operating_region))
    for (const { category, region, responsibility, only } of led.values()) {
      const subs = (await all(ctx, T.subcategory, ['subcategory', 'category', 'subdivision', 'division', 'subcategory_type'], [['category', '=', category], ['subcategory_type', '=', 'Merchandise']]))
        .filter(s => !only || only.has(exact(s.row_id)))
      const levelOf = (s: Row) => ({ division: exact(s.division), subdivision: exact(s.subdivision), category: exact(s.category) })
      const coversSub = (row: Row, s: Row) => exact(row.subcategory) ? exact(s.row_id) === exact(row.subcategory)
        : exact(row.category) ? exact(row.category) === category
        : exact(row.subdivision) ? levelOf(s).subdivision === exact(row.subdivision)
        : exact(row.division) ? levelOf(s).division === exact(row.division) : false
      // Per subcategory, by the transition rule (#1246): the Buyer Sections covering it, else the Buyer rows that still
      // answer for it. A row is kept with exactly the subcategories it answers for, never re-expanded.
      const fromBuyerSections: { link: Row; section: Row; sub: Row }[] = []
      const answering = new Map<string, Set<string>>()
      for (const sub of subs) {
        const source = buyerSources(exact(sub.row_id), region, buyerSections, openBuyerRows, row => coversSub(row, sub), regions)
        fromBuyerSections.push(...source.sections.map(d => ({ ...d, sub })))
        for (const row of source.assignments) answering.set(exact(row.row_id), (answering.get(exact(row.row_id)) ?? new Set()).add(exact(sub.row_id)))
      }
      const buyerRows = openBuyerRows.filter(row => answering.has(exact(row.row_id)))
      // A buyer who has left buys nothing: their subcategories show as having no buyer. So does a Buyer Section with no buyer.
      const people = unique([...buyerRows.map(b => exact(b.employee)), ...fromBuyerSections.map(d => exact(d.section.buyer))])
      const buyerNames = people.length ? byId(await all(ctx, T.employee, ['name', 'status'], [['row_id', 'in', people]])) : new Map<string, Row>()
      const isCurrent = (id: unknown) => text(buyerNames.get(exact(id))?.status) === 'Current'
      const buyers = buyerRows.filter(b => isCurrent(b.employee))
      const buyerSectionBuyers = fromBuyerSections.filter(d => isCurrent(d.section.buyer))
      // Only a buyer for every store this head covers closes the gap: for a head with no region, one limited to a region doesn't.
      const whole = (b: Row) => !exact(b.operating_region) || exact(b.operating_region) === region
      const covered = new Set(subs.map(s => exact(s.row_id)).filter(code => {
        const buyerSectionsHere = fromBuyerSections.filter(d => exact(d.sub.row_id) === code)
        // Every Buyer Section covering it needs a buyer on the staff: a vacancy is a gap wherever it is.
        if (buyerSectionsHere.some(d => !isCurrent(d.section.buyer))) return false
        const rows = buyers.filter(b => answering.get(exact(b.row_id))!.has(code))
        if (region) return rows.some(whole) || buyerSectionsHere.length > 0
        // A head of every region, where the stores name their regions: each region needs a Buyer Section buyer or a Buyer row answering there.
        if (siteRegions.length) return siteRegions.every(r => buyerSectionsHere.some(d => exact(d.section.operating_region) === r)
          || rows.some(b => answersWhere(b, code, buyerSections, regions).some(w => w === null || w === r)))
        // No region named on any store: as before, only a both-regions row closes the gap, or a Buyer Section in every region named.
        return rows.some(whole) || (regions.length > 0 && regions.every(r => buyerSectionsHere.some(d => exact(d.section.operating_region) === r)))
      }))
      const label = (b: Row) => {
        const mine = answering.get(exact(b.row_id))!
        const named = (code: string) => text(subs.find(s => exact(s.row_id) === code)?.subcategory)
        const partly = (code: string) => region ? null : onlyIn(b, code, buyerSections, regions)
        if (exact(b.subcategory)) return named(exact(b.subcategory)) + (partly(exact(b.subcategory)) ? ` (${partly(exact(b.subcategory))} only)` : '')
        if (mine.size === subs.filter(s => coversSub(b, s)).length && [...mine].every(code => !partly(code))) return `All of ${exact(b.category) || exact(b.subdivision) || exact(b.division)}`
        const names = [...mine].map(code => named(code) + (partly(code) ? ` (${partly(code)} only)` : '')).sort((x, y) => x.localeCompare(y))
        return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      }
      categories.push({ category, region, responsibility,
        buyers: buyers.map(b => ({ name: text(buyerNames.get(exact(b.employee))?.name) || 'Unnamed', code: exact(b.employee), assignment: exact(b.row_id),
          buys: label(b) + (whole(b) ? '' : `, ${exact(b.operating_region)} only`),
          subcategory: exact(b.subcategory) || null, buyer_section: null as { id: string; name: string } | null })).concat(buyerSectionBuyers.map(d => ({
          name: text(buyerNames.get(exact(d.section.buyer))?.name) || 'Unnamed', code: exact(d.section.buyer), assignment: exact(d.link.row_id),
          buys: text(d.sub.subcategory) + (region ? '' : `, ${exact(d.section.operating_region)} only`), subcategory: exact(d.sub.row_id),
          buyer_section: { id: exact(d.section.row_id), name: text(d.section.name) } }))),
        no_buyer: subs.filter(s => !covered.has(exact(s.row_id))).map(s => ({ code: exact(s.row_id), name: text(s.subcategory) })).sort((a, b) => a.name.localeCompare(b.name)) })
    }

    // What a buyer buys, read only until Buyer Sections (#1223, Siraj).
    const buys: { assignment: string; level: string | null; named: string; region: string | null; subcategories: { code: string; name: string; only?: string }[]; buyer_section?: { id: string; name: string } }[] = []
    for (const b of buysRows) {
      const level = LEVELS.find(l => exact(b[l]))
      const every = level ? await all(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [[level === 'subcategory' ? 'row_id' : level, '=', exact(b[level])], ['subcategory_type', '=', 'Merchandise']]) : []
      const kept = new Set(all_.stillAnswers(b, every.map(s => exact(s.row_id))))
      if (every.length && !kept.size) continue
      const subs = every.filter(s => kept.has(exact(s.row_id)))
      buys.push({ assignment: exact(b.row_id), level: level ?? null, named: level ? exact(b[level]) : '', region: exact(b.operating_region) || null,
        subcategories: subs.map(s => ({ code: exact(s.row_id), name: text(s.subcategory), ...(all_.partly(b, exact(s.row_id)) ? { only: all_.partly(b, exact(s.row_id))! } : {}) }))
          .sort((x, y) => x.name.localeCompare(y.name)) })
    }
    // #1246: what my Buyer Sections buy.
    for (const { section, subcategories } of myBuyerSections) {
      const subs = subcategories.length ? await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', subcategories]]) : []
      buys.push({ assignment: exact(section.row_id), level: 'buyer_section', named: text(section.name), region: exact(section.operating_region) || null,
        buyer_section: { id: exact(section.row_id), name: text(section.name) },
        subcategories: subs.map(s => ({ code: exact(s.row_id), name: text(s.subcategory) })).sort((x, y) => x.name.localeCompare(y.name)) })
    }
    return { state: 'ok' as const, name: text(employee.name), code: exact(employee.row_id), places, categories, buys }
  },

  /** #1223: one section's subcategories, for a manager whose store, floor or department holds it. */
  async section_subcategories(ctx: ReadContext) {
    const today = istToday()
    const id = (ctx.payload as { section?: unknown } | undefined)?.section
    const [section] = typeof id === 'string' && id ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', id]]) : []
    if (!(await sectionAreaOf(ctx, ctx.user, section, today))) return { state: 'not_allowed' as const }
    // As the counts on Your store read them (holdsOn, as reach does): one rule on every manager path.
    const placed = (await all(ctx, T.placement, PLACEMENT_FIELDS, [['section', '=', exact(section.row_id)], ['store', '=', exact(section.site)]])).filter(p => holdsOn(p, today))
    const subs = placed.length ? byId(await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', unique(placed.map(p => exact(p.subcategory)))]])) : new Map<string, Row>()
    return { state: 'ok' as const, section: { id: exact(section.row_id), name: text(section.name) },
      placed: placed.map(p => ({ placement: exact(p.row_id), code: exact(p.subcategory), name: text(subs.get(exact(p.subcategory))?.subcategory) || 'Unnamed subcategory' }))
        .sort((a, b) => a.name.localeCompare(b.name)) }
  },

  /** #1223: merchandise subcategories matching a name or code, to add to a section (at most 20). */
  async find_subcategories(ctx: ReadContext) {
    const q = String((ctx.payload as { q?: unknown } | undefined)?.q ?? '').trim()
    if (q.length < 2) return []
    const byName = await list(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [['subcategory', 'like', `%${q}%`], ['subcategory_type', '=', 'Merchandise']], 20)
    const byCode = /^\d+$/.test(q) ? await list(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [['row_id', 'like', `${q}%`], ['subcategory_type', '=', 'Merchandise']], 20) : []
    return [...byId([...byCode, ...byName]).values()].slice(0, 20).map(s => ({ code: exact(s.row_id), name: text(s.subcategory) }))
  },
}

/** Hold still what a manager's change to a section rests on, in decide's order: jobs, people, departments,
 *  department links, sections. Returns the manager's area holding the section, re-read under the locks. */
async function lockedSectionArea(ctx: ActionContext, sectionId: string, today: string, fromId = '') {
  const [seen] = sectionId ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', sectionId]]) : []
  if (!seen) ctx.reject('Pick a section in your area')
  const authority = await authorityRows(ctx, ctx.user, exact(seen.site))
  for (const id of [...authority.jobs].sort()) await ctx.changeProposals.lockRow(T.job, id)
  for (const id of [...authority.employees].sort()) await ctx.changeProposals.lockRow(T.employee, id)
  for (const id of [...authority.departments].sort()) await ctx.changeProposals.lockRow(DEPARTMENT, id)
  for (const id of [...authority.links].sort()) await ctx.changeProposals.lockRow(DEPARTMENT_SECTION, id)
  for (const id of unique([sectionId, fromId]).sort()) await ctx.changeProposals.lockRow(T.section, id)
  const [section] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', sectionId]])
  const [from] = fromId ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', fromId]]) : []
  if (!(await sectionAreaOf(ctx, ctx.user, section, today))) ctx.reject('You can change only the sections in your own store, floor or department')
  const area = await sectionAreaOf(ctx, ctx.user, section, today, from ? [from] : [])
  if (!area) ctx.reject('That subcategory is in a section outside your area now. Ask its manager or the master data team')
  if (!isActive(section)) ctx.reject('That section is no longer open')
  const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', area.job]])
  const [employee] = await list(ctx, T.employee, ['name', 'status', 'person'], [['row_id', '=', exact(job.employee)]])
  return { section, job, employee }
}

export const storeActions = {
  /** #1223: a manager takes a subcategory out of a section in their area. Reviewed by their own manager. */
  async manage_remove(ctx: ActionContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const today = istToday()
    const placementId = typeof payload.placement === 'string' ? payload.placement : ''
    const [seen] = placementId ? await list(ctx, T.placement, PLACEMENT_FIELDS, [['row_id', '=', placementId]]) : []
    if (!seen) ctx.reject('That subcategory is not in this section')
    const { section, job, employee } = await lockedSectionArea(ctx, exact(seen.section), today)
    await ctx.changeProposals.lockRow(T.placement, placementId)
    const [placement] = await list(ctx, T.placement, PLACEMENT_FIELDS, [['row_id', '=', placementId]])
    if (!placement || !holdsOn(placement, today) || exact(placement.section) !== exact(section.row_id) || exact(placement.store) !== exact(section.site))
      ctx.reject('That subcategory is not in this section')
    if (await scheduledLater(ctx, exact(section.site), exact(placement.subcategory), today)) ctx.reject(SCHEDULED)
    const [name] = await list(ctx, T.subcategory, ['subcategory'], [['row_id', '=', exact(placement.subcategory)]])
    const base = await aboutTheJob(ctx, job, employee)
    const proposal = await ctx.changeProposals.propose({ table: T.placement, row: exact(placement.row_id), changes: {}, ends: true, reviewed: ['store', 'subcategory', 'section'],
      type: APPROVAL_TYPE.removal, apply: { effectiveOn: today }, approvers: (await approversOf(ctx, job)).approvers,
      about: { ...base, kind: 'removal', what: text(name?.subcategory), from: text(section.name), to: '', subcategory: exact(placement.subcategory),
        from_section: exact(section.row_id), to_section: '', by_manager: true } })
    return sentView(ctx, proposal)
  },

  /** #1223: a manager puts a subcategory in a section in their area, from wherever it is in the store. */
  async manage_add(ctx: ActionContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const today = istToday()
    const code = typeof payload.subcategory === 'string' ? payload.subcategory : ''
    const sectionId = typeof payload.section === 'string' ? payload.section : ''
    // Where it sits now in this store, if anywhere: that section must be in the same area as the destination.
    const [destination] = sectionId ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', sectionId]]) : []
    const [now] = destination && code ? (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', exact(destination.site)], ['subcategory', '=', code]])).filter(p => holdsOn(p, today)) : []
    const fromId = now && exact(now.section) !== sectionId ? exact(now.section) : ''
    const { section, job, employee } = await lockedSectionArea(ctx, sectionId, today, fromId)
    const [subcategory] = code ? await list(ctx, T.subcategory, ['subcategory_type'], [['row_id', '=', code]]) : []
    if (!isMerchandise(subcategory)) ctx.reject('Pick a subcategory from the list')
    // What was authorised (fromId, checked under lock with the destination) is what is proposed: any other source is refused.
    return proposeAdd(ctx, job, employee, section, code, today, { by_manager: true }, now && exact(now.section) === sectionId ? sectionId : fromId, holdsOn)
  },

  /** Move one of my staff to another section in my area. Reviewed as Your sections' section change is. */
  async move_staff(ctx: ActionContext) {
    const payload = (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
    const today = istToday()
    if (typeof payload.job !== 'string' || !payload.job) ctx.reject('Pick someone to move')
    // Hold still everything the checks below rest on, in decide's order (jobs, people, departments, links,
    // sections), so a move that applies at once can't race the manager's authority, the person, or the sections.
    const [seen] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', payload.job]])
    if (!seen) ctx.reject('That job is no longer on the staff list')
    const authority = await authorityRows(ctx, ctx.user, exact(seen.site))
    for (const id of unique([exact(seen.row_id), ...authority.jobs]).sort()) await ctx.changeProposals.lockRow(T.job, id)
    for (const id of unique([exact(seen.employee), ...authority.employees]).sort()) await ctx.changeProposals.lockRow(T.employee, id)
    for (const id of [...authority.departments].sort()) await ctx.changeProposals.lockRow(DEPARTMENT, id)
    for (const id of [...authority.links].sort()) await ctx.changeProposals.lockRow(DEPARTMENT_SECTION, id)
    const toId = typeof payload.to_section === 'string' ? payload.to_section : ''
    for (const id of unique([exact(seen.section), toId]).sort()) await ctx.changeProposals.lockRow(T.section, id)
    const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', payload.job]])
    if (!job || !holdsOn(job, today)) ctx.reject('That job is no longer on the staff list')
    if (exact(job.site) !== exact(seen.site) || exact(job.employee) !== exact(seen.employee) || exact(job.section) !== exact(seen.section)) ctx.reject('That job has just changed. Open the page again')
    const { employee, employees } = await areasOf(ctx, today)
    if (employees.some(e => exact(e.row_id) === exact(job.employee))) ctx.reject('You can\'t move yourself. Use Your sections')
    const [from] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
    const [to] = toId ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', toId]]) : []
    // One area of mine holds both ends and lets me move this job: the same rule approval re-checks (areas.ts).
    if (!(await mayMove(ctx, ctx.user, job, to, today))) {
      const movable = ['Staff', 'Team Leader'].includes(text(job.job))
      ctx.reject(movable ? 'You can move only your own staff, within your own area' : 'Only Staff and Team Leaders can be moved here')
    }
    if (!isActive(to)) ctx.reject('That section is no longer open')
    if (exact(to.row_id) === exact(job.section)) ctx.reject('They are already in that section')
    const [holder] = await list(ctx, T.employee, ['name', 'status'], [['row_id', '=', exact(job.employee)]])
    if (text(holder?.status) !== 'Current') ctx.reject('They are no longer on the staff list')
    const [store] = await list(ctx, T.site, ['name'], [['row_id', '=', exact(job.site)]])
    const changes: Record<string, string | null> = { section: exact(to.row_id) }
    if (exact(job.floor)) changes.floor = exact(to.floor) || null
    // Reviewed as Your sections' own section change is: by the moved person's manager, else the master data team.
    const { approvers, manager } = await approversOf(ctx, job)
    const proposal = await ctx.changeProposals.propose({ table: T.job, row: exact(job.row_id), changes,
      reviewed: ['employee', 'site', 'job', ...(changes.floor === undefined ? ['floor'] : [])], type: APPROVAL_TYPE.section,
      apply: { effectiveOn: today, newRow: await jobStamp(ctx, job, exact(to.row_id), today) },
      approvers,
      about: { kind: 'section', what: `${text(holder?.name)}, ${text(job.job)} at ${text(store?.name)}`, from: from ? text(from.name) : 'No section', to: text(to.name),
        store: text(store?.name), site: exact(job.site), maker_name: text(employee?.name), manager_name: manager, job_assignment: exact(job.row_id),
        from_section: exact(job.section), to_section: exact(to.row_id), by_manager: true, moved_name: text(holder?.name) } })
    // Who it is with, as the platform routed it: never the manager who moved them (then the master data team).
    return { id: proposal.row_id, state: proposal.state, reviewer: await waitingName(ctx, proposal.route.people) }
  },
}
