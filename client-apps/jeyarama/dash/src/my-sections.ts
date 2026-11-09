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
  row_id: string; maker: string; state: string; about: unknown; decision_reason: string | null
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
  propose(request: { table: string; row: string | null; changes: Record<string, string | null>; reviewed?: string[]; approvers: ApproverRequest; about: Record<string, unknown> }): Promise<ChangeProposal>
  approve(id: string, decision: { approvers: ApproverRequest; effectiveOn: string; newRow: Record<string, string | null> }): Promise<ChangeProposal>
  reject(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
  needsFreshReview(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
}

const T = { employee: 'Employee', job: 'Job Assignment', section: 'Section', floor: 'Store Floor', placement: 'Section Subcategory', subcategory: 'Subcategory', site: 'Site' } as const
/** Every base Table an administrator must list in the `linked_tables` setting. */
export const BASE_TABLES: readonly string[] = Object.values(T)

/** Who approves when a person has no manager who can sign in. */
export const FALLBACK_ROLE = 'Master Data Editor'
const MASTER_DATA_TEAM = 'the master data team'

export type ProposalKind = 'move' | 'add' | 'section'
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
  to_section: string
}

interface BaseContext {
  user: string
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

/** Who a job's proposal goes to now: authority moves with the job, so this is read fresh. */
async function waitingOnNow(ctx: ReadContext, job: Row | undefined, maker: string): Promise<string> {
  const { approvers, manager } = await approversOf(ctx, job)
  const route = await ctx.changeProposals.routeFor(maker, approvers)
  return (route?.people.length ? manager : null) ?? MASTER_DATA_TEAM
}

/** The day in India of a timestamp, or '' for none. */
const istDay = (at: string | null) => (at ? istToday(Date.parse(at)) : '')

/** A proposal as a person reads it: names only. */
function view(proposal: ChangeProposal) {
  const a = about(proposal)
  return { id: proposal.row_id, kind: a.kind, what: a.what, from: a.from, to: a.to, store: a.store, state: proposal.state,
    waiting_for: (proposal.route.people.length ? a.manager_name : null) ?? MASTER_DATA_TEAM,
    reason: proposal.decision_reason, asked_on: istDay(proposal.created_at), decided_on: istDay(proposal.decided_at) }
}

/** The pending proposals this caller may decide now. */
async function waitingForMe(ctx: ReadContext): Promise<ChangeProposal[]> {
  const mine: ChangeProposal[] = []
  for (let start = 0; ; start += 500) {
    const pending = await ctx.changeProposals.list({ states: ['Pending'], limit: 500, start })
    const others = pending.filter(proposal => proposal.maker !== ctx.user)
    const jobs = others.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', unique(others.map(p => about(p).job_assignment))]])) : new Map<string, Row>()
    for (const proposal of others) {
      const { approvers } = await approversOf(ctx, jobs.get(about(proposal).job_assignment))
      if (await ctx.changeProposals.mayDecide(proposal.maker, approvers)) mine.push(proposal)
    }
    if (pending.length < 500) return mine
  }
}

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
    const names = placements.length ? byId(await all(ctx, T.subcategory, ['subcategory'], [['row_id', 'in', unique(placements.map(p => exact(p.subcategory)))]])) : new Map<string, Row>()
    const floorName = (section: Row | undefined) => text(floors.get(exact(section?.floor))?.name) || null
    const mine = await ctx.changeProposals.list({ makers: [ctx.user], limit: VIEW_LIMIT })
    const pendingJobs = unique(mine.filter(p => p.state === 'Pending').map(p => about(p).job_assignment))
    const pendingJobRows = pendingJobs.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', pendingJobs]])) : new Map<string, Row>()
    const waitingOnJob = new Map<string, string>()
    for (const id of pendingJobs) waitingOnJob.set(id, await waitingOnNow(ctx, pendingJobRows.get(id), ctx.user))
    const shown = mine.map(p => ({ ...view(p), ...(p.state === 'Pending' ? { waiting_for: waitingOnJob.get(about(p).job_assignment)! } : {}) }))
    const waitingOn = new Map(mine.flatMap((p, index) => p.state === 'Pending' && about(p).kind === 'move' ? [[about(p).subcategory, shown[index].waiting_for] as const] : []))
    const views = []
    for (const job of jobs) {
      const site = exact(job.site)
      const section = sectionsById.get(exact(job.section))
      const { reportsTo } = await approversOf(ctx, job)
      views.push({
        id: exact(job.row_id), job: text(job.job), store: text(siteRows.get(site)?.name), is_store: siteRows.get(site)?.is_store === true,
        reports_to: reportsTo,
        waiting_for: await waitingOnNow(ctx, job, ctx.user),
        section: section ? { id: exact(section.row_id), name: text(section.name), floor: floorName(section) } : null,
        subcategories: section ? placements.filter(p => exact(p.section) === exact(section.row_id))
          .map(p => ({ id: exact(p.row_id), name: text(names.get(exact(p.subcategory))?.subcategory) || 'Unnamed subcategory', waiting_for: waitingOn.get(exact(p.subcategory)) ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)) : [],
        other_sections: sections.filter(s => exact(s.site) === site && isActive(s) && exact(s.row_id) !== exact(job.section))
          .map(s => ({ id: exact(s.row_id), name: text(s.name), floor: floorName(s) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    return { state: 'ok' as const, name: text(employees[0].name), jobs: views, proposals: shown, waiting_for_me: (await waitingForMe(ctx)).length }
  },

  /** The store's subcategories matching what was typed, each with where it is now. */
  async subcategory_search(ctx: ReadContext) {
    const { job: jobId, query } = (ctx.payload ?? {}) as { job?: unknown; query?: unknown }
    const typed = typeof query === 'string' ? query.trim() : ''
    if (!IS_SET_UP(ctx) || typed.length < 2) return []
    const today = istToday()
    const job = (await myJobs(ctx, await myEmployees(ctx), today)).find(row => exact(row.row_id) === jobId)
    if (!job) ctx.reject('That is not a job of yours')
    const asked = new Set((await ctx.changeProposals.list({ makers: [ctx.user], states: ['Pending'], limit: 500 })).map(p => about(p).subcategory))
    // Page by page until enough are left: what is already in this section isn't an answer, so a limit first could hide every real one.
    const shown: { code: string; name: string; now_in: string | null; asked: boolean }[] = []
    for (let start = 0; shown.length < 20; start += 100) {
      const page = await ctx.baseTables.list(T.subcategory, { fields: ['row_id', 'subcategory'],
        filters: [['subcategory', 'like', `%${typed}%`], ['subcategory_type', '=', 'Merchandise']], order_by: 'row_id asc', limit_start: start, limit_page_length: 100 })
      if (page.length) {
        const codes = page.map(row => exact(row.row_id))
        const placed = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', exact(job!.site)], ['subcategory', 'in', codes]])).filter(row => inForce(row, today))
        const where = new Map(placed.map(row => [exact(row.subcategory), exact(row.section)]))
        const sections = placed.length ? byId(await list(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', unique(placed.map(row => exact(row.section)))]])) : new Map<string, Row>()
        for (const row of page) {
          const code = exact(row.row_id)
          if (where.get(code) === exact(job!.section)) continue
          const section = where.get(code)
          shown.push({ code, name: text(row.subcategory), now_in: section ? text(sections.get(section)?.name) : null, asked: asked.has(code) })
        }
      }
      if (page.length < 100) break
    }
    return shown
      // The store's own first: an unplaced subcategory is the rarer correction.
      .sort((a, b) => Number(!a.now_in) - Number(!b.now_in) || a.name.localeCompare(b.name))
      .slice(0, 20)
  },

  /** What waits for this person's decision. */
  async approvals(ctx: ReadContext) {
    if (!IS_SET_UP(ctx)) return { state: 'not_set_up' as const }
    const waiting = await waitingForMe(ctx)
    return { state: 'ok' as const, proposals: waiting.map(proposal => ({ ...view(proposal), who: about(proposal).maker_name })) }
  },
}

async function sectionInStore(ctx: BaseContext, id: unknown, site: string): Promise<Row> {
  const [section] = typeof id === 'string' && id ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', id]]) : []
  if (!section || exact(section.site) !== site) ctx.reject('Pick a section in this store')
  if (!isActive(section)) ctx.reject('That section is no longer open')
  return section
}

/** The frozen part of every proposal's description. */
async function aboutTheJob(ctx: ActionContext, job: Row, employee: Row): Promise<Pick<About, 'store' | 'site' | 'maker_name' | 'manager_name' | 'job_assignment'> & { approvers: ApproverRequest }> {
  const site = exact(job.site)
  const [store] = await list(ctx, T.site, ['name', 'is_store'], [['row_id', '=', site]])
  const { approvers, manager } = await approversOf(ctx, job)
  return { store: text(store?.name), site, maker_name: text(employee.name), manager_name: manager, job_assignment: exact(job.row_id), approvers }
}
const payloadOf = (ctx: BaseContext) => (ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {}) as Record<string, unknown>
const heldSection = async (ctx: ActionContext, job: Row) => {
  const [section] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
  if (!section) ctx.reject('Your job has no section against it yet')
  return section
}

export const actions = {
  /** "Not in my section": the subcategory belongs in another section of this store. */
  async propose_move(ctx: ActionContext) {
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
    const to = await sectionInStore(ctx, payload.to_section, exact(job.site))
    if (exact(to.row_id) === exact(from.row_id)) ctx.reject('That is already its section')
    if (await scheduledLater(ctx, exact(job.site), exact(placement.subcategory), today)) ctx.reject(SCHEDULED)
    const [name] = await list(ctx, T.subcategory, ['subcategory'], [['row_id', '=', exact(placement.subcategory)]])
    const { approvers, ...base } = await aboutTheJob(ctx, job, employee)
    const proposal = await ctx.changeProposals.propose({ table: T.placement, row: exact(placement.row_id), changes: { section: exact(to.row_id) }, reviewed: ['store', 'subcategory'], approvers,
      about: { ...base, kind: 'move', what: text(name?.subcategory), from: text(from.name), to: text(to.name), subcategory: exact(placement.subcategory), from_section: exact(from.row_id), to_section: exact(to.row_id) } })
    return view(proposal)
  },

  /** "A subcategory is missing": bring it into my section, from wherever it is in this store. */
  async propose_add(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const today = istToday()
    const { job, employee } = await myJob(ctx, payload.job, today)
    const section = await heldSection(ctx, job)
    if (!isActive(section)) ctx.reject('Your section is no longer open')
    const code = typeof payload.subcategory === 'string' ? payload.subcategory : ''
    const [subcategory] = code ? await list(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [['row_id', '=', code]]) : []
    if (!subcategory || subcategory.subcategory_type !== 'Merchandise') ctx.reject('Pick a subcategory from the list')
    const site = exact(job.site)
    if (await scheduledLater(ctx, site, code, today)) ctx.reject(SCHEDULED)
    const seen = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => inForce(row, today))
    // As with a move: what is checked below is what the proposal records.
    for (const row of seen) await ctx.changeProposals.lockRow(T.placement, exact(row.row_id))
    const placed = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => inForce(row, today))
    if (placed.some(row => exact(row.section) === exact(section.row_id))) ctx.reject('That subcategory is already in your section')
    if (placed.length > 1) ctx.reject('That subcategory is in more than one section here. Ask the master data team to look at it')
    const elsewhere = placed[0]
    const [other] = elsewhere ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(elsewhere.section)]]) : []
    const { approvers, ...base } = await aboutTheJob(ctx, job, employee)
    const proposal = await ctx.changeProposals.propose({ table: T.placement, row: elsewhere ? exact(elsewhere.row_id) : null,
      changes: elsewhere ? { section: exact(section.row_id) } : { store: site, subcategory: code, section: exact(section.row_id) },
      reviewed: elsewhere ? ['store', 'subcategory'] : [], approvers,
      about: { ...base, kind: 'add', what: text(subcategory.subcategory), from: elsewhere ? text(other?.name) : 'No section', to: text(section.name), subcategory: code, from_section: exact(elsewhere?.section), to_section: exact(section.row_id) } })
    return view(proposal)
  },

  /** "My section is wrong": this job's section should be another in the same store. */
  async propose_section(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    if (typeof payload.job === 'string' && payload.job) await ctx.changeProposals.lockRow(T.job, payload.job)
    const { job, employee } = await myJob(ctx, payload.job, istToday())
    const to = await sectionInStore(ctx, payload.to_section, exact(job.site))
    if (exact(to.row_id) === exact(job.section)) ctx.reject('That is already your section')
    const [from] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
    const { approvers, ...base } = await aboutTheJob(ctx, job, employee)
    // A job carrying a floor keeps it true to its section; most jobs carry none and stay so.
    const changes: Record<string, string | null> = { section: exact(to.row_id) }
    if (exact(job.floor)) changes.floor = exact(to.floor) || null
    const proposal = await ctx.changeProposals.propose({ table: T.job, row: exact(job.row_id), changes, reviewed: ['employee', 'site', 'job', ...(changes.floor === undefined ? ['floor'] : [])], approvers,
      about: { ...base, kind: 'section', what: `${text(job.job)} at ${base.store}`, from: from ? text(from.name) : 'No section', to: text(to.name), from_section: exact(job.section), to_section: exact(to.row_id) } })
    return view(proposal)
  },

  /** The approver's decision. The platform refuses the maker and anyone but the approver. */
  async decide(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const [proposal] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
    if (!proposal) ctx.reject('That proposal no longer exists')
    const a = about(proposal)
    // Authority holds still until this commits: the job, then its people, then the reads.
    await ctx.changeProposals.lockRow(T.job, a.job_assignment)
    const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', a.job_assignment]])
    // The people in one order, so two decisions can't wait on each other's; then what the rules below read.
    for (const person of unique([exact(job?.reports_to), exact(job?.employee)]).sort()) await ctx.changeProposals.lockRow(T.employee, person)
    // In id order, as with the people: two moves between the same two sections can't cross.
    for (const section of unique([a.to_section, a.kind === 'move' ? exact(a.from_section) : '']).sort()) await ctx.changeProposals.lockRow(T.section, section)
    const { approvers } = await approversOf(ctx, job)
    if (payload.decision === 'reject')
      return view(await ctx.changeProposals.reject(proposal.row_id, { approvers, reason: typeof payload.reason === 'string' ? payload.reason : '' }))
    if (payload.decision !== 'approve') ctx.reject('Approve or reject')
    const today = istToday()
    // A subcategory in no section yet has no row to queue at, so two adds queue on what they share.
    if (a.kind === 'add' && !a.from_section) await ctx.changeProposals.serialize(`${a.site}:${a.subcategory}`)
    if (a.kind === 'add') await ctx.changeProposals.lockRow(T.subcategory, exact(a.subcategory))
    const stale = await whyStale(ctx, proposal, a, job, today)
    if (stale) return view(await ctx.changeProposals.needsFreshReview(proposal.row_id, { approvers, reason: stale }))
    const newRow: Record<string, string> = a.kind === 'section'
      ? { assignment_id: await freeId(ctx, T.job, `JA-${exact(job.employee)}-${a.site}-${a.to_section.split('-').at(-1)}-${today}`), source_key: `Dash, approved ${today}` }
      : { section_subcategory_id: await freeId(ctx, T.placement, `${a.site}-${a.subcategory}-${today}`), source_key: `Dash, approved ${today}` }
    const decided = await ctx.changeProposals.approve(proposal.row_id, { approvers, effectiveOn: today, newRow })
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
async function whyStale(ctx: ActionContext, proposal: ChangeProposal, a: About, job: Row | undefined, today: string): Promise<string | null> {
  if (!job || !inForce(job, today)) return 'The job behind this has ended.'
  const [employee] = await list(ctx, T.employee, ['person', EMPLOYEE_STATUS], [['row_id', '=', exact(job.employee)]])
  if (exact(employee?.person) !== proposal.maker || exact(employee?.[EMPLOYEE_STATUS]) !== 'Current') return 'The person who asked no longer holds this job.'
  const [to] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', a.to_section]])
  if (!isActive(to) || exact(to?.site) !== a.site) return 'The section it would go to is no longer open.'
  // A job carrying a floor must match the section's, changed or not; a job with none has nothing to match.
  const floor = proposal.changes.find(change => change.column_name === 'floor' && (change.proposed_value !== null || change.review_base_value !== null))
  if (a.kind === 'section' && floor && floor.proposed_value !== (exact(to.floor) || null)) return 'The section it would go to has moved floor.'
  if (a.kind === 'move' && exact(job.section) !== a.from_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'move') {
    const [from] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(a.from_section)]])
    if (!isActive(from)) return 'The section it would leave is no longer open.'
  }
  if (a.kind === 'add' && exact(job.section) !== a.to_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'add') {
    const [subcategory] = await list(ctx, T.subcategory, ['subcategory_type'], [['row_id', '=', exact(a.subcategory)]])
    if (subcategory?.subcategory_type !== 'Merchandise') return 'That subcategory is no longer sold.'
  }
  if (a.kind !== 'section') {
    const rows = await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', a.site], ['subcategory', '=', exact(a.subcategory)]])
    if (rows.some(row => notOver(row, today) && day(row.starts_on) > today)) return 'A change to that subcategory is already planned.'
    if (a.kind === 'add' && !a.from_section && rows.some(row => notOver(row, today))) return 'That subcategory has since been put in a section.'
  }
  return null
}
