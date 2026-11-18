// Your sections, and the approvals behind them (#975). A person sees what is mapped to them and
// proposes a correction; their manager decides. Everything is read from and written to the base
// Tables: Dash keeps no copy. These reads run as the app, so each answer here is limited to what
// this person may see, by this code.
import { istToday } from './report.ts'
import { DEPARTMENT, DEPARTMENT_SECTION, authorityRows, mayEditOwnSection, mayMove, sectionAreaOf } from './areas.ts'
import { EMPLOYEE_STATUS, SECTION_STATUS, day, exact, holdsOn, text } from './values.ts'
import { whoIs, type Who } from './report-access-server.ts'

export type Row = Record<string, unknown>
// The platform's helpers, structurally: this module imports nothing from the platform.
type Filter = [string, string, unknown]
export interface ApproverRequest { people: string[]; fallbackRoles: string[] }
export interface ChangeProposal {
  row_id: string; maker: string; state: string; about: unknown; decision_reason: string | null; ends_row?: boolean; decided_by?: string | null
  target_row?: string | null; result_row?: string | null
  changes: { column_name: string; proposed_value: string | null; review_base_value: string | null }[]
  created_at: string; decided_at: string | null; route: { people: string[]; roles: string[] }
}
interface ProposalList { ids?: string[]; states?: string[]; makers?: string[]; limit?: number; start?: number }
interface BaseTablesHelper {
  list(table: string, args: { fields: string[]; filters?: Filter[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
  /** Whether the instance has the Table with every column the app declares reading (#1246: Buyer Section may not exist yet). */
  available?(table: string): Promise<boolean>
  /** #1219: who last changed a column it reads, from the row's own history. */
  changedBy?(table: string, args: { rows: string[]; column: string }): Promise<Record<string, { by: string; at: string }>>
}
interface ChangeProposalsReader {
  list(filter?: ProposalList): Promise<ChangeProposal[]>
  mayDecide(maker: string, approvers: ApproverRequest): Promise<boolean>
  mayDecideMany(asks: { maker: string; approvers: ApproverRequest }[]): Promise<boolean[]>
  routeFor(maker: string, approvers: ApproverRequest): Promise<{ people: string[]; roles: string[] } | null>
  modeOf(type: string): Promise<string>
}
interface ChangeProposalsHelper extends ChangeProposalsReader {
  lockRow(table: string, rowId: string): Promise<void>
  serialize(key: string): Promise<void>
  propose(request: { table: string; row: string | null; changes: Record<string, string | null>; reviewed?: string[]; ends?: boolean; approvers: ApproverRequest; about: Record<string, unknown>
    type: string; apply: { effectiveOn: string; newRow?: Record<string, string | null> } }): Promise<ChangeProposal>
  approve(id: string, decision: { approvers: ApproverRequest; effectiveOn: string; newRow?: Record<string, string | null>; instead?: Record<string, string | null>; reason?: string }): Promise<ChangeProposal>
  withdraw(id: string): Promise<ChangeProposal>
  reject(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
  needsFreshReview(id: string, decision: { approvers: ApproverRequest; reason: string }): Promise<ChangeProposal>
  confirm(id: string, decision: { approvers: ApproverRequest; note?: string }): Promise<ChangeProposal>
  undo(id: string, decision: { approvers: ApproverRequest; reason?: string }): Promise<ChangeProposal>
}

export const T = { employee: 'Employee', job: 'Job Assignment', section: 'Section', floor: 'Store Floor', placement: 'Section Subcategory', subcategory: 'Subcategory', site: 'Site' } as const
/** Every base Table an administrator must list in the `linked_tables` setting. */
export const BASE_TABLES: readonly string[] = Object.values(T)

/** #1191: Dash's kinds of approval, as the manifest declares them. Each one's mode is the instance's Approval Type row. */
export const APPROVAL_TYPE = { add: 'subcategory_add', removal: 'subcategory_removal', section: 'job_section' } as const
export const APPLY_NOW = 'Apply now, review after'
/** Applied when asked for, waiting for a reviewer: shown with the waiting ones. */
export const OPEN = ['Pending', 'Not yet reviewed']
const isApplied = (proposal: ChangeProposal) => proposal.state === 'Not yet reviewed'

/** Who approves when a person has no manager who can sign in. */
export const FALLBACK_ROLE = 'Master Data Editor'
export const MASTER_DATA_TEAM = 'the master data team'

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
  /** #1223: a Store or Floor Manager moved someone on their staff; the maker is the manager, not the job's holder. */
  by_manager?: boolean
  /** #1223: who a manager moved, by name. */
  moved_name?: string
}

interface BaseContext {
  user: string
  roles?: readonly string[]
  /** The platform's names for people and service accounts, read as the caller (people-directory's namesForApp). */
  people?: { names?(ids: string[]): Promise<Record<string, string | null>> }
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

export const list = (ctx: BaseContext, table: string, fields: string[], filters: Filter[], limit = 500) =>
  ctx.baseTables.list(table, { fields: ['row_id', ...fields], filters, limit_page_length: limit })

/** Every matching row, however many pages: a large store has over a thousand placements. */
export async function all(ctx: BaseContext, table: string, fields: string[], filters: Filter[]): Promise<Row[]> {
  const rows: Row[] = []
  for (let start = 0; ; start += 500) {
    const page = await ctx.baseTables.list(table, { fields: ['row_id', ...fields], filters, limit_start: start, limit_page_length: 500, order_by: 'row_id asc' })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

export const inForce = (row: Row, today: string) => {
  const starts = day(row.starts_on)
  const ends = day(row.ends_on)
  return (!starts || starts <= today) && (!ends || ends >= today)
}
/** Not over yet: in force today, or set to start later. */
const notOver = (row: Row, today: string) => !day(row.ends_on) || day(row.ends_on) >= today
export const JOB_FIELDS = ['employee', 'job', 'site', 'floor', 'section', 'reports_to', 'starts_on', 'ends_on']
export const PLACEMENT_FIELDS = ['section_subcategory_id', 'store', 'subcategory', 'section', 'starts_on', 'ends_on']
export const SECTION_FIELDS = ['name', 'site', 'floor', SECTION_STATUS]
export const isActive = (section: Row | undefined) => exact(section?.[SECTION_STATUS]) === 'Active'
export const byId = (rows: Row[]) => new Map(rows.map(row => [exact(row.row_id), row]))
export const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

/** The caller's current staff rows. A leaver or a test record is nobody on this screen. */
export const myEmployees = (ctx: BaseContext) => list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', '=', ctx.user], [EMPLOYEE_STATUS, '=', 'Current']])

export async function myJobs(ctx: BaseContext, employees: Row[], today: string): Promise<Row[]> {
  if (!employees.length) return []
  return (await list(ctx, T.job, JOB_FIELDS, [['employee', 'in', employees.map(e => exact(e.row_id))]])).filter(job => inForce(job, today))
}

/** #1277: under business roles, Your sections' changes need a role that may edit sections. */
const NO_EDIT = 'Your business role does not let you change which subcategories sit in your section'

/** The caller's job by id, current and theirs, or a refusal. */
async function myJob(ctx: ActionContext, id: unknown, today: string) {
  const employees = await myEmployees(ctx)
  const job = (await myJobs(ctx, employees, today)).find(row => exact(row.row_id) === id)
  if (!job) ctx.reject('That is not a job of yours')
  return { job: job!, employee: employees.find(e => exact(e.row_id) === exact(job!.employee))! }
}

/** #1219: a Master Data Editor may decide any open review, as the person's manager may. Asked as the
 *  role, never by name: the platform reads the decider's roles when it decides, with their own row
 *  held still, so a role taken away meanwhile is honoured. Nobody decides their own (the platform). */
export function asDecider(ctx: BaseContext, approvers: ApproverRequest): ApproverRequest {
  if (!ctx.roles?.includes(FALLBACK_ROLE) || approvers.people.includes(ctx.user)) return approvers
  return { people: [], fallbackRoles: [FALLBACK_ROLE] }
}

/** A reviewer by name, with who they are (#1216): many staff share a name. */
export type Reviewer = { name: string; id?: string | null } & Who
/** The people a review goes to, as current staff, each with their code, jobs and site; none for the master data team. */
export async function reviewersOf(ctx: BaseContext, people: string[]): Promise<Reviewer[]> {
  return pick(await reviewersByPerson(ctx, people), people)
}
/** The same for many lists at once, read once (#1254: Waiting for you must not read per change). */
export async function reviewersByPerson(ctx: BaseContext, people: string[]): Promise<Map<string, Reviewer>> {
  const wanted = unique(people)
  if (!wanted.length) return new Map()
  const staff = (await all(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', 'in', wanted]])).filter(e => exact(e[EMPLOYEE_STATUS]) === 'Current')
  const who = await whoIs(ctx.baseTables, wanted, istToday())
  const found = new Map<string, Reviewer>()
  for (const person of wanted) {
    const row = staff.find(e => exact(e.person) === person)
    // Their Employee record too, so the page links the name (every record shown is a link).
    if (text(row?.name)) found.set(person, { name: text(row!.name), id: exact(row!.row_id), ...who.get(person)! })
  }
  return found
}
/** Some of them, current staff only, by name. */
export const pick = (found: Map<string, Reviewer>, people: string[]): Reviewer[] =>
  unique(people).map(person => found.get(person)).filter((r): r is Reviewer => !!r).sort((a, b) => a.name.localeCompare(b.name))

/** #1219: anyone who changed a row, by name with who they are: staff (who have left too) by the staff list;
 *  anyone else by the platform's own name for them, a service account by its label; an id it can't name, never shown. */
async function peopleNamed(ctx: BaseContext, people: string[]): Promise<Map<string, Reviewer>> {
  const wanted = unique(people)
  if (!wanted.length) return new Map()
  const staff = await list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['person', 'in', wanted]])
  const who = await whoIs(ctx.baseTables, wanted, istToday())
  const platform = (await ctx.people?.names?.(wanted).catch(() => null)) ?? {}
  const recordOf = (person: string) => {
    const rows = staff.filter(e => exact(e.person) === person)
    return rows.find(e => exact(e[EMPLOYEE_STATUS]) === 'Current') ?? rows[0]
  }
  const nameOf = (person: string) => {
    return text(recordOf(person)?.name) || text(platform[person])
      // The built-in Administrator's id is its name; other ids the platform can't name are its own steps (settings, the command line).
      || (person === 'Administrator' ? 'Administrator' : person.startsWith('psn_') ? 'Someone not on the staff list' : 'an automatic step')
  }
  return new Map(wanted.map(person => [person, { name: nameOf(person), id: exact(recordOf(person)?.row_id) || null, ...who.get(person)! }]))
}

/** The approver of a job: its manager, while they are on the staff and have a sign-in; else the role. */
export async function approversOf(ctx: BaseContext, job: Row | undefined): Promise<{ approvers: ApproverRequest; manager: string | null; reportsTo: string | null }> {
  const managerId = exact(job?.reports_to)
  const [manager] = managerId ? await list(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['row_id', '=', managerId]]) : []
  return approversFrom(manager)
}
function approversFrom(manager: Row | undefined) {
  const person = exact(manager?.[EMPLOYEE_STATUS]) === 'Current' ? exact(manager?.person) : ''
  return { approvers: { people: person ? [person] : [], fallbackRoles: [FALLBACK_ROLE] } as ApproverRequest, manager: person ? text(manager!.name) : null, reportsTo: text(manager?.name) || null }
}

/** Who decides each of many proposals, from a fixed few reads (#1254): every job's manager, and every
 *  from-section's Team Leaders and theirs, are read once. Reading them per proposal cost about 14 queries
 *  each: 5 s on production. The platform is then asked about all of them at once (mayDecideMany). */
export async function approverLookup(ctx: ReadContext, jobs: (Row | undefined)[], fromSections: string[], today: string) {
  // The same holders a decision reads under its locks.
  const holders = await holdersOf(ctx, unique(fromSections.filter(Boolean)), today)
  const ids = unique([...jobs, ...holders].map(job => exact(job?.reports_to)).filter(Boolean))
  const managers = ids.length ? byId(await all(ctx, T.employee, ['name', EMPLOYEE_STATUS, 'person'], [['row_id', 'in', ids]])) : new Map<string, Row>()
  const of = (job: Row | undefined) => approversFrom(managers.get(exact(job?.reports_to))).approvers
  return {
    approversOf: of,
    /** As approversFor, from what was read. */
    approversFor(a: Pick<About, 'kind' | 'from_section'>, job: Row | undefined): ApproverRequest {
      const approvers = of(job)
      if (a.kind !== 'add' || !a.from_section) return approvers
      const people = [...approvers.people]
      for (const holder of holders.filter(h => exact(h.section) === exact(a.from_section))) people.push(...of(holder).people)
      return { people: unique(people), fallbackRoles: approvers.fallbackRoles }
    },
  }
}

/** A later placement of this subcategory here: an open-ended new row would overlap it. */
export async function scheduledLater(ctx: BaseContext, site: string, subcategory: string, today: string): Promise<boolean> {
  const rows = await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', subcategory]])
  return rows.some(row => notOver(row, today) && day(row.starts_on) > today)
}
export const SCHEDULED = 'A change to that subcategory is already planned here. Ask the master data team to look at it'

export const about = (proposal: ChangeProposal) => (proposal.about ?? {}) as unknown as About
/** A Department Manager's set-up (#1195): department-setup.ts shows and decides those. */
// Proposals of other flows, decided on their own screens: department set-ups (#1195) and Buyer Section moves (#1246).
const isSetUp = (proposal: ChangeProposal) => ['department', 'department_section', 'buyer_section'].includes(String((proposal.about as Record<string, unknown> | null)?.kind))
const VIEW_LIMIT = 50
const SUB_FIELDS = ['subcategory', 'division', 'subdivision', 'category', 'subcategory_type']
/** A subcategory's place in the merchandise hierarchy, as its row holds it. */
const pathOf = (row: Row | undefined) => ({ division: text(row?.division), subdivision: text(row?.subdivision), category: text(row?.category) })
export const isMerchandise = (row: Row | undefined) => row?.subcategory_type === 'Merchandise'

/** The Team Leaders holding these sections now. */
/** Who holds a section, in a few words: one or two names, else the first and how many others. */
export function fewNames(names: (string | undefined)[]): string | null {
  const known = names.filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b))
  if (known.length > 2) return `${known[0]} and ${known.length - 1} others`
  return known.length ? known.join(' and ') : null
}

async function holdersOf(ctx: BaseContext, sections: string[], today: string): Promise<Row[]> {
  if (!sections.length) return []
  // Every page (#1254, Codex): a section's past and Staff jobs must never push its Team Leader past the first 500.
  return (await all(ctx, T.job, JOB_FIELDS, [['section', 'in', sections]])).filter(job => inForce(job, today) && text(job.job) === 'Team Leader')
}
export async function employeeNames(ctx: BaseContext, ids: string[]): Promise<Map<string, string>> {
  const wanted = unique(ids)
  return wanted.length ? new Map((await list(ctx, T.employee, ['name'], [['row_id', 'in', wanted]])).map(e => [exact(e.row_id), text(e.name)])) : new Map()
}
/** The names of the people a proposal waits for, in their order. */
export async function waitingName(ctx: BaseContext, people: string[]): Promise<string> {
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
  // The asker's own job holds the section it goes to, never the one it leaves.
  for (const holder of await holdersOf(ctx, [a.from_section], today)) people.push(...(await approversOf(ctx, holder)).approvers.people)
  return { people: unique(people), fallbackRoles: approvers.fallbackRoles }
}

/** Who a job's proposal goes to now: authority moves with the job, so this is read fresh. */
export async function waitingOnNow(ctx: ReadContext, job: Row | undefined, maker: string, a?: About): Promise<string> {
  return (await reviewingNow(ctx, job, maker, a)).name
}
/** #1219: the same, with the people it names, so the page can say who they are. */
async function reviewingNow(ctx: ReadContext, job: Row | undefined, maker: string, a?: About): Promise<{ name: string; people: string[] }> {
  const approvers = a ? await approversFor(ctx, a, job, istToday()) : (await approversOf(ctx, job)).approvers
  const people = (await ctx.changeProposals.routeFor(maker, approvers))?.people ?? []
  return { name: await waitingName(ctx, people), people }
}

/** The day in India of a timestamp, or '' for none. */
export const istDay = (at: string | null) => (at ? istToday(Date.parse(at)) : '')
const dayAfter = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** A proposal as a person reads it: names only. */
function view(proposal: ChangeProposal, waitingFor?: string, reviewers: Reviewer[] = []) {
  const a = about(proposal)
  return { id: proposal.row_id, kind: a.kind, what: a.what, from: a.from, to: a.to, store: a.store, state: proposal.state, applied: isApplied(proposal),
    moved: a.moved_name ?? null,
    taken_back: proposal.state === 'Undone' && proposal.decided_by === proposal.maker,
    waiting_for: waitingFor ?? (proposal.route.people.length ? a.manager_name : null) ?? MASTER_DATA_TEAM,
    reason: proposal.decision_reason, asked_on: istDay(proposal.created_at), decided_on: istDay(proposal.decided_at), reviewers }
}
export const sentView = async (ctx: BaseContext, proposal: ChangeProposal) => view(proposal, await waitingName(ctx, proposal.route.people), await reviewersOf(ctx, proposal.route.people))

/** The pending proposals this caller may decide now; with `setUps`, the Department Managers' set-ups instead.
 *  #1219: each with `others`, whoever else may decide it, the caller left out. */
export async function waitingForMe(ctx: ReadContext, setUps = false): Promise<(ChangeProposal & { others: string[] })[]> {
  const mine: (ChangeProposal & { others: string[] })[] = []
  const today = istToday()
  for (let start = 0; ; start += 500) {
    const pending = await ctx.changeProposals.list({ states: OPEN, limit: 500, start })
    // One entry per set-up: its department proposal stands for the bundle.
    // A Department Manager's own pre-fill (#1205) is theirs to answer on Your department, not to review.
    const others = pending.filter(proposal => proposal.maker !== ctx.user && (setUps ? about(proposal).kind as string === 'department'
      && (proposal.about as Record<string, unknown>).for_person !== ctx.user : !isSetUp(proposal)))
    const jobs = others.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', unique(others.map(p => about(p).job_assignment))]])) : new Map<string, Row>()
    const lookup = await approverLookup(ctx, [...jobs.values()], setUps ? [] : others.map(p => exact(about(p).from_section)), today)
    const asks = others.map(proposal => {
      const a = about(proposal)
      return { maker: proposal.maker, approvers: setUps ? lookup.approversOf(jobs.get(a.job_assignment)) : lookup.approversFor(a, jobs.get(a.job_assignment)) }
    })
    // #1219: theirs as the manager's, or any one as a Master Data Editor, asked together.
    // An editor's asks name the role only, so the managers behind them are asked in the same call: the platform
    // reads every route's people together, and naming who else each is with below reads nothing more (Codex).
    const decider = asks.map(ask => ({ maker: ask.maker, approvers: asDecider(ctx, ask.approvers) }))
    const widened = decider.some((ask, index) => ask.approvers !== asks[index].approvers)
    const may = asks.length ? (await ctx.changeProposals.mayDecideMany(widened ? [...decider, ...asks] : decider)).slice(0, asks.length) : []
    // Whoever else each is with, the caller left out: asked once per distinct maker and approvers.
    const routed = new Map<string, string[]>()
    for (const [index, proposal] of others.entries()) {
      if (!may[index]) continue
      const { maker, approvers } = asks[index]
      const key = JSON.stringify([maker, approvers])
      // A route with no one named goes to a role, which names no person: nothing to ask.
      if (!routed.has(key)) routed.set(key, approvers.people.length ? (await ctx.changeProposals.routeFor(maker, approvers))?.people ?? [] : [])
      mine.push({ ...proposal, others: routed.get(key)!.filter(person => person !== ctx.user) })
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
    const mine = (await ctx.changeProposals.list({ makers: [ctx.user], limit: VIEW_LIMIT })).filter(p => !isSetUp(p))
    // Waiting for approval, or applied and waiting for review (#1191).
    const pending = mine.filter(p => OPEN.includes(p.state))
    const codes = unique([...placements.map(p => exact(p.subcategory)), ...pending.map(p => exact(about(p).subcategory))])
    const leaves = codes.length ? byId(await all(ctx, T.subcategory, SUB_FIELDS, [['row_id', 'in', codes]])) : new Map<string, Row>()
    const floorName = (section: Row | undefined) => text(floors.get(exact(section?.floor))?.name) || null
    const pendingJobs = unique(pending.map(p => about(p).job_assignment))
    const pendingJobRows = pendingJobs.length ? byId(await list(ctx, T.job, JOB_FIELDS, [['row_id', 'in', pendingJobs]])) : new Map<string, Row>()
    const waiting = new Map<string, string>()
    const routes = new Map<string, string[]>()
    for (const p of pending) {
      const now = await reviewingNow(ctx, pendingJobRows.get(about(p).job_assignment), ctx.user, about(p))
      waiting.set(p.row_id, now.name)
      routes.set(p.row_id, now.people)
    }
    // Every reviewer named on the page, read once (Codex): many open changes usually share one manager.
    const named = await reviewersByPerson(ctx, [...routes.values()].flat())
    const reviewing = new Map([...routes].map(([id, people]) => [id, pick(named, people)]))
    const shown = mine.map(p => view(p, waiting.get(p.row_id), reviewing.get(p.row_id)))
    const views = []
    for (const job of jobs) {
      const site = exact(job.site)
      const section = sectionsById.get(exact(job.section))
      const { reportsTo } = await approversOf(ctx, job)
      const ours = pending.filter(p => about(p).job_assignment === exact(job.row_id))
      const outOf = (code: string) => ours.find(p => !isApplied(p) && ['removal', 'move'].includes(about(p).kind) && about(p).subcategory === code)
      // #1191: an applied addition shows as an addition, not twice; an applied removal stays in the list, struck through.
      const addedRows = new Set(ours.filter(p => isApplied(p) && about(p).kind === 'add').map(p => exact(p.result_row)))
      const takenOut = ours.filter(p => isApplied(p) && about(p).kind === 'removal' && about(p).from_section === exact(section?.row_id))
      const removedRows = takenOut.length ? byId(await list(ctx, T.placement, PLACEMENT_FIELDS, [['row_id', 'in', takenOut.map(p => exact(p.target_row))]])) : new Map<string, Row>()
      const applied = (p: ChangeProposal) => ({ id: p.row_id, waiting_for: waiting.get(p.row_id)! })
      const sectionChange = pending.find(p => isApplied(p) && about(p).kind === 'section' && exact(p.result_row) === exact(job.row_id))
      const reviewer = await reviewingNow(ctx, job, ctx.user)
      views.push({
        id: exact(job.row_id), job: text(job.job), store: text(siteRows.get(site)?.name), store_id: site, reports_to_code: exact(job.reports_to) || null, is_store: siteRows.get(site)?.is_store === true,
        reports_to: reportsTo,
        waiting_for: reviewer.name,
        // #1219: who reviews this job's changes, with who they are.
        reviewers: await reviewersOf(ctx, reviewer.people),
        section: section ? { id: exact(section.row_id), name: text(section.name), floor: floorName(section) } : null,
        section_change: sectionChange ? { ...applied(sectionChange), from: about(sectionChange).from } : null,
        subcategories: section ? [...placements.filter(p => exact(p.section) === exact(section.row_id) && !addedRows.has(exact(p.row_id)))
          .map(p => {
            const code = exact(p.subcategory)
            const asked = outOf(code)
            return { id: exact(p.row_id), code, name: text(leaves.get(code)?.subcategory) || 'Unnamed subcategory', ...pathOf(leaves.get(code)),
              pending: asked ? { id: asked.row_id, kind: about(asked).kind, to: about(asked).kind === 'move' ? about(asked).to : null, waiting_for: waiting.get(asked.row_id)!, applied: false } : null }
          }), ...takenOut.filter(p => removedRows.has(exact(p.target_row))).map(p => {
            const code = exact(about(p).subcategory)
            return { id: exact(p.target_row), code, name: about(p).what, ...pathOf(leaves.get(code)),
              pending: { ...applied(p), kind: 'removal' as const, to: null, applied: true } }
          })]
          .sort((a, b) => a.name.localeCompare(b.name)) : [],
        additions: section ? ours.filter(p => about(p).kind === 'add' && about(p).to_section === exact(section.row_id))
          .map(p => ({ id: p.row_id, code: exact(about(p).subcategory), name: text(leaves.get(exact(about(p).subcategory))?.subcategory) || about(p).what,
            ...pathOf(leaves.get(exact(about(p).subcategory))), waiting_for: waiting.get(p.row_id)!, applied: isApplied(p) }))
          .sort((a, b) => a.name.localeCompare(b.name)) : [],
        other_sections: sections.filter(s => exact(s.site) === site && isActive(s) && exact(s.row_id) !== exact(job.section))
          .map(s => ({ id: exact(s.row_id), name: text(s.name), floor: floorName(s) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    // #1191: whether each kind changes at once here, so the page says what will happen before anyone asks.
    const atOnce = async (type: string) => (await ctx.changeProposals.modeOf(type)) === APPLY_NOW
    const applies_at_once = { add: await atOnce(APPROVAL_TYPE.add), removal: await atOnce(APPROVAL_TYPE.removal), section: await atOnce(APPROVAL_TYPE.section) }
    return { state: 'ok' as const, name: text(employees[0].name), jobs: views, proposals: shown, waiting_for_me: (await waitingForMe(ctx)).length + (await waitingForMe(ctx, true)).length, applies_at_once }
  },

  /** Division, sub-division and category, for browsing; starting where most of the job's own subcategories sit. */
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
      const key = JSON.stringify([path.division, path.subdivision, path.category])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const start = top ? (([division, subdivision, category]) => ({ division, subdivision, category }))(JSON.parse(top[0]) as string[]) : null
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
    const open = await ctx.changeProposals.list({ makers: [ctx.user], states: OPEN, limit: 500 })
    const asked = new Set(open.filter(p => !isApplied(p) && about(p).kind === 'add').map(p => about(p).subcategory))
    // #1191: taken out by them and not yet reviewed: Undo puts it back, not another add.
    const takenOut = new Set(open.filter(p => isApplied(p) && about(p).kind === 'removal' && about(p).site === exact(job.site)).map(p => about(p).subcategory))
    return rows.map(row => {
      const code = exact(row.row_id)
      const section = where.get(code)
      const leaders = holders.filter(h => exact(h.section) === section).map(h => names.get(exact(h.employee)))
      const holder = !section ? { kind: 'none' as const }
        : section === exact(job.section) ? { kind: 'mine' as const }
        : { kind: 'other' as const, section: text(sections.get(section)?.name), team_leader: fewNames(leaders) }
      return { code, name: text(row.subcategory), holder, asked: asked.has(code), taken_out: takenOut.has(code) }
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
    if (!rows.length) return { state: 'ok' as const, rows: [] }
    // #1219: who took each out. The latest change of its end says who, however it was made: a Dash removal is
    // saved as the person who asked, so history names them, and a later end in Featherbase, an import or a
    // service names whoever made that. The reader doesn't know or care which.
    const ids = rows.map(r => exact(r.row_id))
    const ender: Record<string, { by: string }> = {}
    for (let i = 0; i < ids.length; i += 500)
      Object.assign(ender, (await ctx.baseTables.changedBy?.(T.placement, { rows: ids.slice(i, i + 500), column: 'ends_on' })) ?? {})
    // A removal still open for review can be put back by the master data team, never their own. Only open
    // reviews are read, a set that stays small: the page never grows with the app's history (Codex). A row
    // whose end has no history (ended outside the platform's saves) names nobody.
    const open = new Map<string, string>()
    for (let start = 0; ; start += 500) {
      const page = await ctx.changeProposals.list({ states: ['Not yet reviewed'], limit: 500, start })
      for (const p of page) if (about(p).kind === 'removal' && p.target_row && p.maker !== ctx.user) open.set(exact(p.target_row), p.row_id)
      if (page.length < 500) break
    }
    const removerOf = (r: Row) => ender[exact(r.row_id)]?.by ?? ''
    const removers = await peopleNamed(ctx, rows.map(removerOf).filter(Boolean))
    const leaves = rows.length ? byId(await all(ctx, T.subcategory, SUB_FIELDS, [['row_id', 'in', unique(rows.map(r => exact(r.subcategory)))]])) : new Map<string, Row>()
    const stores = rows.length ? byId(await list(ctx, T.site, ['name'], [['row_id', 'in', unique(rows.map(r => exact(r.store)))]])) : new Map<string, Row>()
    const sections = rows.length ? byId(await list(ctx, T.section, SECTION_FIELDS, [['row_id', 'in', unique(rows.map(r => exact(r.section)))]])) : new Map<string, Row>()
    return { state: 'ok' as const, rows: rows.filter(r => isMerchandise(leaves.get(exact(r.subcategory))))
      .map(r => ({ store: text(stores.get(exact(r.store))?.name), code: exact(r.subcategory), name: text(leaves.get(exact(r.subcategory))?.subcategory),
        ...pathOf(leaves.get(exact(r.subcategory))), was_in: text(sections.get(exact(r.section))?.name), since: dayAfter(day(r.ends_on)),
        removed_by: removers.get(removerOf(r)) ?? null,
        put_back: open.has(exact(r.row_id)) ? { proposal: open.get(exact(r.row_id))! } : null }))
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
    const floors = sections.length ? byId(await all(ctx, T.floor, ['name', 'site'], [['site', 'in', sites]])) : new Map<string, Row>()
    const holders = await holdersOf(ctx, unique(as.flatMap(a => [exact(a.from_section), a.to_section])), today)
    const names = await employeeNames(ctx, holders.map(h => exact(h.employee)))
    // Everyone named on any card, read once.
    const named = await reviewersByPerson(ctx, waiting.flatMap(p => p.others))
    const alsoWith = new Map(waiting.map(proposal => [proposal.row_id, pick(named, proposal.others)]))
    const holderOf = (section: string | undefined, except: string) => {
      return fewNames(holders.filter(h => exact(h.section) === exact(section) && exact(h.row_id) !== except).map(h => names.get(exact(h.employee))))
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
      return { ...view(proposal), kind: isMove ? 'move' as const : a.kind, who: a.maker_name, from, to, also_with: alsoWith.get(proposal.row_id)!,
        path: a.subcategory ? pathOf(leaves.get(exact(a.subcategory))) : null,
        sections: isMove ? sections.filter(s => exact(s.site) === a.site).map(s => ({ id: exact(s.row_id), name: text(s.name), floor: text(floors.get(exact(s.floor))?.name) || null }))
          .sort((x, y) => x.name.localeCompare(y.name)) : [] }
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
export async function aboutTheJob(ctx: ActionContext, job: Row, employee: Row): Promise<Pick<About, 'store' | 'site' | 'maker_name' | 'manager_name' | 'job_assignment'>> {
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
/** `extra` marks who asks when it isn't the section's own Team Leader (#1223: a manager, `by_manager`).
 *  `expectedFrom`: the section the caller checked it may take from ('' for none); one read under lock that
 *  differs is refused, so what was authorised is what is proposed. */
/** `holds`: which placements count as in a section today. Your sections reads them inclusively (inForce);
 *  a manager's page reads them as reach does (holdsOn), so a manager's addition passes that (#1223). */
export async function proposeAdd(ctx: ActionContext, job: Row, employee: Row, section: Row, code: string, today: string, extra: Partial<About> = {}, expectedFrom?: string,
  holds: (row: Row, today: string) => boolean = inForce) {
  const [subcategory] = await list(ctx, T.subcategory, ['subcategory', 'subcategory_type'], [['row_id', '=', code]])
  if (!isMerchandise(subcategory)) ctx.reject('Pick a subcategory from the list')
  const site = exact(job.site)
  const name = text(subcategory.subcategory)
  // First, as an undo and Put back do (#1219, Codex): one waiting behind them reads what they restored.
  await ctx.changeProposals.serialize(`${site}:${code}`)
  if (await scheduledLater(ctx, site, code, today)) ctx.reject(`${SCHEDULED} (${name})`)
  // #1191: taken out by them and not yet reviewed: Undo puts it back, and leaves one record, not two that cancel out.
  const takenOut = (await ctx.changeProposals.list({ makers: [ctx.user], states: ['Not yet reviewed'], limit: 500 }))
    .some(p => about(p).kind === 'removal' && about(p).site === site && about(p).subcategory === code)
  if (takenOut) ctx.reject(`You took ${name} out and it isn't reviewed yet. Use Undo on it to put it back`)
  const seen = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => holds(row, today))
  // What is checked below is what the proposal records.
  for (const row of seen) await ctx.changeProposals.lockRow(T.placement, exact(row.row_id))
  // #1223: in no section when checked: queue with any other addition of it before reading again.
  if (expectedFrom === '') await ctx.changeProposals.serialize(`${site}:${code}`)
  const placed = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', site], ['subcategory', '=', code]])).filter(row => holds(row, today))
  if (expectedFrom !== undefined && placed.length <= 1 && exact(placed[0]?.section) !== expectedFrom && exact(placed[0]?.section) !== exact(section.row_id))
    ctx.reject(`${name} has just moved. Open the page again`)
  if (placed.some(row => exact(row.section) === exact(section.row_id))) ctx.reject(`${name} is already in your section`)
  if (placed.length > 1) ctx.reject(`${name} is in more than one section here. Ask the master data team to look at it`)
  const elsewhere = placed[0]
  const [other] = elsewhere ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(elsewhere.section)]]) : []
  const base = await aboutTheJob(ctx, job, employee)
  const a = { ...base, kind: 'add' as const, what: name, from: elsewhere ? text(other?.name) : 'No section', to: text(section.name), subcategory: code, from_section: exact(elsewhere?.section), to_section: exact(section.row_id), ...extra }
  const proposal = await ctx.changeProposals.propose({ table: T.placement, row: elsewhere ? exact(elsewhere.row_id) : null,
    changes: elsewhere ? { section: exact(section.row_id) } : { store: site, subcategory: code, section: exact(section.row_id) },
    reviewed: elsewhere ? ['store', 'subcategory'] : [], approvers: await approversFor(ctx, a, job, today), about: a,
    type: APPROVAL_TYPE.add, apply: { effectiveOn: today, newRow: await placementStamp(ctx, site, code, today) } })
  return sentView(ctx, proposal)
}

export const actions = {
  /** "Not mine": take a subcategory out of my section, without saying where it goes (#1175). */
  async propose_removal(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const today = istToday()
    const { job, employee } = await myJob(ctx, payload.job, today)
    if (!(await mayEditOwnSection(ctx, ctx.user, job, today))) ctx.reject(NO_EDIT)
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
      type: APPROVAL_TYPE.removal, apply: { effectiveOn: today },
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
    if (!(await mayEditOwnSection(ctx, ctx.user, job, today))) ctx.reject(NO_EDIT)
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
    const today = istToday()
    const { job, employee } = await myJob(ctx, payload.job, today)
    const to = await sectionInStore(ctx, payload.to_section, exact(job.site))
    if (exact(to.row_id) === exact(job.section)) ctx.reject('That is already your section')
    const [from] = exact(job.section) ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(job.section)]]) : []
    const base = await aboutTheJob(ctx, job, employee)
    // A job carrying a floor keeps it true to its section; most jobs carry none and stay so.
    const changes: Record<string, string | null> = { section: exact(to.row_id) }
    if (exact(job.floor)) changes.floor = exact(to.floor) || null
    const proposal = await ctx.changeProposals.propose({ table: T.job, row: exact(job.row_id), changes, reviewed: ['employee', 'site', 'job', ...(changes.floor === undefined ? ['floor'] : [])],
      type: APPROVAL_TYPE.section, apply: { effectiveOn: today, newRow: await jobStamp(ctx, job, exact(to.row_id), today) },
      approvers: (await approversOf(ctx, job)).approvers,
      about: { ...base, kind: 'section', what: `${text(job.job)} at ${base.store}`, from: from ? text(from.name) : 'No section', to: text(to.name), from_section: exact(job.section), to_section: exact(to.row_id) } })
    return sentView(ctx, proposal)
  },

  /** Undo: the maker takes back a pending proposal, or one applied at once and not yet reviewed (#1191).
   *  The platform refuses anyone else, and a decided or reviewed one. */
  async withdraw(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const [proposal] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
    if (!proposal) ctx.reject('That proposal no longer exists')
    // #1246: a Buyer Section move is taken back as it waits; once made, only the master data team undoes it.
    if (about(proposal).kind as string === 'buyer_section') {
      if (isApplied(proposal)) ctx.reject('It has already been made. Ask the master data team to turn it down')
      const taken = await ctx.changeProposals.withdraw(proposal.row_id)
      return { id: taken.row_id, state: taken.state }
    }
    if (!isApplied(proposal)) return view(await ctx.changeProposals.withdraw(proposal.row_id))
    if (proposal.maker !== ctx.user) ctx.reject('Only the person who asked can undo this')
    await refuseUndoIfMovedOn(ctx, proposal)
    return view(await ctx.changeProposals.undo(proposal.row_id, { approvers: { people: [], fallbackRoles: [] } }))
  },

  /** The approver's decision. The platform refuses the maker and anyone but the approver. */
  async decide(ctx: ActionContext) {
    const payload = payloadOf(ctx)
    const proposal = await proposalOf(ctx, payload)
    // #1246: a Buyer Section move is decided by decide_buyer_section, never here.
    if (about(proposal).kind as string === 'buyer_section') ctx.reject('Decide this from the Buyer Section list')
    // Its bundle and its own-department rule live in decide_department (#1219, Codex).
    if (isSetUp(proposal)) ctx.reject('A department set-up is decided on its own card, on Waiting for you')
    const a = about(proposal)
    const instead = typeof payload.to_section === 'string' && payload.to_section && payload.to_section !== a.to_section ? payload.to_section : ''
    const { job, approvers, today } = await holdAuthority(ctx, proposal, instead)
    // #1219: two can decide now; whoever is second is told what happened, not asked to approve.
    if (!OPEN.includes(proposal.state)) ctx.reject(['Confirmed', 'Undone'].includes(proposal.state) ? 'This has already been reviewed' : 'This has already been decided')
    // #1191: a change that applied at once is confirmed or undone; one waiting is approved or rejected.
    if (isApplied(proposal)) {
      if (payload.decision === 'confirm') return view(await ctx.changeProposals.confirm(proposal.row_id, { approvers }))
      if (payload.decision !== 'undo') ctx.reject('This has already been done: confirm it or undo it')
      await refuseUndoIfMovedOn(ctx, proposal)
      // The platform refuses a reason that is not text, and a missing one from a reviewer.
      return view(await ctx.changeProposals.undo(proposal.row_id, { approvers, reason: payload.reason as string | undefined }))
    }
    if (payload.decision === 'confirm' || payload.decision === 'undo') ctx.reject('This is waiting for approval: approve it or reject it')
    if (payload.decision === 'reject')
      return view(await ctx.changeProposals.reject(proposal.row_id, { approvers, reason: typeof payload.reason === 'string' ? payload.reason : '' }))
    if (payload.decision !== 'approve') ctx.reject('Approve or reject')
    // "Move it elsewhere": the approver's own section, in the same store, open, and not where it is now.
    let elsewhere: Row | null = null
    if (instead) {
      if (a.kind !== 'add' && a.kind !== 'move') ctx.reject('Only a subcategory going to a section can be put elsewhere')
      elsewhere = await sectionInStore(ctx, instead, a.site)
      if (exact(elsewhere.row_id) === exact(a.from_section)) ctx.reject('It is already in that section')
    }
    // A subcategory in no section yet has no row to queue at, so two adds queue on what they share.
    if (a.kind === 'add' && !a.from_section) await ctx.changeProposals.serialize(`${a.site}:${a.subcategory}`)
    if (a.kind === 'add') await ctx.changeProposals.lockRow(T.subcategory, exact(a.subcategory))
    const stale = await whyStale(ctx, proposal, a, job, today, elsewhere ? exact(elsewhere.row_id) : a.to_section)
    if (stale) return view(await ctx.changeProposals.needsFreshReview(proposal.row_id, { approvers, reason: stale }))
    if (a.kind === 'removal') return view(await ctx.changeProposals.approve(proposal.row_id, { approvers, effectiveOn: today }))
    const newRow = a.kind === 'section' ? await jobStamp(ctx, job!, a.to_section, today, 'approved') : await placementStamp(ctx, a.site, exact(a.subcategory), today, 'approved')
    const decided = await ctx.changeProposals.approve(proposal.row_id, { approvers, effectiveOn: today, newRow,
      ...(elsewhere ? { instead: { section: exact(elsewhere.row_id) }, reason: `Put in ${text(elsewhere.name)} instead.` } : {}) })
    // StyleHR: once the vendor's API is ready, an approved `section` proposal is posted to it here. Not built (#975).
    return view(decided)
  },

  /** #1219: "Put back in <section>", on Not in any section: the master data team undoes a removal still open
   *  for review, so the subcategory is back where it was and the manager is not asked about it. */
  async put_back(ctx: ActionContext) {
    if (!ctx.roles?.includes(FALLBACK_ROLE)) ctx.reject('Only the master data team can put a subcategory back')
    const proposal = await proposalOf(ctx, payloadOf(ctx))
    const a = about(proposal)
    if (a.kind !== 'removal') ctx.reject('Only a subcategory taken out of a section can be put back')
    // The platform lets a maker undo their own with no reviewer: that is Undo on Your sections, not this.
    if (proposal.maker === ctx.user) ctx.reject('This is your own change. Use Undo on Your sections to take it back')
    if (!isApplied(proposal)) ctx.reject(proposal.state === 'Pending' ? `${a.what} has not been taken out yet` : `The removal of ${a.what} has already been reviewed, so it can't be put back here`)
    const { approvers } = await holdAuthority(ctx, proposal, '')
    await refuseUndoIfMovedOn(ctx, proposal, 'put back')
    return view(await ctx.changeProposals.undo(proposal.row_id, { approvers, reason: `Put back in ${a.from} by the master data team.` }))
  },
}

async function proposalOf(ctx: ActionContext, payload: Record<string, unknown>): Promise<ChangeProposal> {
  const [proposal] = typeof payload.proposal === 'string' && payload.proposal ? await ctx.changeProposals.list({ ids: [payload.proposal] }) : []
  if (!proposal) ctx.reject('That proposal no longer exists')
  return proposal
}

/** Authority holds still until this commits: the jobs, then their people, then departments, links and sections;
 *  then who may decide, a Master Data Editor among them (#1219). Shared by decide and put_back. */
async function holdAuthority(ctx: ActionContext, proposal: ChangeProposal, instead: string) {
  const a = about(proposal)
  const today = istToday()
  // Authority holds still until this commits: the jobs, then their people, then the reads.
  const holders = a.kind === 'add' && a.from_section ? await holdersOf(ctx, [a.from_section], today) : []
  // #1223: a manager's move also holds the manager's own authority still: their managing jobs, staff rows,
  // departments and department links there. Order everywhere: jobs, people, departments, links, sections.
  const authority = a.by_manager ? await authorityRows(ctx, proposal.maker, a.site) : { jobs: [], employees: [], departments: [], links: [] }
  // An applied section change is undone through its replacement row: it joins the jobs, before any person is locked.
  const replacement = a.kind === 'section' && isApplied(proposal) ? exact(proposal.result_row) : ''
  for (const id of unique([a.job_assignment, ...holders.map(h => exact(h.row_id)), ...authority.jobs, replacement]).sort()) await ctx.changeProposals.lockRow(T.job, id)
  const [job] = await list(ctx, T.job, JOB_FIELDS, [['row_id', '=', a.job_assignment]])
  const jobs = [job, ...(await holdersOf(ctx, a.kind === 'add' && a.from_section ? [a.from_section] : [], today))].filter(Boolean)
  // The people in one order, so two decisions can't wait on each other's; then what the rules below read.
  for (const person of unique([...jobs.flatMap(j => [exact(j.reports_to), exact(j.employee)]), ...authority.employees]).sort()) await ctx.changeProposals.lockRow(T.employee, person)
  for (const id of [...authority.departments].sort()) await ctx.changeProposals.lockRow(DEPARTMENT, id)
  for (const id of [...authority.links].sort()) await ctx.changeProposals.lockRow(DEPARTMENT_SECTION, id)
  // In id order, as with the people: two moves between the same two sections can't cross.
  // #1223: a manager's move rests on the moved job's current section's floor: it holds still too.
  for (const section of unique([a.to_section, a.kind === 'move' || a.kind === 'removal' || (a.by_manager && a.kind === 'add') ? exact(a.from_section) : '', a.by_manager && a.kind === 'section' ? exact(job?.section) : '', instead]).sort()) await ctx.changeProposals.lockRow(T.section, section)
  return { job: job as Row | undefined, approvers: asDecider(ctx, await approversFor(ctx, a, job, today)), today }
}

/** The identifier and source of a new row: how it came, and on which day. */
const placementStamp = async (ctx: ActionContext, site: string, code: string, today: string, how = 'applied') =>
  ({ section_subcategory_id: await freeId(ctx, T.placement, `${site}-${code}-${today}`), source_key: `Dash, ${how} ${today}` })
export const jobStamp = async (ctx: ActionContext, job: Row, toSection: string, today: string, how = 'applied') =>
  ({ assignment_id: await freeId(ctx, T.job, `JA-${exact(job.employee)}-${exact(job.site)}-${toSection.split('-').at(-1)}-${today}`), source_key: `Dash, ${how} ${today}` })

/** An undone removal puts the subcategory back in the section it left: not if it has since gone to another.
 *  The platform sees only the rows the change touched; this rule is Dash's own. */
async function refuseUndoIfMovedOn(ctx: ActionContext, proposal: ChangeProposal, asked: 'undo' | 'put back' = 'undo') {
  const a = about(proposal)
  if (a.kind !== 'removal') return
  await ctx.changeProposals.serialize(`${a.site}:${a.subcategory}`)
  const placed = (await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', a.site], ['subcategory', '=', exact(a.subcategory)]])).filter(row => notOver(row, istToday()))
  if (!placed.length) return
  const [section] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(placed[0].section)]])
  // #1219: the master data team putting it back is not told to ask itself.
  ctx.reject(asked === 'put back' ? `${a.what} has since been put in ${text(section?.name)}, so it can't be put back`
    : `${a.what} has since been put in ${text(section?.name)}, so it can't be undone. Ask the master data team if that is wrong`)
}

/** A row id free on this Table: an end-and-add can land on the same day twice, and an undone row keeps its id (#1191). */
export async function freeId(ctx: ActionContext, table: string, base: string): Promise<string> {
  const like: Filter = ['row_id', 'like', `${base}%`]
  const taken = new Set([...await list(ctx, table, [], [like]), ...await list(ctx, table, [], [like, ['retired_at', '!=', null]])].map(row => exact(row.row_id)))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** What the row comparison can't see: the person still holds the job, and the section still stands. */


async function whyStale(ctx: ActionContext, proposal: ChangeProposal, a: About, job: Row | undefined, today: string, destination: string): Promise<string | null> {
  if (!job || !inForce(job, today)) return 'The job behind this has ended.'
  const [employee] = await list(ctx, T.employee, ['person', EMPLOYEE_STATUS], [['row_id', '=', exact(job.employee)]])
  if (a.by_manager) {
    // A manager's change is judged as reach is: the job no longer holds on its ends_on day.
    if (!holdsOn(job, today)) return 'The job behind this has ended.'
    if (a.kind === 'section') {
      if (exact(employee?.[EMPLOYEE_STATUS]) !== 'Current') return 'The person being moved has left.'
      const [to] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', destination]])
      if (!(await mayMove(ctx, proposal.maker, job, to, today))) return 'The manager who asked no longer manages that part of the store.'
    } else {
      // #1223: a manager adding to or taking from a section in their area; the job is their own.
      if (exact(employee?.person) !== proposal.maker || exact(employee?.[EMPLOYEE_STATUS]) !== 'Current') return 'The person who asked no longer holds this job.'
      const [section] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', a.kind === 'removal' ? exact(a.from_section) : a.to_section]])
      // An addition moved from another section needs both in one of their areas, as when it was asked.
      const [from] = a.kind === 'add' && a.from_section ? await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(a.from_section)]]) : []
      if (!(await sectionAreaOf(ctx, proposal.maker, section, today, a.kind === 'add' && a.from_section ? (from ? [from] : [{}]) : []))) return 'The manager who asked no longer manages that section.'
    }
  } else if (exact(employee?.person) !== proposal.maker || exact(employee?.[EMPLOYEE_STATUS]) !== 'Current') return 'The person who asked no longer holds this job.'
  // #1277: under business roles, the asker's own section change also needs a role from this job that may edit sections.
  if (!a.by_manager && a.kind !== 'section' && !(await mayEditOwnSection(ctx, proposal.maker, job, today))) return 'The person who asked may no longer change their section\'s subcategories.'
  if (a.kind !== 'removal') {
    const [to] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', destination]])
    if (!isActive(to) || exact(to?.site) !== a.site) return 'The section it would go to is no longer open.'
    // A job carrying a floor must match the section's, changed or not; a job with none has nothing to match.
    const floor = proposal.changes.find(change => change.column_name === 'floor' && (change.proposed_value !== null || change.review_base_value !== null))
    if (a.kind === 'section' && floor && floor.proposed_value !== (exact(to.floor) || null)) return 'The section it would go to has moved floor.'
  }
  if (!a.by_manager && (a.kind === 'move' || a.kind === 'removal') && exact(job.section) !== a.from_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'move') {
    const [from] = await list(ctx, T.section, SECTION_FIELDS, [['row_id', '=', exact(a.from_section)]])
    if (!isActive(from)) return 'The section it would leave is no longer open.'
  }
  if (!a.by_manager && a.kind === 'add' && exact(job.section) !== a.to_section) return 'The person who asked no longer holds that section.'
  if (a.kind === 'add') {
    const [subcategory] = await list(ctx, T.subcategory, ['subcategory_type'], [['row_id', '=', exact(a.subcategory)]])
    if (!isMerchandise(subcategory)) return 'That subcategory is no longer sold.'
  }
  if (a.kind !== 'section') {
    const rows = await list(ctx, T.placement, PLACEMENT_FIELDS, [['store', '=', a.site], ['subcategory', '=', exact(a.subcategory)]])
    if (rows.some(row => notOver(row, today) && day(row.starts_on) > today)) return 'A change to that subcategory is already planned.'
    // A manager's addition moved from a section: its placement there must still hold today, or approving it
    // would copy an ended placement into the new one (#1223, Codex 28).
    if (a.by_manager && a.kind === 'add' && a.from_section) {
      const [source] = proposal.target_row ? await list(ctx, T.placement, PLACEMENT_FIELDS, [['row_id', '=', exact(proposal.target_row)]]) : []
      if (!source || !holdsOn(source, today) || exact(source.section) !== exact(a.from_section)) return 'Where that subcategory was has since changed.'
    }
    // A manager's addition reads placements as their page does (holdsOn, #1223); Your sections' own stays inclusive.
    if (a.kind === 'add' && !a.from_section && rows.some(row => (a.by_manager ? holdsOn(row, today) : notOver(row, today)))) return 'That subcategory has since been put in a section.'
  }
  return null
}
