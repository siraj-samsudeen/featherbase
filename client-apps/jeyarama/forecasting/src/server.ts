// Featherbase runtime hook API v1. The baseline keeps most rules in the page; the server checks the
// ones that must never be skipped: a number has a reason, weights add up to 100%, and a person enters
// or acts on numbers only inside their own area (areas.ts, on the made-up org chart). The person is
// the one the row names (entered_by, changed_by, decided_by): every made-up person signs in as the
// Administrator here, so tying them to the signed-in person is the platform's side.
import { areaText, covers, personNamed } from './areas'

export interface Context {
  isNew: boolean
  row: Record<string, unknown>
  old?: Record<string, unknown>
  reject(message: string, fields?: Record<string, string>): never
}
type Level = 'Store' | 'Division' | 'Category' | 'Subcategory'

/** The person `who` must have the row's scope in their area. */
function inArea(ctx: Context, who: unknown, store: unknown, level: unknown, name: unknown) {
  const p = personNamed(who)
  if (!p) ctx.reject(`${String(who || 'Nobody')} is not on the org chart, so cannot enter or act on a number`)
  if (!covers(p, { store: String(store), level: String(level) as Level, name: String(name) }))
    ctx.reject(`${p.name} works on ${areaText(p)}; ${level === 'Store' ? String(store) : `${String(store)} · ${String(name)}`} is outside it`)
}

function prepareNumber(ctx: Context) {
  const { row, old } = ctx
  if (row.entered_by_role !== 'Engine' && !String(row.reason ?? '').trim()) ctx.reject('Say why', { reason: 'Required' })
  if (row.kind === 'Change the weights') {
    const weights = JSON.parse(String(row.weights_json || '{}')) as Record<string, number>
    const total = Object.values(weights).reduce((n, w) => n + Number(w || 0), 0)
    if (Math.round(total) !== 100) ctx.reject(`The weights must add up to 100%. They add up to ${total}%.`, { weights_json: 'Must total 100' })
  }
  if ((row.kind === 'Change by a percent' || row.kind === 'Closure or event') && !(Number.isFinite(Number(row.percent)) && row.percent !== null && Number(row.percent) >= -100 && Number(row.percent) <= 500))
    ctx.reject('A percent change keeps its percent, from -100 (a closure) up', { percent: 'Required' })
  if (row.entered_by_role === 'Engine') return
  if (ctx.isNew) return inArea(ctx, row.entered_by, row.store, row.scope_level, row.scope_name)
  // Amounts compare as numbers (a Currency column reads back as "750000.00").
  const differs = (k: string) => (k === 'value' || k === 'percent' ? Number(row[k] ?? 0) !== Number(old?.[k] ?? 0) : String(row[k] ?? '') !== String(old?.[k] ?? ''))
  const acted = ['status', 'value', 'percent', 'waiting_on', 'reason', 'kind'].some(differs)
  if (acted) inArea(ctx, row.changed_by, row.store, row.scope_level, row.scope_name)
  // A number is withdrawn or changed only by the person who entered it, while it waits.
  const edited = ['value', 'percent', 'reason', 'kind'].some(differs)
  if ((row.status === 'Withdrawn' && old?.status !== 'Withdrawn') || edited) {
    if (row.changed_by !== row.entered_by) ctx.reject('Only the person who entered a number withdraws or changes it')
    if (old?.status !== 'Waiting') ctx.reject('A number is withdrawn or changed only while it waits for approval')
  }
  // The Chief Executive's applied number is replaced by the Chief Executive alone.
  if (old?.status === 'Applied' && row.status !== 'Applied' && old.entered_by_role === 'Chief Executive' && personNamed(row.changed_by)?.role !== 'Chief Executive')
    ctx.reject("Only the Chief Executive can replace the Chief Executive's applied number")
}

/** A step in a number's history is taken by someone whose area the number is in; a comment is anyone's. */
function prepareDecision(ctx: Context) {
  const { row } = ctx
  if (!row.number || row.decision === 'Comment' || row.decision === 'This is wrong') return
  if (!row.scope_level) ctx.reject("A step on a number names the number's scope", { scope_level: 'Required' })
  inArea(ctx, row.decided_by, row.store, row.scope_level, row.scope_name)
  if (row.decision === 'Made the applied number' && !String(row.note ?? '').trim()) ctx.reject('Say why this becomes the applied number', { note: 'Required' })
}

export const platformVersion = '2026-10'
export const validators = { 'forecasting.number': prepareNumber, 'forecasting.decision': prepareDecision }
export const actions = {}
export const jobs = {}
