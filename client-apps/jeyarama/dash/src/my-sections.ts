// Your sections, and the approvals behind them (#975). A person sees what is mapped to them and
// proposes a correction; their manager decides. Everything is read from and written to the base
// Tables: Dash keeps no copy. These reads run as the app, so each answer here is limited to what
// this person may see, by this code.
import { istToday } from './report.ts'
import { EMPLOYEE_STATUS, SECTION_STATUS, day, exact, text } from './values.ts'

type Row = Record<string, unknown>
// The platform's helpers, structurally: this module imports nothing from the platform.
type Filter = [string, string, unknown]
interface ApproverRequest { people: string[]; fallbackRoles: string[] }
interface ChangeProposal {
  row_id: string; maker: string; state: string; about: unknown; decision_reason: string | null; ends_row?: boolean
  changes: { column_name: string; proposed_value: string | null; review_base_value: string | null }[]
  created_at: string; decided_at: string | null; route: { people: string[]; roles: string[] }
}
interface ProposalList { ids?: string[]; states?: string[]; makers?: string[]; limit?: number; start?: number }
interface BaseTablesHelper { list(table: string, args: { fields: string[]; filters?: Filter[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]> }
interface ChangeProposalsReader {
  list(filter?: ProposalList): Promise<ChangeProposal[]>
  mayDecide(maker: string, approvers: ApproverRequest): Promise<boolean>
  routeFor(maker: string, approvers: ApproverRequest): Promise<{ people: string[]; roles: string[] } | null>
}
interface ChangeProposalsHelper extends ChangeProposalsReader {
  lockRow(table: string, rowId: string): Promise<void>
  serialize(key: string): Promise<void>
  propose(request: { table: string; row: string | null; changes: Record<string, string | null>; reviewed?: string[]; ends?: boolean; approvers: ApproverRequest; about: Record<string, unknown> }): Promise<ChangeProposal>
  approve(id: string, decision: { approvers: ApproverRequest; effectiveOn: string; newRow?: Record<string, string | null>; instead?: Record<string, string | null>; reason?: string }): Promise<ChangeProposal>
  withdraw(id: string): Promise<ChangeProposal>
  reject(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
  needsFreshReview(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
}

const T = { employee: 'Employee', job: 'Job Assignment', section: 'Section', floor: 'Store Floor', placement: 'Section Subcategory', subcategory: 'Subcategory', site: 'Site' } as const
/** Every base Table an administrator must list in the `linked_tables` setting. */
export const BASE_TABLES: readonly string[] = Object.values(T)

/** Who approves when a person has no manager who can sign in. */
export const FALLBACK_ROLE = 'Master Data Editor'
const MASTER_DATA_TEAM = 'the master data team'

/** `move` is the old "pick where it goes" proposal: none are made now, but production holds some. */
export type ProposalKind = 'removal' | 'add' | 'move' | 'section'
/** What the proposal says it is about, frozen when it is made: names for people, ids for the rules. */
interface About {
  kind: ProposalKind
  what: string
  from: string
  to: string
  store: string
  site: string
  maker_name: string
  manager_name: string | null
  job_assignment: string
  subcategory?: string
  from_section?: string
  /** Empty for a removal: it goes to no section. */
  to_section: string
}

interface BaseContext {
  user: string
  roles?: readonly string[]
  payload?: unknown
  settings: Readonly<Record<string, string>>
  reject(message: string): never
  baseTables: BaseTablesHelper
}
export interface ReadContext extends BaseContext { changeProposals: ChangeProposalsReader }
export interface ActionContext extends BaseContext { changeProposals: ChangeProposalsHelper }

const IS_SET_UP = (ctx: BaseContext) => {
  try {
    const listed: unknown = JSON.parse(ctx.settings.linked_tables ?? '[]')
    return Array.isArray(listed) && BASE_TABLES.every(table => listed.includes(table))
  } catch { return false }
}

const list = (ctx: BaseContext, table: string, fields: string[], filters: Filter[], limit = 500) =>
  ctx.baseTables.list(table, { fields: ['row_id', ...fields], filters, limit_page_length: limit })

/** Every matching row, however many pages: a large store has over a thousand placements. */
async function all(ctx: BaseContext, table: string, fields: string[], filters: Filter[]): Promise<Row[]> {
  const rows: Row[] = []
  for (let start = 0; ; start += 500) {
    const page = await ctx.baseTables.list(table, { fields: ['row_id', ...fields], filters, limit_start: start, limit_page_length: 500, order_by: 'row_id asc' })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

const inForce = (row: Row, today: string) => {
  const starts = day(row.starts_on)
  const ends = day(row.ends_on)
  return (!starts || starts <= today) && (!ends || ends >= today)
}
/** Not over yet: in force today, or set to start later. */
const notOver = (row: Row, today: string) => !day(row.ends_on) || day(row.ends_on) >= today
const JOB_FIELDS = ['employee', 'job', 'site', 'floor', 'section', 'reports_to', 'starts_on', 'ends_on']
const PLACEMENT_FIELDS = ['section_subcategory_id', 'store', 'subcategory', 'section', 'starts_on', 'ends_on']
const SECTION_FIELDS = ['name', 'site', 'floor', SECTION_STATUS]
const isActive = (section: Row | undefined) => exact(section?.[SECTION_STATUS]) === 'Active'
const byId = (rows: Row[]) => new Map(rows.map(row => [exact(row.row_id), row]))
const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

/** The caller's current staff rows. A leaver or a test record is nobody on this screen. */
const myEmployees = (ctx: BaseContext) => list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', '=', ctx.user], [EMPLOYEE_STATUS, '=', 'Current']])

async function myJobs(ctx: BaseContext, employees: Row[], today: string): Promise<Row[]> {
  if (!employees.length) return []
  return (await list(ctx, T.job, JOB_FIELDS, [['employee', 'in', employees.map(e => exact(e.row_id))]])).filter(job => inForce(job, today))
}

/** The caller's job by id, current and theirs, or a refusal. */
async function myJob(ctx: ActionContext, id: unknown, today: string) {
  const employees = await myEmployees(ctx)
  const job = (await myJobs(ctx, employees, today)).find(row => exact(row.row_id) === id)
  if (!job) ctx.reject('That is not a job of yours')
  return { job: job!, employee: employees.find(e => exact(e.row_id) === exact(job!.employee))! }
}

/** The approver of a job: its manager, while they are on the staff and have a sign-in; else the role. */
async function approversOf(ctx: BaseContext, job: Row | undefined): Promise<{ approvers: ApproverRequest; manager: string | null; reportsTo: string | null }> {
  const managerId = exact(job?.reports_to)
  const [manager] = managerId ? await list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['row_id', '=', managerId]]) : []
  const person = exact(manager?.[EMPLOYEE_STATUS]) === 'Current' ? exact(manager?.person) : ''
  return { approvers: { people: person ? [person] : [], fallbackRoles: [FALLBACK_ROLE] }, manager: person ? text(manager.name) : null, reportsTo: text(manager?.name) || null }
}

/** A later placement of this subcategory here: an open-ended new row would overlap it. */
async function scheduledLater(ctx: BaseContext, site: string, subcategory: string, today: string): Promise<boolean> {
  const rows = await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', subcategory]])
  return rows.some(row => notOver(row, today) && day(row.starts_on) > today)
}
const SCHEDULED = 'A change to that subcategory is already planned here. Ask the master data team to look at it'

const about = (proposal: ChangeProposal) => (proposal.about ?? {}) as unknown as About
const VIEW_LIMIT = 50
const SUB_FIELDS = ['subcategory', 'division', 'subdivision', 'category', 'subcategory_type']
/** A subcategory's place in the merchandise hierarchy, as its row holds it. */
const pathOf = (row: Row | undefined) => ({ division: text(row?.division), subdivision: text(row?.subdivision), category: text(row?.category) })
const isMerchandise = (row: Row | undefined) => row?.subcategory_type === 'Merchandise'

/** The Team Leaders holding these sections now. */
async function holdersOf(ctx: BaseContext, sections: string[], today: string): Promise<Row[]> {
  if (!sections.length) return []
  return (await list(ctx, T.job, JOB_FIELDS, [['section', 'in', sections]])).filter(job => inForce(job, today) && text(job.job) === 'Team Leader')
}
async function employeeNames(ctx: BaseContext, ids: string[]): Promise<Map<string, string>> {
  const wanted = unique(ids)
  return wanted.length ? new Map((await list(ctx, T.employee, ['name'], [['row_id', 'in', wanted]])).map(e => [exact(e.row_id), text(e.name)])) : new Map()
}
/** The names of the people a proposal waits for, in their order. */
async function waitingName(ctx: BaseContext, people: string[]): Promise<string> {
  if (!people.length) return MASTER_DATA_TEAM
  const staff = (await list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', 'in', people]])).filter(e => exact(e[EMPLOYEE_STATUS]) === 'Current')
  const names = unique(people.map(person => text(staff.find(e => exact(e.person) === person)?.name)))
  return names.length ? names.sort((a, b) => a.localeCompare(b)).join(' or ') : MASTER_DATA_TEAM
}

/** Who decides: the asker's manager; for a subcategory taken from another Team Leader, theirs too.
 *  Either one's decision settles it (#1175), so a wrong grab can be stopped and nobody waits on two. */
async function approversFor(ctx: BaseContext, a: Pick<About, 'kind' | 'from_section' | 'job_assignment'>, job: Row | undefined, today: string): Promise<ApproverRequest> {
  const { approvers } = await approversOf(ctx, job)
  if (a.kind !== 'add' || !a.from_section) return approvers
  const people = [...approvers.people]
  for (const holder of await holdersOf(ctx, [a.from_section], today)) {
    if (exact(holder.row_id) === a.job_assignment) continue
    people.push(...(await approversOf(ctx, holder)).approvers.people)
  }
  return { people: unique(people), fallbackRoles: approvers.fallbackRoles }
}

/** Who a job's proposal goes to now: authority moves with the job, so this is read fresh. */
async function waitingOnNow(ctx: ReadContext, job: Row | undefined, maker: string, a?: About): Promise<string> {
  const approvers = a ? await approversFor(ctx, a, job, istToday()) : (await approversOf(ctx, job)).approvers
  const route = await ctx.changeProposals.routeFor(maker, approvers)
  return waitingName(ctx, route?.people ?? [])
}

/** The day in India of a timestamp, or '' for none. */
const istDay = (at: string | null) => (at ? istToday(Date.parse(at)) : '')
const dayAfter = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** A proposal as a person reads it: names only. */
function view(proposal: ChangeProposal, waitingFor?: string) {
  const a = about(proposal)
  return { id: proposal.row_id, kind: a.kind, what: a.what, from: a.from, to: a.to, store: a.store, state: proposal.state,
    waiting_for: waitingFor ?? (proposal.route.people.length ? a.manager_name : null) ?? MASTER_DATA_TEAM,
    reason: proposal.decision_reason, asked_on: istDay(proposal.created_at), decided_on: istDay(proposal.decided_at) }
}
const sentView = async (ctx: BaseContext, proposal: ChangeProposal) => view(proposal, await waitingName(ctx, proposal.route.people))

/** The pending proposals this caller may decide now. */
async function waitingForMe(ctx: ReadContext): Promise<ChangeProposal[]> {
  const mine: ChangeProposal[] = []
  const today = istToday()
  for (let start = 0; ; start += 500) {
    const pending = await ctx.changeProposals.list({ states: ['Pending'], limit: 500, start })
    const others = pending.filter(proposal => proposal.maker !== ctx.user)
    const jobs = others.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', unique(others.map(p => about(p).job_assignment))]])) : new Map<string, Row>()
    for (const proposal of others) {
      const a = about(proposal)
      if (await ctx.changeProposals.mayDecide(proposal.maker, await approversFor(ctx, a, jobs.get(a.job_assignment), today))) mine.push(proposal)
    }
    if (pending.length < 500) return mine
  }
}

/** The caller's job by id, for a read. */
async function myJobToRead(ctx: ReadContext, id: unknown, today: string): Promise<Row> {
  const job = (await myJobs(ctx, await myEmployees(ctx), today)).find(row => exact(row.row_id) === id)
  if (!job) ctx.reject('That is not a job of yours')
  return job!
}
/** Every merchandise subcategory, retired ones left out by the platform. */
const allLeaves = (ctx: BaseContext) => all(ctx, T.subcategory, SUB_FIELDS, [['subcategory_type', '=', 'Merchandise']])
const asFilter = (value: unknown) => (typeof value === 'string' && value ? value : null)

export const reads = {
  /** Everything Your sections shows, for the signed-in person alone. */
  async my_sections(ctx: ReadContext) {
    if (!IS_SET_UP(ctx)) return { state: 'not_set_up' as const }
    const today = istToday()
    const employees = await myEmployees(ctx)
    if (!employees.length) return { state: 'unknown_person' as const }
    const jobs = await myJobs(ctx, employees, today)
    const sites = unique(jobs.map(job => exact(job.site)))
    const held = unique(jobs.map(job => exact(job.section)))
    const siteRows = sites.length ? byId(await list(ctx, T.site, ['name', 'is_store'], [['row_id', 'in', sites]])) : new Map<string, Row>()
    const sections = sites.length ? await all(ctx, T.section, SECTION_FIELDS, [['site', 'in', sites]]) : []
    const sectionsById = byId(sections)
    const floors = sites.length ? byId(await all(ctx, T.floor, ['name', 'site'], [['site', 'in', sites]])) : new Map<string, Row>()
    const placements = held.length ? (await all(ctx, T.placement, PLACEMENT_FIELDS, [['section', 'in', held]])).filter(row => inForce(row, today)) : []
    const mine = await ctx.changeProposals.list({ makers: [ctx.user], limit: VIEW_LIMIT })
    const pending = mine.filter(p => p.state === 'Pending')
    const codes = unique([...placements.map(p => exact(p.subcategory)), ...pending.map(p => exact(about(p).subcategory))])
    const leaves = codes.length ? byId(await all(ctx, T.subcategory, SUB_FIELDS, [['row_id', 'in', codes]])) : new Map<string, Row>()
    const floorName = (section: Row | undefined) => text(floors.get(exact(section?.floor))?.name) || null
    const pendingJobs = unique(pending.map(p => about(p).job_assignment))
    const pendingJobRows = pendingJobs.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', pendingJobs]])) : new Map<string, Row>()
    const waiting = new Map<string, string>()
    for (const p of pending) waiting.set(p.row_id, await waitingOnNow(ctx, pendingJobRows.get(about(p).job_assignment), ctx.user, about(p)))
    const shown = mine.map(p => view(p, waiting.get(p.row_id)))
    const views = []
    for (const job of jobs) {
      const site = exact(job.site)
      const section = sectionsById.get(exact(job.section))
      const { reportsTo } = await approversOf(ctx, job)
      const ours = pending.filter(p => about(p).job_assignment === exact(job.row_id))
      const outOf = (code: string) => ours.find(p => ['removal', 'move'].includes(about(p).kind) && about(p).subcategory === code)
      views.push({
        id: exact(job.row_id), job: text(job.job), store: text(siteRows.get(site)?.name), is_store: siteRows.get(site)?.is_store === true,
        reports_to: reportsTo,
        waiting_for: await waitingOnNow(ctx, job, ctx.user),
        section: section ? { id: exact(section.row_id), name: text(section.name), floor: floorName(section) } : null,
        subcategories: section ? placements.filter(p => exact(p.section) === exact(section.row_id))
          .map(p => {
            const code = exact(p.subcategory)
            const asked = outOf(code)
            return { id: exact(p.row_id), code, name: text(leaves.get(code)?.subcategory) || 'Unnamed subcategory', ...pathOf(leaves.get(code)),
              pending: asked ? { id: asked.row_id, kind: about(asked).kind, to: about(asked).kind === 'move' ? about(asked).to : null, waiting_for: waiting.get(asked.row_id)! } : null }
          })
          .sort((a, b) => a.name.localeCompare(b.name)) : [],
        additions: section ? ours.filter(p => about(p).kind === 'add' && about(p).to_section === exact(section.row_id))
          .map(p => ({ id: p.row_id, code: exact(about(p).subcategory), name: text(leaves.get(exact(about(p).subcategory))?.subcategory) || about(p).what,
            ...pathOf(leaves.get(exact(about(p).subcategory))), waiting_for: waiting.get(p.row_id)! }))
          .sort((a, b) => a.name.localeCompare(b.name)) : [],
        other_sections: sections.filter(s => exact(s.site) === site && isActive(s) && exact(s.row_id) !== exact(job.section))
          .map(s => ({ id: exact(s.row_id), name: text(s.name), floor: floorName(s) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    return { state: 'ok' as const, name: text(employees[0].name), jobs: views, proposals: shown, waiting_for_me: (await waitingForMe(ctx)).length }
  },

  /** Division, sub-division and category, for browsing; starting at the job's own division and sub-division. */
  async subcategory_levels(ctx: ReadContext) {
    const { job: jobId } = (ctx.payload ?? {}) as { job?: unknown }
    if (!IS_SET_UP(ctx)) return { start: null, levels: [] }
    const today = istToday()
    const job = await myJobToRead(ctx, jobId, today)
    const leaves = await allLeaves(ctx)
    const levels = new Map<string, ReturnType<typeof pathOf>>()
    for (const leaf of leaves) { const path = pathOf(leaf); levels.set(JSON.stringify(path), path) }
    // Where most of their own subcategories sit.
    const own = exact(job.section) ? (await all(ctx, T.placement, PLACEMENT_FIELDS, [['section', '=', exact(job.section)]])).filter(row => inForce(row, today)) : []
    const leafById = byId(leaves)
    const counts = new Map<string, number>()
    for (const row of own) {
      const path = pathOf(leafById.get(exact(row.subcategory)))
      const key = JSON.stringify([path.division, path.subdivision])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const start = top ? (([division, subdivision]) => ({ division, subdivision }))(JSON.parse(top[0]) as string[]) : null
    const order = (a: ReturnType<typeof pathOf>, b: ReturnType<typeof pathOf>) =>
      a.division.localeCompare(b.division) || a.subdivision.localeCompare(b.subdivision) || a.category.localeCompare(b.category)
    return { start, levels: [...levels.values()].sort(order) }
  },

  /** One category's subcategories, each saying who holds it at this store now. */
  async category_subcategories(ctx: ReadContext) {
    const payload = (ctx.payload ?? {}) as Record<string, unknown>
    if (!IS_SET_UP(ctx)) return []
    const today = istToday()
    const job = await myJobToRead(ctx, payload.job, today)
    const rows = await all(ctx, T.subcategory, SUB_FIELDS, [['subcategory_type', '=', 'Merchandise'],
      ['division', '=', asFilter(payload.division)], ['subdivision', '=', asFilter(payload.subdivision)], ['category', '=', asFilter(payload.category)]])
    if (!rows.length) return []
    const codes = rows.map(row => exact(row.row_id))
    const placed = (await all(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', exact(job.site)], ['subcategory', 'in', codes]])).filter(row => inForce(row, today))
    const where = new Map(placed.map(row => [exact(row.subcategory), exact(row.section)]))
    const sectionIds = unique(placed.map(row => exact(row.section)))
    const sections = sectionIds.length ? byId(await list(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', sectionIds]])) : new Map<string, Row>()
    const holders = await holdersOf(ctx, sectionIds, today)
    const names = await employeeNames(ctx, holders.map(h => exact(h.employee)))
    const asked = new Set((await ctx.changeProposals.list({ makers: [ctx.user], states: ['Pending'], limit: 500 }))
      .filter(p => about(p).kind === 'add').map(p => about(p).subcategory))
    return rows.map(row => {
      const code = exact(row.row_id)
      const section = where.get(code)
      const leaders = holders.filter(h => exact(h.section) === section).map(h => names.get(exact(h.employee))).filter(Boolean)
      const holder = !section ? { kind: 'none' as const }
        : section === exact(job.section) ? { kind: 'mine' as const }
        : { kind: 'other' as const, section: text(sections.get(section)?.name), team_leader: leaders.length ? leaders.join(' and ') : null }
      return { code, name: text(row.subcategory), holder, asked: asked.has(code) }
    }).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  },

  /** For the master data team: subcategories taken out of a section and in none at that store now. */
  async unplaced(ctx: ReadContext) {
    if (!IS_SET_UP(ctx)) return { state: 'not_set_up' as const }
    if (!ctx.roles?.includes(FALLBACK_ROLE)) return { state: 'not_allowed' as const }
    const today = istToday()
    const ended = (await all(ctx, T.placement, PLACEMENT_FIELDS, [['ends_on', '!=', null]])).filter(row => !notOver(row, today))
    if (!ended.length) return { state: 'ok' as const, rows: [] }
    const codes = unique(ended.map(row => exact(row.subcategory)))
    const placedNow = new Set((await all(ctx, T.placement, PLACEMENT_FIELDS, [['subcategory', 'in', codes]])).filter(row => notOver(row, today))
      .map(row => `${exact(row.store)}|${exact(row.subcategory)}`))
    const latest = new Map<string, Row>()
    for (const row of ended) {
      const key = `${exact(row.store)}|${exact(row.subcategory)}`
      if (placedNow.has(key)) continue
      if (!latest.has(key) || day(latest.get(key)!.ends_on) < day(row.ends_on)) latest.set(key, row)
    }
    const rows = [...latest.values()]
    const leaves = rows.length ? byId(await all(ctx, T.subcategory, SUB_FIELDS, [['row_id', 'in', unique(rows.map(r => exact(r.subcategory)))]])) : new Map<string, Row>()
    const stores = rows.length ? byId(await list(ctx, T.site, ['name'], [['row_id', 'in', unique(rows.map(r => exact(r.store)))]])) : new Map<string, Row>()
    const sections = rows.length ? byId(await list(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', unique(rows.map(r => exact(r.section)))]])) : new Map<string, Row>()
    return { state: 'ok' as const, rows: rows.filter(r => isMerchandise(leaves.get(exact(r.subcategory))))
      .map(r => ({ store: text(stores.get(exact(r.store))?.name), code: exact(r.subcategory), name: text(leaves.get(exact(r.subcategory))?.subcategory),
        ...pathOf(leaves.get(exact(r.subcategory))), was_in: text(sections.get(exact(r.section))?.name), since: dayAfter(day(r.ends_on)) }))
      .sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name)) }
  },

  /** Whether the sidebar offers the master data team's list. */
  holds_master_data(ctx: ReadContext) {
    return ctx.roles?.includes(FALLBACK_ROLE) === true
  },

  /** What waits for this person's decision. */
  async approvals(ctx: ReadContext) {
    if (!IS_SET_UP(ctx)) return { state: 'not_set_up' as const }
    const today = istToday()
    const waiting = await waitingForMe(ctx)
    const as = waiting.map(about)
    const codes = unique(as.map(a => exact(a.subcategory)))
    const leaves = codes.length ? byId(await all(ctx, T.subcategory, SUB_FIELDS, [['row_id', 'in', codes]])) : new Map<string, Row>()
    const sites = unique(as.map(a => a.site))
    const sections = sites.length ? (await all(ctx, T.section, SECTION_FIELDS, [['site', 'in', sites]])).filter(isActive) : []
    const holders = await holdersOf(ctx, unique(as.flatMap(a => [exact(a.from_section), a.to_section])), today)
    const names = await employeeNames(ctx, holders.map(h => exact(h.employee)))
    const holderOf = (section: string | undefined, except: string) => {
      const found = holders.filter(h => exact(h.section) === exact(section) && exact(h.row_id) !== except).map(h => names.get(exact(h.employee))).filter(Boolean)
      return found.length ? found.join(' and ') : null
    }
    return { state: 'ok' as const, proposals: waiting.map((proposal, index) => {
      const a = as[index]
      const isMove = a.kind === 'move' || (a.kind === 'add' && !!a.from_section)
      const asker = { section: a.to, holder: a.maker_name }
      const from = a.kind === 'removal' || a.kind === 'move' ? { section: a.from, holder: a.maker_name }
        : a.kind === 'add' ? (a.from_section ? { section: a.from, holder: holderOf(a.from_section, a.job_assignment) } : null)
        : { section: a.from, holder: null }
      const to = a.kind === 'removal' ? null : a.kind === 'add' ? asker
        : a.kind === 'move' ? { section: a.to, holder: holderOf(a.to_section, a.job_assignment) } : { section: a.to, holder: null }
      return { ...view(proposal), kind: isMove ? 'move' as const : a.kind, who: a.maker_name, from, to,
        path: a.subcategory ? pathOf(leaves.get(exact(a.subcategory))) : null,
        sections: isMove ? sections.filter(s => exact(s.site) === a.site).map(s => ({ id: exact(s.row_id), name: text(s.name) })).sort((x, y) => x.name.localeCompare(y.name)) : [] }
    }) }
  },
}

async function sectionInStore(ctx: BaseContext, id: unknown, site: string): Promise<Row> {
  const [section] = typeof id === 'string' && id ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', id]]) : []
  if (!section || exact(section.site) !== site) ctx.reject('Pick a section in this store')
  if (!isActive(section)) ctx.reject('That section is no longer open')
  return section
}

/** The frozen part of every proposal's description. */
async function aboutTheJob(ctx: ActionContext, job: Row, employee: Row): Promise<Pick<About, 'store' | 'site' | 'maker_name' | 'manager_name' | 'job_assignment'>> {
  const site = exact(job.site)
  const [store] = await list(ctx, T.site, ['name', 'is_store'], [['row_id', '=', site]])
  const { manager } = await approversOf(ctx, job)
  return { store: text(store?.name), site, maker_name: text(employee.name), manager_name: manager, job_assignment: exact(job.row_id) }
}
const payloadOf = (ctx: BaseContext) => (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
const heldSection = async (ctx: ActionContext, job: Row) => {
  const [section] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
  if (!section) ctx.reject('Your job has no section against it yet')
  return section
}

/** One addition: bring a subcategory into my section, from wherever it is in this store. */
async function proposeAdd(ctx: ActionContext, job: Row, employee: Row, section: Row, code: string, today: string) {
  const [subcategory] = await list(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [['row_id', '=', code]])
  if (!isMerchandise(subcategory)) ctx.reject('Pick a subcategory from the list')
  const site = exact(job.site)
  const name = text(subcategory.subcategory)
  if (await scheduledLater(ctx, site, code, today)) ctx.reject(`${SCHEDULED} (${name})`)
  const seen = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => inForce(row, today))
  // What is checked below is what the proposal records.
  for (const row of seen) await ctx.changeProposals.lockRow(T.placement, exact(row.row_id))
  const placed = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => inForce(row, today))
  if (placed.some(row => exact(row.section) === exact(section.row_id))) ctx.reject(`${name} is already in your section`)
  if (placed.length > 1) ctx.reject(`${name} is in more than one section here. Ask the master data team to look at it`)
  const elsewhere = placed[0]
  const [other] = elsewhere ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(elsewhere.section)]]) : []
  const base = await aboutTheJob(ctx, job, employee)
  const a = { ...base, kind: 'add' as const, what: name, from: elsewhere ? text(other?.name) : 'No section', to: text(section.name), subcategory: code, from_section: exact(elsewhere?.section), to_section: exact(section.row_id) }
  const proposal = await ctx.changeProposals.propose({ table: T.placement, row: elsewhere ? exact(elsewhere.row_id) : null,
    changes: elsewhere ? { section: exact(section.row_id) } : { store: site, subcategory: code, section: exact(section.row_id) },
    reviewed: elsewhere ? ['store', 'subcategory'] : [], approvers: await approversFor(ctx, a, job, today), about: a })
  return sentView(ctx, proposal)
}

export const actions = {
  /** "Not mine": take a subcategory out of my section, without saying where it goes (#1175). */
  async propose_removal(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const today = istToday()
    const { job, employee } = await myJob(ctx, payload.job, today)
    const from = await heldSection(ctx, job)
    if (!isActive(from)) ctx.reject('Your section is no longer open. Say which section is yours first')
    // Held from before it is checked until the proposal has recorded it, so what is checked is what is reviewed.
    if (typeof payload.placement === 'string' && payload.placement) await ctx.changeProposals.lockRow(T.placement, payload.placement)
    const [placement] = typeof payload.placement === 'string' && payload.placement ? await list(ctx, T.placement, PLACEMENT_FIELDS, [['row_id', '=', payload.placement]]) : []
    if (!placement || !inForce(placement, today) || exact(placement.section) !== exact(from.row_id) || exact(placement.store) !== exact(job.site))
      ctx.reject('That subcategory is not in your section')
    if (await scheduledLater(ctx, exact(job.site), exact(placement.subcategory), today)) ctx.reject(SCHEDULED)
    const [name] = await list(ctx, T.subcategory, ['subcategory'], [['row_id', '=', exact(placement.subcategory)]])
    const base = await aboutTheJob(ctx, job, employee)
    const proposal = await ctx.changeProposals.propose({ table: T.placement, row: exact(placement.row_id), changes: {}, ends: true, reviewed: ['store', 'subcategory', 'section'],
      approvers: (await approversOf(ctx, job)).approvers,
      about: { ...base, kind: 'removal', what: text(name?.subcategory), from: text(from.name), to: '', subcategory: exact(placement.subcategory), from_section: exact(from.row_id), to_section: '' } })
    return sentView(ctx, proposal)
  },

  /** "Add subcategories": one proposal for each, all sent or none. */
  async propose_adds(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const codes = payload.subcategories
    if (!Array.isArray(codes) || !codes.length || codes.length > 100 || !codes.every(code => typeof code === 'string' && code) || new Set(codes).size !== codes.length)
      ctx.reject('Pick the subcategories to add')
    const today = istToday()
    const { job, employee } = await myJob(ctx, payload.job, today)
    const section = await heldSection(ctx, job)
    if (!isActive(section)) ctx.reject('Your section is no longer open')
    // In code order, so two people asking at once lock the same rows in the same order.
    const sent = new Map<string, ReturnType<typeof view>>()
    for (const code of [...(codes as string[])].sort()) sent.set(code, await proposeAdd(ctx, job, employee, section, code, today))
    return (codes as string[]).map(code => sent.get(code)!)
  },

  /** "My section is wrong": this job's section should be another in the same store. */
  async propose_section(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    if (typeof payload.job === 'string' && payload.job) await ctx.changeProposals.lockRow(T.job, payload.job)
    const { job, employee } = await myJob(ctx, payload.job, istToday())
    const to = await sectionInStore(ctx, payload.to_section, exact(job.site))
    if (exact(to.row_id) === exact(job.section)) ctx.reject('That is already your section')
    const [from] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
    const base = await aboutTheJob(ctx, job, employee)
    // A job carrying a floor keeps it true to its section; most jobs carry none and stay so.
    const changes: Record<string, string | null> = { section: exact(to.row_id) }
    if (exact(job.floor)) changes.floor = exact(to.floor) || null
    const proposal = await ctx.changeProposals.propose({ table: T.job, row: exact(job.row_id), changes, reviewed: ['employee', 'site', 'job', ...(changes.floor === undefined ? ['floor'] : [])],
      approvers: (await approversOf(ctx, job)).approvers,
      about: { ...base, kind: 'section', what: `${text(job.job)} at ${base.store}`, from: from ? text(from.name) : 'No section', to: text(to.name), from_section: exact(job.section), to_section: exact(to.row_id) } })
    return sentView(ctx, proposal)
  },

  /** Undo: the maker takes back a pending proposal. The platform refuses anyone else, and a decided one. */
  async withdraw(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const [proposal] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
    if (!proposal) ctx.reject('That proposal no longer exists')
    return view(await ctx.changeProposals.withdraw(proposal.row_id))
  },

  /** The approver's decision. The platform refuses the maker and anyone but the approver. */
  async decide(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const [proposal] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
    if (!proposal) ctx.reject('That proposal no longer exists')
    const a = about(proposal)
    const today = istToday()
    // Authority holds still until this commits: the jobs, then their people, then the reads.
    const holders = a.kind === 'add' && a.from_section ? await holdersOf(ctx, [a.from_section], today) : []
    for (const id of unique([a.job_assignment, ...holders.map(h => exact(h.row_id))]).sort()) await ctx.changeProposals.lockRow(T.job, id)
    const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', a.job_assignment]])
    const jobs = [job, ...(await holdersOf(ctx, a.kind === 'add' && a.from_section ? [a.from_section] : [], today))].filter(Boolean)
    // The people in one order, so two decisions can't wait on each other's; then what the rules below read.
    for (const person of unique(jobs.flatMap(j => [exact(j.reports_to), exact(j.employee)])).sort()) await ctx.changeProposals.lockRow(T.employee, person)
    const instead = typeof payload.to_section === 'string' && payload.to_section && payload.to_section !== a.to_section ? payload.to_section : ''
    // In id order, as with the people: two moves between the same two sections can't cross.
    for (const section of unique([a.to_section, a.kind === 'move' || a.kind === 'removal' ? exact(a.from_section) : '', instead]).sort()) await ctx.changeProposals.lockRow(T.section, section)
    const approvers = await approversFor(ctx, a, job, today)
    if (payload.decision === 'reject')
      return view(await ctx.changeProposals.reject(proposal.row_id, { approvers, reason: typeof payload.reason === 'string' ? payload.reason : '' }))
    if (payload.decision !== 'approve') ctx.reject('Approve or reject')
    // "Move it elsewhere": the approver's own section, in the same store, open, and not where it is now.
    let elsewhere: Row | null = null
    if (instead) {
      if (a.kind !== 'add' && a.kind !== 'move') ctx.reject('Only a subcategory going to a section can be put elsewhere')
      elsewhere = await sectionInStore(ctx, instead, a.site)
      const now = a.kind === 'move' ? a.from_section : a.from_section
      if (exact(elsewhere.row_id) === exact(now)) ctx.reject('It is already in that section')
    }
    // A subcategory in no section yet has no row to queue at, so two adds queue on what they share.
    if (a.kind === 'add' && !a.from_section) await ctx.changeProposals.serialize(`${a.site}:${a.subcategory}`)
    if (a.kind === 'add') await ctx.changeProposals.lockRow(T.subcategory, exact(a.subcategory))
    const stale = await whyStale(ctx, proposal, a, job, today, elsewhere ? exact(elsewhere.row_id) : a.to_section)
    if (stale) return view(await ctx.changeProposals.needsFreshReview(proposal.row_id, { approvers, reason: stale }))
    if (a.kind === 'removal') return view(await ctx.changeProposals.approve(proposal.row_id, { approvers, effectiveOn: today }))
    const newRow: Record<string, string> = a.kind === 'section'
      ? { assignment_id: await freeId(ctx, T.job, `JA-${exact(job.employee)}-${a.site}-${a.to_section.split('-').at(-1)}-${today}`), source_key: `Dash, approved ${today}` }
      : { section_subcategory_id: await freeId(ctx, T.placement, `${a.site}-${a.subcategory}-${today}`), source_key: `Dash, approved ${today}` }
    const decided = await ctx.changeProposals.approve(proposal.row_id, { approvers, effectiveOn: today, newRow,
      ...(elsewhere ? { instead: { section: exact(elsewhere.row_id) }, reason: `Put in ${text(elsewhere.name)} instead.` } : {}) })
    // StyleHR: once the vendor's API is ready, an approved `section` proposal is posted to it here. Not built (#975).
    return view(decided)
  },
}

/** A row id free on this Table: an end-and-add can land on the same day twice. */
async function freeId(ctx: ActionContext, table: string, base: string): Promise<string> {
  const taken = new Set((await list(ctx, table, [], [['row_id', 'like', `${base}%`]])).map(row => exact(row.row_id)))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** What the row comparison can't see: the person still holds the job, and the section still stands. */
async function whyStale(ctx: ActionContext, proposal: ChangeProposal, a: About, job: Row | undefined, today: string, destination: string): Promise<string | null> {
  if (!job || !inForce(job, today)) return 'The job behind this has ended.'
  const [employee] = await list(ctx, T.employee, ['person', EMPLOYEE_STATUS], [['row_id', '=', exact(job.employee)]])
  if (exact(employee?.person) !== proposal.maker || exact(employee?.[EMPLOYEE_STATUS]) !== 'Current') return 'The person who asked no longer holds this job.'
  if (a.kind !== 'removal') {
    const [to] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', destination]])
    if (!isActive(to) || exact(to?.site) !== a.site) return 'The section it would go to is no longer open.'
    // A job carrying a floor must match the section's, changed or not; a job with none has nothing to match.
    const floor = proposal.changes.find(change => change.column_name === 'floor' && (change.proposed_value !== null || change.review_base_value !== null))
    if (a.kind === 'section' && floor && floor.proposed_value !== (exact(to.floor) || null)) return 'The section it would go to has moved floor.'
  }
  if ((a.kind === 'move' || a.kind === 'removal') && exact(job.section) !== a.from_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'move') {
    const [from] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(a.from_section)]])
    if (!isActive(from)) return 'The section it would leave is no longer open.'
  }
  if (a.kind === 'add' && exact(job.section) !== a.to_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'add') {
    const [subcategory] = await list(ctx, T.subcategory, ['subcategory_type'], [['row_id', '=', exact(a.subcategory)]])
    if (!isMerchandise(subcategory)) return 'That subcategory is no longer sold.'
  }
  if (a.kind !== 'section') {
    const rows = await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', a.site], ['subcategory', '=', exact(a.subcategory)]])
    if (rows.some(row => notOver(row, today) && day(row.starts_on) > today)) return 'A change to that subcategory is already planned.'
    if (a.kind === 'add' && !a.from_section && rows.some(row => notOver(row, today))) return 'That subcategory has since been put in a section.'
  }
  return null
}
