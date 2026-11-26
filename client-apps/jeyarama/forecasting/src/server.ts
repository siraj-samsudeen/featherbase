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

export const platformVersion = '2026-10'
export const validators = { 'forecasting.number': prepareNumber, 'forecasting.decision': prepareDecision, 'forecasting.explanation': prepareExplanation }
export const actions = {}
export const jobs = {}
