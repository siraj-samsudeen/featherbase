// A Department Manager sets up their own department (#1195): which sections are theirs and what
// the department is called. One set-up is one bundle of proposals: the new Department, then one
// Department Section per section, its department filled in when the Department is applied. Their
// manager (else a Master Data Editor) decides the bundle as one. The rules are here; the platform
// still checks who may decide.
import {
  BASE_TABLES, JOB_FIELDS, MASTER_DATA_TEAM, PLACEMENT_FIELDS, SECTION_FIELDS, T,
  all, approversOf, byId, employeeNames, freeId, inForce, isActive, istDay, list, myEmployees, myJobs, unique, waitingName,
  type ActionContext, type ChangeProposal, type ReadContext, type Row, type ApproverRequest,
} from './my-sections.ts'
import { istToday } from './report.ts'
import { exact, text } from './values.ts'

const D = { department: 'Department', link: 'Department Section' } as const
/** The two Tables a set-up writes, which an administrator lists in `linked_tables` beside Your sections' own. */
export const DEPARTMENT_TABLES: readonly string[] = Object.values(D)
const DEPARTMENT_FIELDS = ['department_id', 'store', 'name', 'manager', 'starts_on', 'ends_on']
const LINK_FIELDS = ['department_section_id', 'store', 'department', 'section', 'starts_on', 'ends_on']
const JOB = 'Department Manager'
/** How far up a Team Leader's reporting line a Department Manager may sit for their section to be suggested. */
const STEPS = 5
const NAME_LIMIT = 60
const SELLS_SHOWN = 3
const NAMES_SHOWN = 12
/**
 * The approval type every set-up names (#1191). Not an access grant (manager, for the owner, 11-Nov-2026):
 * it reaches only sections of the person's own store, and can be undone. The instance's Approval Type row
 * `dash.department_setup` decides whether it applies at once and is reviewed after, or waits for approval.
 */
export const DEPARTMENT_TYPE = 'department_setup'
/** A set-up still open to its reviewer: asked for and waiting, or applied and not yet reviewed (#1191). */
const OPEN = ['Pending', 'Not yet reviewed']
const APPLIED_UNREVIEWED = 'Not yet reviewed'

/** Takes a bundle back: withdrawn while it waits; undone, links first, once it applied (#1191). */
async function takeBack(ctx: ActionContext, parts: ChangeProposal[], approvers: ApproverRequest, reason?: string) {
  for (const part of [...parts].reverse()) {
    if (part.state === APPLIED_UNREVIEWED) await ctx.changeProposals.undo!(part.row_id, { approvers, ...(reason ? { reason } : {}) })
    else if (reason) await ctx.changeProposals.reject(part.row_id, { approvers, reason })
    else await ctx.changeProposals.withdraw(part.row_id)
  }
}

type Ctx = ReadContext | ActionContext
interface About {
  kind: 'department' | 'department_section'
  bundle: string
  job_assignment: string
  site: string
  store: string
  name: string
  sections: string[]
  section_names: string[]
  maker_name: string
  manager_name: string | null
  section?: string
}
const about = (proposal: ChangeProposal) => (proposal.about ?? {}) as unknown as About
const isDepartmentKind = (proposal: ChangeProposal) => ['department', 'department_section'].includes(String(about(proposal).kind))

const isSetUp = (ctx: Ctx) => {
  try {
    const listed: unknown = JSON.parse(ctx.settings.linked_tables ?? '[]')
    return Array.isArray(listed) && [...BASE_TABLES, ...DEPARTMENT_TABLES].every(table => listed.includes(table))
  } catch { return false }
}
const payloadOf = (ctx: Ctx) => (ctx.payload ?? {}) as Record<string, unknown>
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The caller's Department Manager job: the one named, else their first. */
async function myDepartmentJob(ctx: Ctx, named: unknown, today: string) {
  const employees = await myEmployees(ctx)
  if (!employees.length) return { employees, job: null }
  const jobs = (await myJobs(ctx, employees, today)).filter(job => text(job.job) === JOB)
  const job = typeof named === 'string' && named ? jobs.find(row => exact(row.row_id) === named) : jobs[0]
  return { employees, job: job ?? null }
}

/** Everything about one store that a set-up reads, on the day. */
async function storeOf(ctx: Ctx, site: string, today: string) {
  const [siteRow] = await list(ctx, T.site, ['name'], [['row_id', '=', site]])
  const sections = (await all(ctx, T.section, SECTION_FIELDS, [['site', '=', site]])).filter(isActive)
  const departments = (await all(ctx, D.department, DEPARTMENT_FIELDS, [['store', '=', site]])).filter(row => inForce(row, today))
  const links = (await all(ctx, D.link, LINK_FIELDS, [['store', '=', site]])).filter(row => inForce(row, today))
  const departmentById = byId(departments)
  /** The department holding each section now. */
  const holding = new Map<string, Row>()
  for (const link of links) {
    const department = departmentById.get(exact(link.department))
    if (department) holding.set(exact(link.section), department)
  }
  return { store: text(siteRow?.name), sections, departments, links, holding }
}

/** Who reviews a job's set-up, by name: their manager while they can sign in, else the master data team. */
async function reviewerOf(ctx: Ctx, job: Row): Promise<string> {
  const route = await ctx.changeProposals.routeFor(ctx.user, (await approversOf(ctx, job)).approvers)
  return waitingName(ctx, route?.people ?? [])
}
/** Whether the reviewer is the master data team rather than one person, which the page words differently. */
const isTeam = (reviewer: string) => reviewer === MASTER_DATA_TEAM

/** A name already in force at the store, compared without case or spaces at the ends. */
function nameTaken(ctx: Ctx, departments: Row[], name: string, store: string): void {
  if (departments.some(row => sameName(text(row.name), name))) ctx.reject(`${store} already has a department called ${name}`)
}

/** The caller's proposals for this job's set-ups, newest first. */
async function myBundles(ctx: Ctx, jobId: string): Promise<ChangeProposal[]> {
  const mine = await ctx.changeProposals.list({ makers: [ctx.user], limit: 200 })
  return mine.filter(p => about(p).kind === 'department' && about(p).job_assignment === jobId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** The pending parts of one bundle, the department first. */
async function pendingBundle(ctx: Ctx, bundle: unknown, makers?: string[]): Promise<ChangeProposal[]> {
  if (typeof bundle !== 'string' || !bundle) return []
  const parts: ChangeProposal[] = []
  for (let start = 0; ; start += 500) {
    const page = await ctx.changeProposals.list({ states: OPEN, limit: 500, start, ...(makers ? { makers } : {}) })
    parts.push(...page.filter(p => isDepartmentKind(p) && about(p).bundle === bundle))
    if (page.length < 500) break
  }
  return parts.sort((a, b) => Number(about(b).kind === 'department') - Number(about(a).kind === 'department') || a.row_id.localeCompare(b.row_id))
}

/** Each section's Team Leaders now, by name. */
async function teamLeadersOf(ctx: Ctx, site: string, today: string): Promise<{ jobs: Row[]; leaders: Map<string, string[]> }> {
  const jobs = (await all(ctx, T.job, JOB_FIELDS, [['site', '=', site]])).filter(job => inForce(job, today))
  const leads = jobs.filter(job => text(job.job) === 'Team Leader' && exact(job.section))
  const names = await employeeNames(ctx, leads.map(job => exact(job.employee)))
  const leaders = new Map<string, string[]>()
  for (const lead of leads) {
    const name = names.get(exact(lead.employee))
    if (name) leaders.set(exact(lead.section), unique([...(leaders.get(exact(lead.section)) ?? []), name]).sort((a, b) => a.localeCompare(b)))
  }
  return { jobs, leaders }
}

export const departmentReads = {
  /** What the set-up page shows the signed-in Department Manager. */
  async department_setup(ctx: ReadContext) {
    if (!isSetUp(ctx)) return { state: 'not_set_up' as const }
    const today = istToday()
    const { employees, job } = await myDepartmentJob(ctx, payloadOf(ctx).job, today)
    if (!employees.length) return { state: 'unknown_person' as const }
    if (!job) return { state: 'no_job' as const }
    const site = exact(job.site)
    const shop = await storeOf(ctx, site, today)
    const reviewer = await reviewerOf(ctx, job)
    const jobView = { id: exact(job.row_id), store: shop.store }
    if (!shop.sections.length) return { state: 'no_sections' as const, job: jobView, reviewer, reviewer_is_team: isTeam(reviewer) }

    const me = new Set(employees.map(e => exact(e.row_id)))
    const { jobs, leaders } = await teamLeadersOf(ctx, site, today)
    // Up the reporting line, at most STEPS people, never round a loop.
    const reportsTo = new Map<string, string>()
    for (const row of jobs) if (!reportsTo.has(exact(row.employee))) reportsTo.set(exact(row.employee), exact(row.reports_to))
    const reachesMe = (from: string) => {
      const seen = new Set([from])
      for (let at = from, step = 0; step < STEPS; step++) {
        at = reportsTo.get(at) ?? ''
        if (!at || seen.has(at)) return false
        if (me.has(at)) return true
        seen.add(at)
      }
      return false
    }
    const suggested = new Set(jobs.filter(row => text(row.job) === 'Team Leader' && exact(row.section) && reachesMe(exact(row.employee))).map(row => exact(row.section)))

    const floorRows = (await all(ctx, T.floor, ['name', 'site'], [['site', '=', site]]))
    const used = new Set(shop.sections.map(s => exact(s.floor)))
    const floors = [...floorRows.filter(f => used.has(exact(f.row_id))).map(f => ({ id: exact(f.row_id), name: text(f.name) })),
      ...(used.has('') ? [{ id: '', name: 'No floor' }] : [])]
    const order = new Map(floors.map((f, i) => [f.id, i]))

    const placements = (await all(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site]])).filter(row => inForce(row, today))
    const leaves = placements.length ? byId(await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', unique(placements.map(p => exact(p.subcategory)))]])) : new Map<string, Row>()
    const managers = await employeeNames(ctx, shop.departments.map(d => exact(d.manager)))
    const sections = shop.sections.map(section => {
      const id = exact(section.row_id)
      const sells = unique(placements.filter(p => exact(p.section) === id).map(p => text(leaves.get(exact(p.subcategory))?.subcategory)))
        .sort((a, b) => a.localeCompare(b))
      const holder = shop.holding.get(id)
      const heldByOther = holder && !me.has(exact(holder.manager))
      return { id, name: text(section.name), floor: exact(section.floor), sells: sells.slice(0, SELLS_SHOWN), more: Math.max(0, sells.length - SELLS_SHOWN),
        team_leaders: leaders.get(id) ?? [], suggested: suggested.has(id),
        held_by: heldByOther ? `${text(holder.name)} (${managers.get(exact(holder.manager)) ?? 'no manager now'})` : null }
    }).sort((a, b) => order.get(a.floor)! - order.get(b.floor)! || a.name.localeCompare(b.name))

    const perFloor = new Map<string, number>()
    for (const s of sections) if (s.suggested) perFloor.set(s.floor, (perFloor.get(s.floor) ?? 0) + 1)
    const most = Math.max(0, ...perFloor.values())
    const start_floors = most ? floors.map(f => f.id).filter(id => perFloor.get(id) === most) : floors.map(f => f.id)

    // Names other stores use, most used first: one company, one vocabulary.
    const elsewhere = (await all(ctx, D.department, DEPARTMENT_FIELDS, [])).filter(row => inForce(row, today) && exact(row.store) !== site)
    const counts = new Map<string, number>()
    for (const row of elsewhere) counts.set(text(row.name), (counts.get(text(row.name)) ?? 0) + 1)
    const names = [...counts].filter(([name]) => name && !shop.departments.some(d => sameName(text(d.name), name)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, NAMES_SHOWN).map(([name]) => name)

    return { state: 'ok' as const, name: text(employees[0].name), job: jobView, reviewer, reviewer_is_team: isTeam(reviewer), floors, start_floors, sections, names,
      current: await currentOf(ctx, job, shop, me) }
  },

  /** Whether the signed-in person holds a Department Manager job now: the sidebar offers Your department. */
  async holds_department_job(ctx: ReadContext) {
    return isSetUp(ctx) && (await myDepartmentJob(ctx, undefined, istToday())).job !== null
  },

  /** The set-ups waiting for this person's decision, one entry per bundle. */
  async department_approvals(ctx: ReadContext) {
    if (!isSetUp(ctx)) return []
    const today = istToday()
    const heads: ChangeProposal[] = []
    for (let start = 0; ; start += 500) {
      const page = await ctx.changeProposals.list({ states: OPEN, limit: 500, start })
      heads.push(...page.filter(p => about(p).kind === 'department' && p.maker !== ctx.user))
      if (page.length < 500) break
    }
    const jobs = heads.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', unique(heads.map(p => about(p).job_assignment))]])) : new Map<string, Row>()
    const mine: ChangeProposal[] = []
    for (const head of heads)
      if (await ctx.changeProposals.mayDecide(head.maker, (await approversOf(ctx, jobs.get(about(head).job_assignment))).approvers)) mine.push(head)
    const answers = []
    for (const head of mine.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const a = about(head)
      const { leaders } = await teamLeadersOf(ctx, a.site, today)
      answers.push({ bundle: a.bundle, who: a.maker_name, job: JOB, store: a.store, name: a.name, asked_on: istDay(head.created_at), applied: head.state === APPLIED_UNREVIEWED,
        sections: a.sections.map((id, i) => ({ id, name: a.section_names[i], team_leaders: leaders.get(id) ?? [] })) })
    }
    return answers
  },
}

/** Their department now, else a set-up that waits, else why the last one was turned down. */
async function currentOf(ctx: Ctx, job: Row, shop: Awaited<ReturnType<typeof storeOf>>, me: Set<string>) {
  const [latest] = await myBundles(ctx, exact(job.row_id))
  const own = shop.departments.find(d => me.has(exact(d.manager)))
  if (own) {
    const ids = new Set(shop.links.filter(l => exact(l.department) === exact(own.row_id)).map(l => exact(l.section)))
    // #1191: applied at once, the report is open while the reviewer has yet to look.
    const reviewing = latest?.state === APPLIED_UNREVIEWED ? { bundle: about(latest).bundle, waiting_for: await waitingName(ctx, latest.route.people) } : null
    return { state: 'set_up' as const, name: text(own.name), sections: shop.sections.filter(s => ids.has(exact(s.row_id))).map(s => text(s.name)).sort((a, b) => a.localeCompare(b)), reviewing }
  }
  if (!latest) return null
  const a = about(latest)
  if (latest.state === 'Pending')
    return { state: 'waiting' as const, bundle: a.bundle, name: a.name, sections: a.section_names, waiting_for: await waitingName(ctx, latest.route.people), asked_on: istDay(latest.created_at) }
  // #1191: a reviewer's undo is a turn-down, with their reason; the maker's own undo is a take-back.
  const undoneByReviewer = latest.state === 'Undone' && latest.decided_by !== latest.maker
  if (latest.state === 'Rejected' || latest.state === 'Needs fresh review' || undoneByReviewer)
    return { state: 'turned_down' as const, name: a.name, sections: a.section_names, reason: latest.decision_reason ?? '' }
  return null
}

export const departmentActions = {
  /** Sends a set-up: the department, then one link per ticked section. */
  async set_up_department(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const today = istToday()
    const { employees, job } = await myDepartmentJob(ctx, payload.job, today)
    if (!job || !isSetUp(ctx)) ctx.reject('That is not a Department Manager job of yours')
    const site = exact(job!.site)
    // One set-up at a time per store: two people can't both claim a section.
    await ctx.changeProposals.serialize(`department:${site}`)
    const { approvers, manager } = await approversOf(ctx, job!)
    // "Change it" sends the new one in place of the open one, in this one action.
    const replaced = await pendingBundle(ctx, payload.replaces, [ctx.user])
    await takeBack(ctx, replaced, approvers)
    const shop = await storeOf(ctx, site, today)
    const me = new Set(employees.map(e => exact(e.row_id)))
    if (shop.departments.some(d => me.has(exact(d.manager)))) ctx.reject('You already have a department here')
    if ((await myBundles(ctx, exact(job!.row_id))).some(p => OPEN.includes(p.state) && !replaced.some(r => r.row_id === p.row_id))) ctx.reject('You already sent one. Change or withdraw it first')
    const picked = payload.sections
    if (!Array.isArray(picked) || !picked.length || picked.some(id => typeof id !== 'string')) ctx.reject('Tick at least one section')
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) ctx.reject('Give your department a name')
    if (name.length > NAME_LIMIT) ctx.reject(`Keep the name to ${NAME_LIMIT} characters`)
    nameTaken(ctx, shop.departments, name, shop.store)
    const reviewer = await reviewerOf(ctx, job!)
    const allHere = byId(await all(ctx, T.section, SECTION_FIELDS, [['site', '=', site]]))
    for (const id of unique(picked as string[])) {
      const section = allHere.get(id)
      if (!section) ctx.reject(`Pick sections in ${shop.store}`)
      if (!isActive(section)) ctx.reject(`${text(section!.name)} is no longer open`)
      const holder = shop.holding.get(id)
      if (holder) ctx.reject(`${text(section!.name)} is already in ${text(holder.name)}. Ask ${reviewer} to move it`)
    }
    // In name order, as every list on the page reads.
    const ids = unique(picked as string[]).sort((a, b) => text(allHere.get(a)!.name).localeCompare(text(allHere.get(b)!.name)) || a.localeCompare(b))
    const names = ids.map(id => text(allHere.get(id)!.name))
    const employee = employees.find(e => exact(e.row_id) === exact(job!.employee))!
    const shared: Omit<About, 'kind'> = { bundle: `${exact(job!.row_id)}:${globalThis.crypto.randomUUID()}`, job_assignment: exact(job!.row_id), site, store: shop.store,
      name, sections: ids, section_names: names, maker_name: text(employee.name), manager_name: manager }
    // #1191: every proposal names its type and carries its own id; the instance's mode decides whether it applies now.
    const applied = async (table: string, base: string, column: string) =>
      ({ type: DEPARTMENT_TYPE, apply: { effectiveOn: today, newRow: { [column]: await freeId(ctx, table, base), source_key: `Dash, set up ${today}` } } })
    const head = await ctx.changeProposals.propose({ ...await applied(D.department, `${site}-${name}-${today}`, 'department_id'), table: D.department, row: null, changes: { store: site, name, manager: exact(employee.row_id) },
      approvers, about: { ...shared, kind: 'department' } as unknown as Record<string, unknown> })
    // Under "apply now, review after" (#1191) the Department exists at once, so each link names it;
    // reviewed first, the link names it when the Department is applied (decide_department).
    const department = head.result_row ? String(head.result_row) : null
    for (const id of ids)
      await ctx.changeProposals.propose({ ...await applied(D.link, `${site}-${id}-${today}`, 'department_section_id'), table: D.link, row: null, changes: { store: site, section: id, department },
        approvers, about: { ...shared, kind: 'department_section', section: id } as unknown as Record<string, unknown> })
    return { state: head.state === APPLIED_UNREVIEWED ? 'set_up' as const : 'waiting' as const, bundle: shared.bundle, name, sections: names, waiting_for: await waitingName(ctx, head.route.people), asked_on: today }
  },

  /** Takes back the caller's own set-up while it waits. */
  async withdraw_department(ctx: ActionContext) {
    const parts = await pendingBundle(ctx, payloadOf(ctx).bundle, [ctx.user])
    if (!parts.length) ctx.reject('That set-up is no longer waiting')
    const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', about(parts[0]).job_assignment]])
    await takeBack(ctx, parts, (await approversOf(ctx, job)).approvers)
    return { withdrawn: parts.length }
  },

  /** The reviewer keeps it (as sent, renamed, or with fewer sections) or turns it down. */
  async decide_department(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const parts = await pendingBundle(ctx, payload.bundle)
    const head = parts.find(p => about(p).kind === 'department')
    if (!head) ctx.reject('That set-up is no longer waiting')
    if (payload.decision !== 'approve' && payload.decision !== 'reject') ctx.reject('Keep it or turn it down')
    const a = about(head!)
    const today = istToday()
    await ctx.changeProposals.serialize(`department:${a.site}`)
    const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', a.job_assignment]])
    const { approvers } = await approversOf(ctx, job)
    const links = parts.filter(p => p !== head)
    if (payload.decision === 'reject') {
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
      if (!reason) ctx.reject('Say why it is turned down')
      await takeBack(ctx, parts, approvers, reason)
      return { state: head!.state === APPLIED_UNREVIEWED ? 'Undone' : 'Rejected', department: null }
    }
    // #1191: applied at once, keeping it confirms it; unticked sections are undone, and its name stays.
    if (head!.state === APPLIED_UNREVIEWED) {
      if (typeof payload.name === 'string' && payload.name.trim() && payload.name.trim() !== a.name) ctx.reject('A department in use keeps its name. Keep it, then ask the master data team to rename it')
      const keepIds = Array.isArray(payload.sections) ? new Set(payload.sections.filter((id): id is string => typeof id === 'string')) : new Set(a.sections)
      if (!keepIds.size) ctx.reject('Keep at least one section')
      for (const link of links) {
        if (keepIds.has(String(about(link).section))) await ctx.changeProposals.confirm!(link.row_id, { approvers })
        else await ctx.changeProposals.undo!(link.row_id, { approvers, reason: 'Left out by the reviewer.' })
      }
      const kept = await ctx.changeProposals.confirm!(head!.row_id, { approvers })
      // Applied at once, the department row exists: it is the proposal's result.
      return { state: kept.state, department: String(head!.result_row) }
    }
    const shop = await storeOf(ctx, a.site, today)
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : a.name
    if (name.length > NAME_LIMIT) ctx.reject(`Keep the name to ${NAME_LIMIT} characters`)
    nameTaken(ctx, shop.departments, name, shop.store)
    const keep = Array.isArray(payload.sections) ? new Set(payload.sections.filter((id): id is string => typeof id === 'string')) : new Set(a.sections)
    if (!keep.size) ctx.reject('Keep at least one section')
    // A section another department took after this was sent: nothing applies, and the maker is told.
    const sectionNames = byId(shop.sections)
    const taken = [...keep].sort().find(id => shop.holding.has(id))
    if (taken) {
      const reason = `${text(sectionNames.get(taken)!.name)} is now in ${text(shop.holding.get(taken)!.name)}.`
      for (const part of parts) await ctx.changeProposals.needsFreshReview(part.row_id, { approvers, reason })
      return { state: 'Needs fresh review', department: null }
    }
    const source_key = `Dash, approved ${today}`
    const renamed = name !== a.name
    const decided = await ctx.changeProposals.approve(head!.row_id, { approvers, effectiveOn: today,
      newRow: { department_id: await freeId(ctx, D.department, `${a.site}-${name}-${today}`), source_key },
      ...(renamed ? { instead: { name }, reason: `Named ${name} instead.` } : {}) })
    for (const link of links) {
      const section = String(about(link).section)
      if (!keep.has(section)) { await ctx.changeProposals.reject(link.row_id, { approvers, reason: 'Left out by the reviewer.' }); continue }
      await ctx.changeProposals.approve(link.row_id, { approvers, effectiveOn: today, instead: { department: String(decided.result_row) },
        newRow: { department_section_id: await freeId(ctx, D.link, `${a.site}-${section}-${today}`), source_key } })
    }
    return { state: decided.state, department: decided.result_row }
  },
}

