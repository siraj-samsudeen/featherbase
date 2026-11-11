// Pre-fills Department Managers' departments from reporting lines (#1205), one store a call, from a
// reviewed list: the owner's choice of 11-Nov-2026. Each pre-fill goes through the set-up path
// (department-setup.ts) as the loader, so it applies and reaches the reviewer like any set-up. A
// manager with a department, a set-up open, or any earlier pre-fill is skipped: reruns are safe, and
// never bring back a pre-fill someone took back.
import { FALLBACK_ROLE, JOB_FIELDS, PLACEMENT_FIELDS, SECTION_FIELDS, T, all, approversOf, byId, inForce, list, unique, type ActionContext, type Row } from './my-sections.ts'
import { OPEN, about, allSetUps, isSetUp, proposeDepartment, storeOf } from './department-setup.ts'
import { istToday } from './report.ts'
import { EMPLOYEE_STATUS, exact, text } from './values.ts'

const LOADERS = ['System Manager', FALLBACK_ROLE]
const fold = (name: string) => name.trim().toLowerCase()

/** The name most of `votes` share, when more than half do. */
function majority(votes: string[], of: number): string | null {
  const counts = new Map<string, number>()
  for (const vote of votes) if (vote) counts.set(vote, (counts.get(vote) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return top && top[1] * 2 > of ? top[0] : null
}

/**
 * A department's default name, as a store manager knows their stock: each section votes for the
 * subdivision most of its subcategories sit in; more than half agreeing names it, else the division
 * the same way, else its floor. A name the store already uses gets the floor added.
 */
export function departmentName(sections: Row[][], floor: string, taken: string[]): string {
  const vote = (level: string) => sections.map(subs => majority(subs.map(s => text(s[level])), subs.length) ?? '')
  const name = majority(vote('subdivision'), sections.length) ?? majority(vote('division'), sections.length) ?? floor
  return taken.includes(fold(name)) && name !== floor ? `${name}, ${floor}` : name
}

interface Manager { employee: string; sections: string[]; flagged: string[] }
type Result = { employee: string; name: string; outcome: 'pre-filled' | 'skipped' | 'refused'; notes: string[]; department?: string; sections?: string[] }

export const prefillActions = {
  /** Pre-fills one store's Department Managers from the reviewed list. */
  async prefill_departments(ctx: ActionContext) {
    if (!isSetUp(ctx)) ctx.reject('Dash is not set up for departments here')
    if (!(ctx.roles ?? []).some(role => LOADERS.includes(role))) ctx.reject('Only a System Manager or Master Data Editor can pre-fill departments')
    const payload = (ctx.payload ?? {}) as { store?: unknown; managers?: unknown }
    const site = typeof payload.store === 'string' ? payload.store : ''
    const [siteRow] = site ? await list(ctx, T.site, ['name'], [['row_id', '=', site]]) : []
    if (!siteRow) ctx.reject(`No store ${String(payload.store)}`)
    if (!Array.isArray(payload.managers)) ctx.reject('Send the managers to pre-fill')
    const managers = (payload.managers as Partial<Manager>[]).map(m => ({ employee: String(m.employee ?? ''),
      sections: Array.isArray(m.sections) ? m.sections.map(String) : [], flagged: Array.isArray(m.flagged) ? m.flagged.map(String) : [] }))
    const today = istToday()
    // One store's set-ups at a time, as a Department Manager's own would be.
    await ctx.changeProposals.serialize(`department:${site}`)
    const store = text(siteRow!.name)
    const shop = await storeOf(ctx, site, today)
    const sections = await all(ctx, T.section, SECTION_FIELDS, [['site', '=', site]])
    const floors = byId(await all(ctx, T.floor, ['name', 'site'], [['site', '=', site]]))
    const placements = (await all(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site]])).filter(row => inForce(row, today))
    const codes = unique(placements.map(p => exact(p.subcategory)))
    const leaves = codes.length ? byId(await all(ctx, T.subcategory, ['subdivision', 'division'], [['row_id', 'in', codes]])) : new Map<string, Row>()
    const jobs = (await all(ctx, T.job, JOB_FIELDS, [['site', '=', site]])).filter(row => inForce(row, today) && text(row.job) === 'Department Manager')
    const setUps = await allSetUps(ctx)
    const people = byId(await list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['row_id', 'in', unique(managers.map(m => m.employee))]]))

    const results: Result[] = []
    const plans: { result: Result; job: Row; person: string; picked: Row[]; flagged: string[]; base: string; floor: string }[] = []
    for (const manager of managers) {
      const employee = people.get(manager.employee)
      const result: Result = { employee: manager.employee, name: text(employee?.name), outcome: 'refused', notes: [] }
      results.push(result)
      if (!employee || exact(employee[EMPLOYEE_STATUS]) !== 'Current') { result.notes.push('not on the staff list'); continue }
      const job = jobs.find(row => exact(row.employee) === manager.employee)
      if (!job) { result.notes.push(`no Department Manager job at ${store}`); continue }
      const mine = setUps.filter(p => about(p).job_assignment === exact(job.row_id))
      const skip = shop.departments.some(d => exact(d.manager) === manager.employee) ? 'already has a department'
        : mine.some(p => about(p).prefilled) ? 'pre-filled before'
        : mine.some(p => OPEN.includes(p.state)) ? 'has a set-up open' : null
      if (skip) { result.outcome = 'skipped'; result.notes.push(skip); continue }
      const picked: Row[] = []
      for (const wanted of manager.sections) {
        const section = sections.find(s => fold(text(s.name)) === fold(wanted))
        if (!section) { result.notes.push(`no section ${wanted} at ${store}`); continue }
        if (exact(section.status) !== 'Active') { result.notes.push(`${text(section.name)} is closed`); continue }
        const holder = shop.holding.get(exact(section.row_id))
        if (holder) { result.notes.push(`${text(section.name)} is already in ${text(holder.name)}`); continue }
        picked.push(section)
      }
      if (!picked.length) { result.notes.push('no section left to pre-fill'); continue }
      picked.sort((a, b) => text(a.name).localeCompare(text(b.name)))
      // The floor most of its sections are on names it, or tells two of a name apart.
      const floorId = majority(picked.map(s => exact(s.floor)), 0) ?? ''
      const floor = text(floors.get(floorId)?.name) || 'No floor'
      const votes = picked.map(s => placements.filter(p => exact(p.section) === exact(s.row_id)).map(p => leaves.get(exact(p.subcategory))).filter((l): l is Row => !!l))
      plans.push({ result, job, person: exact(employee.person), picked, flagged: manager.flagged.map(fold), base: departmentName(votes, floor, []), floor })
    }
    // Two of one name in this store, or one the store already has: each gets its floor.
    const used = shop.departments.map(d => fold(text(d.name)))
    for (const plan of plans) {
      const clash = used.includes(fold(plan.base)) || plans.filter(p => fold(p.base) === fold(plan.base)).length > 1
      const name = clash && plan.base !== plan.floor ? `${plan.base}, ${plan.floor}` : plan.base
      const { approvers, manager } = await approversOf(ctx, plan.job)
      await proposeDepartment(ctx, {
        site, today, manager: plan.result.employee,
        sections: plan.picked.map(s => ({ id: exact(s.row_id), name: text(s.name) })),
        // The Department Manager may answer their own pre-fill, through Yes or Change it only.
        approvers: { people: unique([...approvers.people, plan.person]), fallbackRoles: approvers.fallbackRoles },
        shared: { bundle: `${exact(plan.job.row_id)}:${globalThis.crypto.randomUUID()}`, job_assignment: exact(plan.job.row_id), store, name,
          maker_name: plan.result.name, manager_name: manager, prefilled: true, for_person: plan.person || null,
          flagged: plan.picked.filter(s => plan.flagged.includes(fold(text(s.name)))).map(s => exact(s.row_id)) },
      })
      Object.assign(plan.result, { outcome: 'pre-filled', department: name, sections: plan.picked.map(s => text(s.name)) })
    }
    return { store, results: results.map(({ employee, name, outcome, department, sections: named, notes }) =>
      (outcome === 'pre-filled' ? { employee, name, outcome, department, sections: named, notes } : { employee, name, outcome, notes })) }
  },
}
