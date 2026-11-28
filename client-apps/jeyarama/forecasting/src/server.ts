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
// where a Run is loaded, read through the platform's documents. The signed-in person is matched by name
// through the members of forecasting.forecaster (holders of the Forecasting Member role).
import { areaText, covers, personNamed } from './areas'
import { person as madeUpPerson } from './madeUp'
import { causesProblem, linesOf } from './causes'
import { orgChart } from './orgChart'

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
}
type Level = 'Store' | 'Division' | 'Subdivision' | 'Category' | 'Subcategory' | 'Section'
/** Someone on the org chart: their name and job, their manager's name, and what they cover. */
interface Who { name: string; role: string; reportsTo: string | null; area: string }
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
    fields: ['row_id', ...LINE_KEY, 'store_name', 'section_name', 'forecast_value_before_tax', 'forecast_qty'],
    filters: [['run_id', '=', row.run_id], ['store_code', '=', row.store_code], ['subcategory_name', '=', row.subcategory_name]], limit_page_length: 1 })
  if (!line) ctx.reject(`${String(row.subcategory_name || 'That line')} is not in Run ${String(row.run_id || '')}`)
  for (const k of LINE_KEY) row[k] = line[k] // the key is the Run's, whatever the page sent
  return line
}
/** Whether a person reviews this line: a Team Leader their store · section, a Store or Department Manager their store. */
function reviews(p: Who, line: Row) {
  if (p.role === 'Team Leader') return p.area === `${String(line.store_name)} · ${String(line.section_name)}`
  if (p.role === 'Store Manager' || p.role === 'Department Manager') return p.area === String(line.store_name)
  return false
}
async function reviewer(ctx: Context, named: unknown, line: Row): Promise<Who> {
  // An administrator acts for a section's Team Leader by name (the app's "view a section as its Team Leader"),
  // whether or not that person is on the forecasting org chart.
  if (isAdmin(ctx)) return { name: String(named || 'Team Leader'), role: 'Team Leader', reportsTo: null, area: `${String(line.store_name)} · ${String(line.section_name)}` }
  const p = await actor(ctx, await orgOf(ctx), named)
  if (!isAdmin(ctx) && !reviews(p, line)) ctx.reject(`${p.name} reviews ${p.area}; ${String(line.store_name)} · ${String(line.subcategory_name)} is outside it`)
  return p
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
  const { row, old } = ctx
  if (!ctx.isNew) {
    if (isAdmin(ctx)) return
    const p = await actor(ctx, await orgOf(ctx), old?.proposed_by)
    const moved = unchanged(ctx, ['change_status', 'reasons'])
    if (moved.length || p.name !== old?.proposed_by || old?.change_status !== 'sent' || !['replaced', 'withdrawn'].includes(String(row.change_status)))
      ctx.reject('A sent change is not edited: send a new one that replaces it, or withdraw it')
    return
  }
  const line = await lineOf(ctx)
  const p = await reviewer(ctx, row.proposed_by, line)
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
  if (isAdmin(ctx)) return
  // Team Leaders send for approval; a Store Manager's own change is final (data model, settled 27-Nov-2026)
  row.change_status = p.role === 'Team Leader' ? 'sent' : 'approved'
  Object.assign(row, { decided_by: null, decided_at: null, decision_note: null })
}

/** One person's answer on a line: theirs alone, inside their own section; a proposed change names its change. */
async function prepareLineReview(ctx: Context) {
  const { row, old } = ctx
  if (!ctx.isNew && String(old?.reviewer) !== String(row.reviewer) && !isAdmin(ctx)) ctx.reject("An answer is the reviewer's own")
  const line = await lineOf(ctx)
  const p = await reviewer(ctx, row.reviewer, line)
  row.reviewer_role = p.role
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
  const filters: [string, string, unknown][] = [['run_id', '=', row.run_id], ['store_code', '=', row.store_code],
    ...(row.subcategory_name ? [['subcategory_name', '=', row.subcategory_name] as [string, string, unknown]] : [['section_name', '=', row.section_name] as [string, string, unknown]])]
  const [line] = await ctx.documents.list!('forecasting.forecast_line_month', { fields: ['store_name', 'section_name', 'subcategory_name'], filters, limit_page_length: 1 })
  if (!line) ctx.reject(`${String(row.subcategory_name || row.section_name || 'That section')} is not in Run ${String(row.run_id || '')}`)
  row.section_name = line.section_name
  row.store_name = line.store_name
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
    await reviewer(ctx, row.asked_by, line)
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
  await actor(ctx, await orgOf(ctx), old?.asked_by)
  const moved = unchanged(ctx, ['answer_seen_at'])
  if (moved.length) ctx.reject('The asker only marks the answer seen')
}

/** The read-only copy of the warehouse's Run (data model: people never change it; a change is a forecast_change).
 *  Rows come in only by the copy (an administrator's load; the bulk load writes the table directly), and are never
 *  edited, by anyone. #1418 makes the Admin itself hide New, Save and Delete for such a table. */
function copiedFromWarehouse(ctx: Context) {
  if (!ctx.isNew) ctx.reject('This is a copy of the official Run from the warehouse; it is read only. Ask for a change with a forecast change instead.')
  if (!isAdmin(ctx)) ctx.reject('Only the copy of the official Run adds rows here')
}
const COPIES = ['forecast_run', 'forecast_line_month', 'sales_reference', 'annual_plan_line', 'other_model_line', 'price_band_mix', 'stock_band', 'price_band_top_item', 'item_health', 'merchandise_people', 'item_other_stores', 'forecast_line_day', 'actuals_day']

export const platformVersion = '2026-10'
/** Today in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
/** The app's read operations (/api/app_reads/forecasting/<name>). org_chart: one store's org chart today, from the
 *  instance's own Tables (baseTables.read), so a page knows each subcategory's section without reading them. */
export const reads = {
  org_chart: (ctx: { payload: unknown; baseTables: Parameters<typeof orgChart>[0] }) => {
    const store = String((ctx.payload as { store?: unknown } | null)?.store ?? '')
    if (!/^[A-Z0-9]{2,8}$/.test(store)) throw new Error('Name a store by its site code, such as ATK')
    return orgChart(ctx.baseTables, store, todayIST())
  },
}
export const validators = { 'forecasting.number': prepareNumber, 'forecasting.decision': prepareDecision, 'forecasting.explanation': prepareExplanation,
  'forecasting.forecast_change': prepareChange, 'forecasting.forecast_line_review': prepareLineReview, 'forecasting.forecast_question': prepareQuestion, 'forecasting.day_explanation': prepareDayExplanation,
  ...Object.fromEntries(COPIES.map(t => [`forecasting.${t}`, copiedFromWarehouse])) }
export const actions = {}
/** After a new load of the forecast copy (#1418's onNewLoad): carries changes to the new Run and sends back a
 *  subcategory that moved more than 10%. Waits for its design (owner Table, how the Team Leader is told); for now it
 *  records what moved and changes nothing. */
export const jobs = {
  async carry_changes(ctx: { newLoad: { moves(o: { by: string[]; measure: string; threshold?: number }): Promise<unknown[]> } | null; setResult(s: string): void }) {
    if (!ctx.newLoad) return
    const moved = await ctx.newLoad.moves({ by: ['store_code', 'subcategory_code'], measure: 'forecast_value_before_tax', threshold: 10 })
    ctx.setResult(`${moved.length} subcategories moved more than 10%`)
  },
}
