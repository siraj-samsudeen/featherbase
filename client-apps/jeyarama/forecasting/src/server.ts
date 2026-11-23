// Featherbase runtime hook API v1. The baseline keeps its rules in the page; the server checks the
// two that must never be skipped: a number has a reason, and weights add up to 100%. Its one read
// fills the shared top bar's Month picker.
import { MONTH_OPTIONS } from './months'

export interface Context {
  isNew: boolean
  row: Record<string, unknown>
  reject(message: string, fields?: Record<string, string>): never
}

function prepareNumber(ctx: Context) {
  const { row } = ctx
  if (row.entered_by_role !== 'Engine' && !String(row.reason ?? '').trim()) ctx.reject('Say why', { reason: 'Required' })
  if (row.kind === 'Change the weights') {
    const weights = JSON.parse(String(row.weights_json || '{}')) as Record<string, number>
    const total = Object.values(weights).reduce((n, w) => n + Number(w || 0), 0)
    if (Math.round(total) !== 100) ctx.reject(`The weights must add up to 100%. They add up to ${total}%.`, { weights_json: 'Must total 100' })
  }
}

export const platformVersion = '2026-10'
export const validators = { 'forecasting.number': prepareNumber }
export const actions = {}
/** The bar's Month picker (featherbase.json `bar`): the current month first, as the bar opens on it. */
export const reads = { months: () => MONTH_OPTIONS }
export const jobs = {}
