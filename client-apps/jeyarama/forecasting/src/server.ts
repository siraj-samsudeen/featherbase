// Featherbase runtime hook API v1. The server, not the page, decides who may do what to a number:
//   - who is acting is the signed-in person (ctx.user), never a name in the request body. An
//     administrator may act as a named person, so "Viewing as" works for whoever looks after the app;
//   - a person acts only inside their own area;
//   - a new number starts as Reference, or Waiting on the person's own manager; only the Chief
//     Executive's starts Applied. Engine rows are the system's alone. An administrator acts for the
//     system (loading history, "Viewing as"), so the approval-chain rules bind people, not them;
//   - a number's status moves only along the approval chain (TRANSITIONS below), and its scope never
//     moves after it is entered.
// Who people are and what they cover comes from one of two org charts (Org, below): the made-up one
// (madeUp.ts, areas.ts) on an instance with no Run loaded, or forecasting.reach and forecasting.run_line
// where a Run is loaded, read through the platform's documents; there the signed-in person is matched by name through
// the members of forecasting.forecaster. The review of a Run's lines (reviewer(), below) instead knows the signed-in
// person by their Person on the live org chart: their Employee rows and today's jobs (signedIn.ts, #1430).
import { areaText, covers, personNamed } from './areas'
import { person as madeUpPerson } from './madeUp'
import { causesProblem, linesOf } from './causes'
import { orgChart } from './orgChart'
import { noticesFor } from './notices'
import { livePerson, signedIn } from './signedIn'
import { myPlaces } from './scoped'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export interface Context {
  user: string
  roles: string[]
  isNew: boolean
  row: Row
  old?: Row
  documents: {
    members(table: string): Promise<{ row_id: string; full_name: string }[]>
    list?(table: string, args: { fields: string[]; filters?: Filter[]; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
  }
  reject(message: string, fields?: Record<string, string>): never
  /** The instance's own Tables the app declares reading (#1428): the live org chart. Absent where the instance has none. */
  baseTables?: Parameters<typeof orgChart>[0] & { available?(table: string, columns?: string[]): Promise<boolean> }
}
type Level = 'Store' | 'Division' | 'Subdivision' | 'Category' | 'Subcategory' | 'Section'
/** Someone on the org chart: their name and job, their manager's name, and what they cover. */
interface Who { name: string; role: string; reportsTo: string | null; area: string
  /** Their Employee rows, when found on the live org chart by their Person (#1430): the checks below match these, not the name. */
  employees?: string[] }
interface Org {
  named(name: string): Promise<Who | null>
  /** Whether everything in a store's scope ('All' for every store) is the person's. */
  covers(p: Who, store: string, level: Level, name: string): Promise<boolean>
}

const isAdmin = (ctx: Context) => ctx.user === 'Administrator' || ctx.roles.includes('System Manager')

// ---- the made-up org chart ----------------------------------------------------------------------------
const madeUp: Org = {
  async named(name) {
    const p = personNamed(name)
    return p ? { name: p.name, role: p.role, reportsTo: p.reportsTo ? madeUpPerson(p.reportsTo).name : null, area: areaText(p) } : null
  },
  async covers(p, store, level, name) {
    const q = personNamed(p.name)!
    return level !== 'Subdivision' && level !== 'Section' && store !== 'All' && covers(q, { store, level, name })
  },
}

// ---- the loaded Run's org chart: forecasting.reach and forecasting.run_line ---------------------------
interface Place { store: string; codes: string[] | null }
async function readAll(ctx: Context, table: string, fields: string[], filters: Filter[]) {
  const rows: Row[] = []
  for (;;) {
    const page = await ctx.documents.list!(table, { fields, filters, limit_start: rows.length, limit_page_length: 500 })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}
function loaded(ctx: Context): Org {
  const places = new Map<string, Place[]>()
  return {
    async named(name) {
      const [r] = await readAll(ctx, 'forecasting.reach', ['full_name', 'role', 'place', 'reports_to', 'places_json'], [['full_name', '=', name]])
      if (!r) return null
      places.set(String(r.full_name), JSON.parse(String(r.places_json || '[]')))
      return { name: String(r.full_name), role: String(r.role), reportsTo: r.reports_to ? String(r.reports_to) : null, area: String(r.place) }
    },
    async covers(p, store, level, name) {
      const mine = places.get(p.name) ?? []
      if (!mine.length) return true // every store
      const column = { Store: null, Division: 'division', Subdivision: 'subdivision', Category: 'category', Subcategory: 'subcategory', Section: 'section' }[level]
      const filters: Filter[] = [...(store === 'All' ? [] : [['store', '=', store] as Filter]), ...(column ? [[column, '=', name] as Filter] : [])]
      const lines = await readAll(ctx, 'forecasting.run_line', ['store', 'code'], filters)
      if (!lines.length) return false
      return lines.every(l => mine.some(pl => pl.store === l.store && (!pl.codes || pl.codes.includes(String(l.code)))))
    },
  }
}
async function orgOf(ctx: Context): Promise<Org> {
  if (!ctx.documents.list) return madeUp
  const run = await ctx.documents.list('forecasting.run_line', { fields: ['row_id'], limit_page_length: 1 })
  return run.length ? loaded(ctx) : madeUp
}

/** The person acting: the one the row names, which must be the signed-in person unless an administrator acts. */
async function actor(ctx: Context, org: Org, named: unknown): Promise<Who> {
  const p = await org.named(String(named ?? ''))
  if (!p) ctx.reject(`${String(named || 'Nobody')} is not on the forecasting org chart`)
  if (isAdmin(ctx)) return p
  const me = (await ctx.documents.members('forecasting.forecaster')).find(m => m.row_id === ctx.user)
  if (!me) ctx.reject('You are not set up as a forecaster (the Forecasting Member role)')
  if (me.full_name !== p.name) ctx.reject(`You are signed in as ${me.full_name}; you cannot act as ${p.name}`)
  return p
}

async function inArea(ctx: Context, org: Org, p: Who, store: unknown, level: unknown, name: unknown) {
  if (!(await org.covers(p, String(store), String(level) as Level, String(name))))
    ctx.reject(`${p.name} works on ${p.area}; ${level === 'Store' ? String(store) : `${String(store)} · ${String(name)}`} is outside it`)
}

/** Old status → new status, and who may make that move. */
const TRANSITIONS: Record<string, string[]> = {
  Waiting: ['Waiting', 'Applied', 'Not approved', 'Reference', 'Withdrawn'],
  Reference: ['Reference', 'Applied'],
  Applied: ['Applied', 'Reference'],
  'Not approved': ['Not approved'],
  Withdrawn: ['Withdrawn'],
}
/** These describe what the number is for; once entered, they never change. */
const FIXED = ['month', 'run', 'store', 'scope_level', 'scope_name', 'weeks', 'entered_by', 'entered_by_role', 'entered_on']

async function prepareNumber(ctx: Context) {
  const { row, old } = ctx
  if (row.entered_by_role === 'Engine') {
    if (!isAdmin(ctx)) ctx.reject('Engine figures are written by the system, not entered')
    return
  }
  if (!String(row.reason ?? '').trim()) ctx.reject('Say why', { reason: 'Required' })
  if (row.kind === 'Change the weights') {
    const weights = JSON.parse(String(row.weights_json || '{}')) as Record<string, number>
    const total = Object.values(weights).reduce((n, w) => n + Number(w || 0), 0)
    if (Math.round(total) !== 100) ctx.reject(`The weights must add up to 100%. They add up to ${total}%.`, { weights_json: 'Must total 100' })
  }
  if ((row.kind === 'Change by a percent' || row.kind === 'Closure or event') && !(row.percent !== null && Number.isFinite(Number(row.percent)) && Number(row.percent) >= -100 && Number(row.percent) <= 500))
    ctx.reject('A percent change keeps its percent, from -100 (a closure) up', { percent: 'Required' })

  const org = await orgOf(ctx)
  if (ctx.isNew) {
    const p = await actor(ctx, org, row.entered_by)
    await inArea(ctx, org, p, row.store, row.scope_level, row.scope_name)
    if (row.entered_by_role !== p.role) ctx.reject(`${p.name} is a ${p.role}`)
    if (isAdmin(ctx)) return // the system loading history, or an administrator acting for someone
    if (row.status === 'Reference') return
    if (row.status === 'Applied' && !p.reportsTo) return
    if (row.status === 'Waiting' && p.reportsTo && row.waiting_on === p.reportsTo) return
    ctx.reject(p.reportsTo ? `A new number is Reference, or Waiting on ${p.reportsTo}` : 'A new number is Applied or Reference')
  }

  const changed = (k: string) => (k === 'value' || k === 'percent' ? Number(row[k] ?? 0) !== Number(old?.[k] ?? 0) : String(row[k] ?? '') !== String(old?.[k] ?? ''))
  const moved = FIXED.filter(changed)
  if (moved.length) ctx.reject(`A number's ${moved.join(', ')} cannot change once it is entered; enter a new number instead`)
  const from = String(old?.status), to = String(row.status)
  if (!(TRANSITIONS[from] ?? []).includes(to)) ctx.reject(`A number cannot go from ${from} to ${to}`)
  const edited = ['value', 'percent', 'reason', 'kind', 'weights_json'].some(changed)
  if (from === to && !edited && !changed('waiting_on')) return // nothing that needs a person

  const p = await actor(ctx, org, row.changed_by)
  await inArea(ctx, org, p, row.store, row.scope_level, row.scope_name)
  if (isAdmin(ctx)) return // an administrator acts for the system; people go through the chain below
  if (from === 'Waiting') {
    if (to === 'Withdrawn' || edited) {
      if (p.name !== old?.entered_by) ctx.reject('Only the person who entered a number withdraws or changes it')
      if (to !== 'Withdrawn' && to !== 'Waiting') ctx.reject('A changed number goes back to waiting')
      return
    }
    if (p.name !== old?.waiting_on) ctx.reject(`This number waits for ${String(old?.waiting_on)}, not ${p.name}`)
    if (to === 'Waiting' && (!p.reportsTo || row.waiting_on !== p.reportsTo)) ctx.reject(`${p.name} sends a number up to ${p.reportsTo ?? 'nobody'}`)
    return
  }
  if (edited) ctx.reject('A number is changed only while it waits for approval')
  // Reference → Applied (made the applied one), or Applied → Reference (replaced by another).
  if (old?.status === 'Applied' && to === 'Reference' && old.entered_by_role === 'Chief Executive' && p.role !== 'Chief Executive')
    ctx.reject("Only the Chief Executive can replace the Chief Executive's applied number")
  if (from === 'Reference' && to === 'Applied' && p.role === 'Team Leader') ctx.reject('A Team Leader sends a number for approval; they do not apply one')
}

/** A step in a number's history is taken by the signed-in person, inside their area; a comment is anyone's own. */
async function prepareDecision(ctx: Context) {
  const { row } = ctx
  const org = await orgOf(ctx)
  const p = await actor(ctx, org, row.decided_by)
  if (!row.number || row.decision === 'Comment' || row.decision === 'This is wrong') return
  if (!row.scope_level) ctx.reject("A step on a number names the number's scope", { scope_level: 'Required' })
  await inArea(ctx, org, p, row.store, row.scope_level, row.scope_name)
  if (row.decision === 'Made the applied number' && !String(row.note ?? '').trim()) ctx.reject('Say why this becomes the applied number', { note: 'Required' })
}

/** Why a day sold more or less than forecast: given by the signed-in person, for a scope that is theirs, with at least one cause. */
async function prepareExplanation(ctx: Context) {
  const { row } = ctx
  if (!String(row.causes ?? '').trim()) ctx.reject('Pick at least one cause', { causes: 'Required' })
  const day = Number(row.day)
  if (!Number.isInteger(day) || day < 1 || day > 31) ctx.reject('A day of the month, 1 to 31', { day: 'Required' })
  const org = await orgOf(ctx)
  const p = await actor(ctx, org, row.explained_by)
  if (!ctx.isNew && String(ctx.old?.explained_by) !== p.name && !isAdmin(ctx)) ctx.reject('Only the person who wrote an explanation changes it')
  await inArea(ctx, org, p, row.store, row.scope_level, row.scope_name)
}

// ---- the Team Leader review (#1419): forecast_change, forecast_line_review, forecast_question -------------
// A row names its line by the warehouse's own key (run, store, subcategory); the server reads that line from
// forecasting.forecast_line_month and decides from it: who may act on it (a Team Leader for their own store ·
// section, a Store Manager for their store), and what Feather Forecast said, so the engine figure stored with a
// change is the Run's, never the page's.
const LINE_KEY = ['run_id', 'store_code', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name']
async function lineOf(ctx: Context): Promise<Row> {
  const { row } = ctx
  const [line] = await ctx.documents.list!('forecasting.forecast_line_month', {
    fields: ['row_id', ...LINE_KEY, 'store_short_code', 'subcategory_code', 'forecast_month', 'forecast_value_before_tax', 'forecast_qty'],
    filters: [['run_id', '=', row.run_id], ['store_code', '=', row.store_code], ['subcategory_name', '=', row.subcategory_name]], limit_page_length: 1 })
  if (!line) ctx.reject(`${String(row.subcategory_name || 'That line')} is not in Run ${String(row.run_id || '')}`)
  for (const k of LINE_KEY) row[k] = line[k] // the key is the Run's, whatever the page sent
  // #1454: the line's subcategory code, which places the row for who may read it (null for a line merged from several)
  row.subcategory_code = line.subcategory_code ?? null
  return line
}
/** Whether a person reviews this line of the Run (a copy row: its store by site code): a Store or Department Manager
 *  their store; a Team Leader their own section today, from the live org chart (#1428): the section the line's
 *  subcategory sits in, or for a section's day the section it names. An instance without the org chart's Tables (the
 *  made-up one) holds a Team Leader to their store. */
async function reviews(ctx: Context, p: Who, line: Row): Promise<boolean> {
  const store = String(line.store_short_code)
  if (p.role === 'Store Manager' || p.role === 'Department Manager') return p.area === store
  // the Chief Executive reviews every line (#1442)
  if (p.role === 'Chief Executive') return true
  const base = ctx.baseTables
  const live = base && (await (base.available?.('Job Assignment') ?? Promise.resolve(true)))
  // a category head reviews the subcategories their Merchandise Assignment gives them at this store, today (#1442)
  if (p.role === 'Category Head') {
    if (!live || !ctx.row.subcategory_name || !line.subcategory_code) return false
    const sub = (await orgChart(base!, store, todayIST())).subcategories[String(line.subcategory_code)]
    // by Employee row where the person was found by their Person (#1430); two heads can share a name
    return p.employees ? !!sub?.categoryHeadId && p.employees.includes(sub.categoryHeadId) : sub?.categoryHead === p.name
  }
  if (p.role !== 'Team Leader' || p.area.split(' · ')[0] !== store) return false
  // without the org chart's Tables only the made-up instance may hold a Team Leader to their store; a real one refuses
  if (!live) return (await orgOf(ctx)) === madeUp
  const org = await orgChart(base!, store, todayIST())
  // a subcategory's line is in its section today; a line merged from several codes is in none a Team Leader holds
  if (ctx.row.subcategory_name && !line.subcategory_code) return false
  const at = ctx.row.subcategory_name ? org.sections.find(s => s.id === org.subcategories[String(line.subcategory_code)]?.section) : org.sections.find(s => s.name === ctx.row.section_name)
  if (!at || !(p.employees ? at.teamLeaderIds.some(id => p.employees!.includes(id)) : at.teamLeaders.includes(p.name))) return false
  // a day explanation is filed under the section the org chart gives, whatever the page sent
  if ('section_name' in ctx.row) ctx.row.section_name = at.name
  return true
}
/** The roles a manager's page acts in; an administrator viewing one acts in the role it names (#1442). */
const PAGE_ROLES = ['Team Leader', 'Store Manager', 'Category Head', 'Chief Executive']
/** Who answers a line or explains a day: a Team Leader for their section, a Store Manager for their store. The
 *  category head and the Chief Executive also change a line and ask about it (#1442), and nothing more. */
const LINE_ROLES = ['Team Leader', 'Store Manager', 'Department Manager']
async function reviewer(ctx: Context, named: unknown, line: Row, claimedRole?: unknown | unknown[], roles: string[] = LINE_ROLES): Promise<Who> {
  // An administrator acts for a person by name (the app's "view a section as its Team Leader", a manager's page
  // "viewing as"), whether or not that person is on the forecasting org chart: as a Team Leader unless the row names
  // one of the managers' roles.
  if (isAdmin(ctx)) return { name: String(named || 'Team Leader'), role: PAGE_ROLES.includes(String(claimedRole)) && roles.includes(String(claimedRole)) ? String(claimedRole) : 'Team Leader', reportsTo: null, area: `${String(line.store_short_code)} · ${String(ctx.row.section_name ?? '')}` }
  const live = await livePerson(ctx.baseTables, ctx.user, todayIST())
  if (!live) {
    // only the made-up instance finds people by name; a real one whose org chart can't be read lets no one act
    const org = await orgOf(ctx)
    if (org !== madeUp) ctx.reject('The org chart cannot be read just now, so the forecast cannot be changed; try again shortly')
    const p = await actor(ctx, org, named)
    if (!roles.includes(p.role)) ctx.reject(`A ${p.role} does not do this on a line`)
    if (!(await reviews(ctx, p, line))) ctx.reject(`${p.name} reviews ${p.area}; ${String(line.store_short_code)} · ${String(line.subcategory_name)} is outside it`)
    return p
  }
  // the signed-in person is who their Person is on the live org chart (#1430): their Employee rows and today's jobs,
  // never a name looked up; the row's name must be their own
  if (!live.employees.length) ctx.reject('Your sign-in is not linked to an employee on the org chart')
  if (!live.names.includes(String(named ?? ''))) ctx.reject(`You are signed in as ${live.names.join(' / ') || 'someone with no name on the org chart'}; you cannot act as ${String(named || 'nobody')}`)
  if (!live.jobs.length) ctx.reject(`${String(named)} has no forecasting job on the org chart today`)
  // each job they hold today that may do this, the ones the row's role names first: the first whose area holds the line acts
  const allowed = live.jobs.filter(j => roles.includes(j.role))
  if (!allowed.length) ctx.reject(`A ${live.jobs[0].role} does not do this on a line`)
  const want = [claimedRole].flat().map(String), named_ = String(named)
  for (const j of [...allowed.filter(j => want.includes(j.role)), ...allowed.filter(j => !want.includes(j.role))]) {
    const p: Who = { name: named_, role: j.role, reportsTo: null, area: j.area, employees: live.employees }
    if (await reviews(ctx, p, line)) return p
  }
  return ctx.reject(`${named_} reviews ${[...new Set(allowed.map(j => j.area))].join(', ')}; ${String(line.store_short_code)} · ${String(line.subcategory_name)} is outside it`)
}
/** The columns a save moved, other than `keep` and the platform's own stamps. */
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const same = (a: unknown, b: unknown) => norm(a) === norm(b) || (norm(a) !== '' && norm(b) !== '' && Number(norm(a)) === Number(norm(b)))
function unchanged(ctx: Context, keep: string[]) {
  return Object.keys(ctx.row).filter(k => !keep.includes(k) && !['updated_at', 'updated_by'].includes(k) && !same(ctx.row[k], ctx.old?.[k]))
}

/** A change asked for on a line's month: the engine figure and the result are worked out here; once sent it is
 *  never edited, only replaced by a new one or withdrawn by the person who sent it. */
async function prepareChange(ctx: Context) {
  const { row } = ctx
  if (!ctx.isNew) return moveChange(ctx)
  const line = await lineOf(ctx)
  const p = await reviewer(ctx, row.proposed_by, line, row.proposed_by_role, PAGE_ROLES)
  row.proposed_by_role = p.role
  if (!String(row.explanation ?? '').trim()) ctx.reject('Explain your proposed change', { explanation: 'Required' })
  if (row.change_scope !== 'month') ctx.reject('A change covers the whole month for now', { change_scope: 'month' })
  const engine = Number(line.forecast_value_before_tax), qty = Number(line.forecast_qty)
  let changed: number
  if (row.change_method === 'percent') {
    const pct = Number(row.change_percent)
    if (row.change_percent == null || !Number.isFinite(pct) || pct < -100) ctx.reject('A percent from -100 up', { change_percent: 'Required' })
    changed = engine * (1 + pct / 100)
    row.set_value_before_tax = null
  } else {
    const v = Number(row.set_value_before_tax)
    if (row.set_value_before_tax == null || !Number.isFinite(v) || v < 0) ctx.reject('A value of 0 or more, in rupees before tax', { set_value_before_tax: 'Required' })
    changed = v
    row.change_percent = null
  }
  // quantity moves with value, so the selling price stays the engine's (data model, "From changes to days")
  Object.assign(row, { engine_value_before_tax: Math.round(engine), engine_qty: Math.round(qty * 10) / 10,
    changed_value_before_tax: Math.round(changed), changed_qty: engine ? Math.round(qty * changed / engine * 10) / 10 : 0 })
  // Team Leaders send for approval; a manager's own change is final (data model, settled 27-Nov-2026: the Store
  // Manager's; a category head's and the Chief Executive's alike, #1442)
  // an administrator viewing the Team Leader's page keeps the status it sends (as before #1442)
  if (isAdmin(ctx) && p.role === 'Team Leader') return
  row.change_status = p.role === 'Team Leader' ? 'sent' : 'approved'
  Object.assign(row, { decided_by: null, decided_at: null, decision_note: null })
}

/** Who moves a change's status once it is entered (#1442), from → to: the proposer takes back their own sent change
 *  (withdrawn, or replaced by one they send next) and their own final change (withdrawn); the Store Manager of the
 *  line's store decides a sent change (approved, rejected, or replaced by their own number); whoever decided takes
 *  the decision back (to sent). Nothing else on a change moves: a revision is a new row. */
type Mover = 'proposer' | 'decider' | 'who decided'
const CHANGE_MOVES: Record<string, Record<string, Mover[]>> = {
  sent: { withdrawn: ['proposer'], replaced: ['proposer', 'decider'], approved: ['decider'], rejected: ['decider'] },
  approved: { withdrawn: ['proposer'], sent: ['who decided'] },
  rejected: { sent: ['who decided'] },
  replaced: { sent: ['who decided'] },
}
/** The settled rule (27-Nov-2026): the Store Manager of the line's store decides; nobody above them does. */
const DECIDERS = ['Store Manager']
async function moveChange(ctx: Context) {
  const { row, old } = ctx
  const from = String(old?.change_status), to = String(row.change_status)
  const movers = CHANGE_MOVES[from]?.[to]
  if (!movers) ctx.reject(from === to ? 'A sent change is not edited: send a new one that replaces it, or withdraw it' : `A change cannot go from ${from} to ${to}`)
  const moved = unchanged(ctx, ['change_status', 'reasons', 'decided_by', 'decided_at', 'decision_note'])
  if (moved.length) ctx.reject(`A change's ${moved.join(', ')} cannot change once it is sent: send a new one that replaces it`)
  // a decision is the person's who makes it; a proposer's own move leaves the decision columns alone
  const deciding = to === 'approved' || to === 'rejected' || (to === 'replaced' && Boolean(row.decided_by))
  if (deciding && !String(row.decided_by ?? '').trim()) ctx.reject('Say who decides', { decided_by: 'Required' })
  // the reasons are the proposer's: a decision, or taking one back, never sends them (a sub-table is in the row only when sent)
  if ((deciding || to === 'sent') && Array.isArray(row.reasons)) ctx.reject("A change's reasons are its proposer's")
  const undoing = to === 'sent'
  const stamp = () => {
    if (undoing) Object.assign(row, { decided_by: null, decided_at: null, decision_note: null })
    else if (deciding) {
      row.decided_at = new Date().toISOString()
      if (to === 'rejected' && !String(row.decision_note ?? '').trim()) ctx.reject('Say why you are sending it back', { decision_note: 'Required' })
    } else Object.assign(row, { decided_by: old?.decided_by ?? null, decided_at: old?.decided_at ?? null, decision_note: old?.decision_note ?? null })
  }
  // an approved change that was never sent (a manager's own) has no decision to take back
  if (undoing && !old?.decided_by) ctx.reject('This change was never decided, so there is nothing to take back')
  if (isAdmin(ctx)) { stamp(); return } // an administrator acts for the person the row names ("viewing as")

  const named = deciding ? row.decided_by : undoing ? old?.decided_by : old?.proposed_by
  const as: Mover = deciding ? 'decider' : undoing ? 'who decided' : 'proposer'
  // the line is the change's own, read from the Run; whoever moves the change must review it today (#1430), so a
  // namesake elsewhere cannot take back or undo someone else's change
  const [line] = await ctx.documents.list!('forecasting.forecast_line_month', { fields: ['store_short_code', 'subcategory_name', 'subcategory_code'],
    filters: [['run_id', '=', old?.run_id], ['store_code', '=', old?.store_code], ['subcategory_name', '=', old?.subcategory_name]], limit_page_length: 1 })
  if (!line) ctx.reject('This change\'s line is not in its Run')
  // any page role, or a Department Manager, may be asked; who may make each move is checked below
  const p = await reviewer(ctx, named, line, as === 'proposer' ? old?.proposed_by_role : DECIDERS, [...PAGE_ROLES, 'Department Manager'])
  if (!movers.includes(as)) ctx.reject(`A change goes from ${from} to ${to} only by ${movers.join(' or ')}`)
  if (as === 'proposer') {
    if (p.name !== old?.proposed_by) ctx.reject('Only the person who proposed a change takes it back')
    // a final change taken back is a manager's own; a Team Leader's approved change is the Store Manager's to undo
    if (from === 'approved' && (old?.proposed_by_role === 'Team Leader' || old?.decided_by)) ctx.reject("An approved change is taken back by the person who approved it")
  } else if (as === 'who decided') {
    if (p.name !== old?.decided_by) ctx.reject(`Only ${String(old?.decided_by)}, who decided this change, takes it back`)
  } else {
    if (!DECIDERS.includes(p.role)) ctx.reject(`The Store Manager decides a sent change; ${p.name} is a ${p.role}`)
    if (old?.proposed_by === p.name) ctx.reject('A change is decided by someone other than the person who sent it')
  }
  stamp()
}

/** One person's answer on a line: theirs alone, inside their own section; a proposed change names its change. */
async function prepareLineReview(ctx: Context) {
  const { row, old } = ctx
  if (!ctx.isNew && String(old?.reviewer) !== String(row.reviewer) && !isAdmin(ctx)) ctx.reject("An answer is the reviewer's own")
  const line = await lineOf(ctx)
  const p = await reviewer(ctx, row.reviewer, line)
  row.reviewer_role = p.role
  // what the answer was given against, so a later Run of the same month can carry it, or ask again (carry.ts)
  row.forecast_month = line.forecast_month
  row.engine_value_before_tax = Math.round(Number(line.forecast_value_before_tax))
  if (row.answer === 'accepted') { row.forecast_change = null; return }
  if (row.answer !== 'change_proposed') ctx.reject('Accepted or change proposed', { answer: 'Required' })
  // The hook API cannot read forecast_change back (a Table with a sub-table, its reasons), so the link is required
  // here and its line and proposer are not re-checked: a crafted request could only mislabel its own answer.
  if (!row.forecast_change) ctx.reject('A proposed change names the change you sent on this line', { forecast_change: 'Required' })
}

/** Why a day went off (#1425): explained by whoever reviews that section, or that subcategory's section, in the Run;
 *  the causes and tags from the agreed set for its direction, below or above the forecast. The section and store come from the Run, whatever the page sent. */
async function prepareDayExplanation(ctx: Context) {
  const { row, old } = ctx
  if (!ctx.isNew && String(old?.explained_by) !== String(row.explained_by) && !isAdmin(ctx)) ctx.reject("An explanation is its writer's own")
  // the Run's line (a subcategory's day) or any line of the store (a section's day); the section is checked against
  // the live org chart (reviews)
  const filters: [string, string, unknown][] = [['run_id', '=', row.run_id], ['store_code', '=', row.store_code],
    ...(row.subcategory_name ? [['subcategory_name', '=', row.subcategory_name] as [string, string, unknown]] : [])]
  const [line] = await ctx.documents.list!('forecasting.forecast_line_month', { fields: ['store_short_code', 'subcategory_name', 'subcategory_code'], filters, limit_page_length: 1 })
  if (!line) ctx.reject(`${String(row.subcategory_name || row.section_name || 'That section')} is not in Run ${String(row.run_id || '')}`)
  if (!String(row.section_name ?? '').trim()) ctx.reject('Say which section', { section_name: 'Required' })
  row.store_name = line.store_short_code
  // #1454: a subcategory's day is placed by its code for who may read it; a section's day by its store alone
  row.subcategory_code = row.subcategory_name ? line.subcategory_code ?? null : null
  const p = await reviewer(ctx, row.explained_by, line)
  row.explained_by_role = p.role
  if (!row.explained_date) ctx.reject('Say which day', { explained_date: 'Required' })
  if (row.direction !== 'below' && row.direction !== 'above') ctx.reject('Say whether the day went below or above the forecast', { direction: 'Required' })
  const problem = causesProblem(row.direction, linesOf(row.causes), linesOf(row.tags))
  if (problem) ctx.reject(problem, { causes: problem })
}

const ANSWERS = ['Forecast Creator', 'Forecast Reviewer']
/** A question on a line: asked by its reviewer; answered (status, who, when) by the Forecast Creator or Reviewer
 *  roles, whose answer is a Comment on it; the asker only marks the answer seen. */
async function prepareQuestion(ctx: Context) {
  const { row, old } = ctx
  if (ctx.isNew) {
    const line = await lineOf(ctx)
    await reviewer(ctx, row.asked_by, line, undefined, PAGE_ROLES)
    if (!String(row.question_text ?? '').trim()) ctx.reject('Write your question', { question_text: 'Required' })
    Object.assign(row, { question_status: 'open', answered_by: null, answered_by_role: null, answered_at: null, answer_seen_at: null, about: row.about || 'line' })
    return
  }
  if (isAdmin(ctx)) return
  if (ctx.roles.some(r => ANSWERS.includes(r))) {
    const moved = unchanged(ctx, ['question_status', 'answered_by', 'answered_by_role', 'answered_at'])
    if (moved.length) ctx.reject(`An answer changes the status and who answered, not ${moved.join(', ')}`)
    return
  }
  await reviewer(ctx, old?.asked_by, await lineOf(ctx), undefined, PAGE_ROLES)
  // the line's code is stamped afresh from the Run (a question asked before 0.14.0 had none)
  const moved = unchanged(ctx, ['answer_seen_at', 'subcategory_code'])
  if (moved.length) ctx.reject('The asker only marks the answer seen')
}

export const platformVersion = '2026-10'
/** Today in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
/** The app's read operations (/api/app_reads/forecasting/<name>). org_chart: one store's org chart today, from the
 *  instance's own Tables (baseTables.read), so a page knows each subcategory's section without reading them.
 *  signed_in: the signed-in person on that org chart. */
export const reads = {
  org_chart: (ctx: { payload: unknown; baseTables: Parameters<typeof orgChart>[0] }) => {
    const store = String((ctx.payload as { store?: unknown } | null)?.store ?? '')
    if (!/^[A-Z0-9]{2,8}$/.test(store)) throw new Error('Name a store by its site code, such as ATK')
    return orgChart(ctx.baseTables, store, todayIST())
  },
  /** Who the signed-in person is on the org chart (#1438): their Employee rows and Chief Executive jobs, so each
   *  manager's page opens for them; an administrator also gets every Chief Executive, to view RB Review as one. */
  signed_in: (ctx: { user: string; roles?: string[]; baseTables?: Context['baseTables'] }) => signedIn(ctx.baseTables, ctx.user, ctx.roles ?? [], todayIST()),
  /** #1454: whether the person has any place on the org chart (the platform narrows every Table by them, scoped.ts). */
  my_places: (ctx: Parameters<typeof myPlaces>[0]) => myPlaces(ctx),
}
export const validators = { 'forecasting.number': prepareNumber, 'forecasting.decision': prepareDecision, 'forecasting.explanation': prepareExplanation,
  'forecasting.forecast_change': prepareChange, 'forecasting.forecast_line_review': prepareLineReview, 'forecasting.forecast_question': prepareQuestion, 'forecasting.day_explanation': prepareDayExplanation }
export const actions = {}
/** After a new load of the forecast copy (#1418's onNewLoad; Siraj, 28-Nov-2026): the people whose answer this load
 *  puts more than 10% from the figure they answered are told, one notice each (notices.ts), as the review decides.
 *  Moves are compared per month, store and subcategory: a new Run has a new run_id, so grouping by Run would make
 *  every subcategory look new. Reads the answers past their privacy (readsAllRows, ruled 28-Nov) and writes nothing:
 *  the review itself asks again (carry.ts). Each store's Store Manager today is told too, from the live org chart
 *  (baseTables, #1428), where the instance has it. */
interface JobContext {
  newLoad: { moves(o: { by: string[]; measure: string; threshold?: number }): Promise<{ group: Record<string, string | null>; before: string | null; after: string | null }[]> } | null
  documents: { list(table: string, args?: { filters?: [string, '=' | 'in', unknown][]; limit?: number }): Promise<Record<string, unknown>[]> }
  baseTables?: Context['baseTables']
  people: { list(): Promise<{ person: string; full_name: string | null }[]>; notify(person: string, message: { subject: string; body: string; email?: boolean; path?: string }): Promise<boolean> }
  setResult(s: string): void
}
export const jobs = {
  async carry_changes(ctx: JobContext) {
    if (!ctx.newLoad) return
    const moves = (await ctx.newLoad.moves({ by: ['forecast_month', 'store_code', 'store_short_code', 'subcategory_name'], measure: 'forecast_value_before_tax', threshold: 0 }))
      .filter(m => m.after != null)
    if (!moves.length) { ctx.setResult('Feather Forecast is unchanged'); return }
    const people = Object.fromEntries((await ctx.people.list()).filter(p => p.full_name).map(p => [p.full_name!, p.person]))
    // each store's Store Managers today (the org chart names them; the store's short code is its Site)
    const managers: Record<string, string[]> = {}
    const base = ctx.baseTables
    if (base && (await (base.available?.('Job Assignment') ?? Promise.resolve(true))) && (await (base.available?.('Employee', ['person']) ?? Promise.resolve(true))))
      for (const [code, short] of new Map(moves.map(m => [String(m.group.store_code), String(m.group.store_short_code)]))) {
        // by their Employee row's Person, never their name (#1438): two managers can share one
        const ids = (await orgChart(base, short, todayIST())).storeManagerIds
        managers[code] = ids.length ? (await base.list('Employee', { fields: ['row_id', 'person'], filters: [['row_id', 'in', ids], ['status', '=', 'Current']], limit_page_length: 500 }))
          .map(e => String(e.person ?? '')).filter(Boolean) : []
      }
    let told = 0
    for (const month of [...new Set(moves.map(m => String(m.group.forecast_month).slice(0, 10)))]) {
      const mine = moves.filter(m => String(m.group.forecast_month).slice(0, 10) === month)
        .map(m => ({ store_code: String(m.group.store_code), subcategory_name: String(m.group.subcategory_name), before: m.before == null ? null : Number(m.before), after: Number(m.after) }))
      const answers = (await ctx.documents.list('forecasting.forecast_line_review', { filters: [['forecast_month', '=', month],
        ['subcategory_name', 'in', [...new Set(mine.map(m => m.subcategory_name))]]], limit: 50000 }))
        .map(r => ({ store_code: String(r.store_code), subcategory_name: String(r.subcategory_name), reviewer: String(r.reviewer),
          forecast_month: r.forecast_month == null ? null : r.forecast_month instanceof Date ? r.forecast_month.toISOString().slice(0, 10) : String(r.forecast_month).slice(0, 10),
          engine_value_before_tax: r.engine_value_before_tax == null || r.engine_value_before_tax === '' ? null : Number(r.engine_value_before_tax) }))
      for (const n of noticesFor(mine, answers, month, people, managers)) if (await ctx.people.notify(n.person, { subject: n.subject, body: n.body, email: false, path: n.path })) told++
    }
    ctx.setResult(`${moves.length} subcategories changed; ${told} people told`)
  },
}
