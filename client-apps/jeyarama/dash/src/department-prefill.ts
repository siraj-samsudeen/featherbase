// Pre-fills Department Managers' departments from reporting lines (#1205), one store a call, from a
// reviewed list: the owner's choice of 11-Nov-2026. Each pre-fill goes through the set-up path
// (department-setup.ts) as the loader, so it applies and reaches the reviewer like any set-up. A
// manager with a department, a set-up open, or any earlier pre-fill is skipped: reruns are safe, and
// never bring back a pre-fill someone took back. A dry run says what would happen and sends nothing;
// a real run says what it created, and undo_prefill takes those back.
import { FALLBACK_ROLE, JOB_FIELDS, SECTION_FIELDS, T, all, approversOf, byId, inForce, list, unique, type ActionContext, type Row } from './my-sections.ts'
import { OPEN, about, allSetUps, isSetUp, pendingBundle, proposeDepartment, storeOf, takeBack } from './department-setup.ts'
import { istToday } from './report.ts'
import { EMPLOYEE_STATUS, exact, text } from './values.ts'

const LOADERS = ['System Manager', FALLBACK_ROLE]
const fold = (name: string) => name.trim().toLowerCase()
const NAME_LIMIT = 40

/**
 * A pre-filled department's name: its sections, in name order, joined with ", " and " & " (the
 * owner, 11-Nov-2026). Past 40 characters, the first two and how many more; the page lists them all.
 */
export function sectionsName(sections: string[]): string {
  const joined = sections.length < 2 ? sections.join('') : `${sections.slice(0, -1).join(', ')} & ${sections.at(-1)}`
  return joined.length <= NAME_LIMIT || sections.length < 3 ? joined : `${sections[0]}, ${sections[1]} & ${sections.length - 2} more`
}

const mayLoad = (ctx: ActionContext) => (ctx.roles ?? []).some(role => LOADERS.includes(role))

interface Manager { employee: string; sections: string[]; flagged: string[] }
type Outcome = 'pre-filled' | 'would pre-fill' | 'skipped' | 'refused'
type Result = { employee: string; name: string; outcome: Outcome; notes: string[]; department?: string; sections?: string[]
  bundle?: string; created?: { department: string | null; links: (string | null)[]; proposals: string[] } }

export const prefillActions = {
  /** Pre-fills one store's Department Managers from the reviewed list; `dry_run` sends nothing. */
  async prefill_departments(ctx: ActionContext) {
    if (!isSetUp(ctx)) ctx.reject('Dash is not set up for departments here')
    if (!mayLoad(ctx)) ctx.reject('Only a System Manager or Master Data Editor can pre-fill departments')
    const payload = (ctx.payload ?? {}) as { store?: unknown; managers?: unknown; dry_run?: unknown }
    const site = typeof payload.store === 'string' ? payload.store : ''
    const [siteRow] = site ? await list(ctx, T.site, ['name'], [['row_id', '=', site]]) : []
    if (!siteRow) ctx.reject(`No store ${String(payload.store)}`)
    if (!Array.isArray(payload.managers)) ctx.reject('Send the managers to pre-fill')
    const dryRun = payload.dry_run === true
    const managers: Manager[] = (payload.managers as Partial<Manager>[]).map(m => ({ employee: String(m.employee ?? ''),
      sections: Array.isArray(m.sections) ? m.sections.map(String) : [], flagged: Array.isArray(m.flagged) ? m.flagged.map(String) : [] }))
    const today = istToday()
    // One store's set-ups at a time, as a Department Manager's own would be.
    await ctx.changeProposals.serialize(`department:${site}`)
    const store = text(siteRow!.name)
    const shop = await storeOf(ctx, site, today)
    const sections = await all(ctx, T.section, SECTION_FIELDS, [['site', '=', site]])
    const floors = byId(await all(ctx, T.floor, ['name', 'site'], [['site', '=', site]]))
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
      // The floor most of its sections are on tells two of a name apart.
      const counts = new Map<string, number>()
      for (const s of picked) counts.set(exact(s.floor), (counts.get(exact(s.floor)) ?? 0) + 1)
      const [floorId] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
      const floor = text(floors.get(floorId)?.name) || 'No floor'
      plans.push({ result, job, person: exact(employee.person), picked, flagged: manager.flagged.map(fold), base: sectionsName(picked.map(s => text(s.name))), floor })
    }
    // Unique in the store by construction (no two managers share a section); a name already in use gets the floor.
    const used = shop.departments.map(d => fold(text(d.name)))
    for (const plan of plans) {
      const clash = used.includes(fold(plan.base)) || plans.filter(p => fold(p.base) === fold(plan.base)).length > 1
      const name = clash ? `${plan.base}, ${plan.floor}` : plan.base
      const named = plan.picked.map(s => ({ id: exact(s.row_id), name: text(s.name) }))
      Object.assign(plan.result, { outcome: dryRun ? 'would pre-fill' : 'pre-filled', department: name, sections: named.map(s => s.name) })
      if (dryRun) continue
      const { approvers, manager } = await approversOf(ctx, plan.job)
      const bundle = `${exact(plan.job.row_id)}:${globalThis.crypto.randomUUID()}`
      const { head, links } = await proposeDepartment(ctx, {
        site, today, manager: plan.result.employee, sections: named,
        // The Department Manager may answer their own pre-fill, through Yes or Change it only.
        approvers: { people: unique([...approvers.people, plan.person]), fallbackRoles: approvers.fallbackRoles },
        shared: { bundle, job_assignment: exact(plan.job.row_id), store, name,
          maker_name: plan.result.name, manager_name: manager, prefilled: true, for_person: plan.person || null,
          flagged: plan.picked.filter(s => plan.flagged.includes(fold(text(s.name)))).map(s => exact(s.row_id)) },
      })
      Object.assign(plan.result, { bundle, created: { department: head.result_row ?? null, links: links.map(l => l.result_row ?? null),
        proposals: [head.row_id, ...links.map(l => l.row_id)] } })
    }
    return { store, results: results.map(({ notes, ...rest }) => ({ ...rest, notes })) }
  },

  /** Takes back pre-fills the caller made, links first: the load's undo. */
  async undo_prefill(ctx: ActionContext) {
    if (!mayLoad(ctx)) ctx.reject('Only a System Manager or Master Data Editor can take pre-fills back')
    const bundles = ((ctx.payload ?? {}) as { bundles?: unknown }).bundles
    if (!Array.isArray(bundles)) ctx.reject('Send the pre-fills to take back')
    const results = []
    for (const bundle of bundles as unknown[]) {
      const parts = (await pendingBundle(ctx, bundle, [ctx.user])).filter(p => about(p).prefilled)
      if (!parts.length) { results.push({ bundle, outcome: 'not open' }); continue }
      const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', about(parts[0]).job_assignment]])
      await takeBack(ctx, parts, (await approversOf(ctx, job)).approvers)
      results.push({ bundle, outcome: 'undone', parts: parts.length })
    }
    return { results }
  },
}
