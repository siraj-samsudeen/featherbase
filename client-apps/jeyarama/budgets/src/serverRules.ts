// What the Budgets server keeps true on every save, whoever saves and by whichever road
// (the app, the Admin, an import): the platform runs these before a row is written.
import { remaining } from './plRules'
import { fmtDay, fmtMonth } from './words'

export type Row = Record<string, unknown>
type Filter = [string, string, unknown]
export interface Documents {
  get(table: string, id: string): Promise<Row>
  list(table: string, query: { filters?: Filter[]; fields?: string[]; limit_page_length?: number; limit_start?: number; order_by?: string }): Promise<Row[]>
}
interface Context {
  row: Row
  old?: Row
  isNew: boolean
  user: string
  now: string
  documents: Documents
  reject(message: string, fields?: Record<string, string>): never
}

export async function all(documents: Documents, table: string, filters: Filter[], fields: string[], order_by?: string): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields, limit_page_length: 500, limit_start: rows.length, ...(order_by ? { order_by } : {}) })
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

/** A Date column as its calendar day, whether it arrives as text or as the database's value. */
export const day = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? '')).slice(0, 10)
const monthStart = (value: unknown) => `${day(value).slice(0, 7)}-01`
/** Whether two values of a column are the same thing, however each arrived: a day as text or as the database's date, an amount as a number or as text. */
export function sameValue(a: unknown, b: unknown): boolean {
  const plain = (v: unknown) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : v)
  const [x, y] = [plain(a), plain(b)]
  if (x === null || y === null) return x === y
  if (typeof x === 'boolean' || typeof y === 'boolean') return Boolean(x) === Boolean(y)
  const [n, m] = [Number(x), Number(y)]
  if (!Number.isNaN(n) && !Number.isNaN(m)) return n === m
  const [s, t] = [String(x), String(y)]
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && /^\d{4}-\d{2}-\d{2}/.test(t)) return Date.parse(s) === Date.parse(t)
  return s === t
}
const changed = (ctx: Context, column: string) => !ctx.isNew && !sameValue(ctx.row[column], ctx.old?.[column])

async function prepareLine(ctx: Context) {
  const { row } = ctx
  if (row.level === 'Working') {
    if (!row.rolls_into) ctx.reject('A working line rolls into a published line: choose it', { rolls_into: 'Choose a published line' })
    const parent = await ctx.documents.get('budgets.pl_line', String(row.rolls_into))
    if (parent.level !== 'Published') ctx.reject(`${parent.line_name} is a working line: roll into a published line`)
  } else if (row.rolls_into) ctx.reject('A published line rolls into nothing')
  if (row.line_kind === 'Subtotal' && !row.subtotal_rule) ctx.reject('Say how this subtotal adds: Running Total or Section Total', { subtotal_rule: 'Choose one' })
  if (row.line_kind !== 'Subtotal') row.subtotal_rule = null
}

async function prepareAccount(ctx: Context) {
  if (!ctx.row.pl_line) return
  const line = await ctx.documents.get('budgets.pl_line', String(ctx.row.pl_line))
  if (line.level !== 'Working') ctx.reject(`${line.line_name} is a published line: classify an account to one of its working lines`)
}

const FIXED_ONCE_APPROVED = ['version_name', 'budget_kind', 'fiscal_year', 'operating_region', 'based_on', 'covers_from', 'covers_to', 'approved_by', 'approved_at']

async function prepareVersion(ctx: Context) {
  const { row, old } = ctx
  row.covers_from = monthStart(row.covers_from)
  row.covers_to = monthStart(row.covers_to)
  if (day(row.covers_from) > day(row.covers_to)) ctx.reject('Covers From is after Covers To')
  if (ctx.isNew || changed(ctx, 'version_name')) {
    const same = await ctx.documents.list('budgets.budget_version', { filters: [['version_name', '=', row.version_name], ['budget_kind', '=', row.budget_kind]], fields: ['row_id'], limit_page_length: 2 })
    if (same.some(other => other.row_id !== row.row_id)) ctx.reject(`There is already a ${row.budget_kind} version called ${row.version_name}: give this one another name`)
  }
  // A revision reads its unchanged figures from its base, so the base must be one that can no longer change.
  if (row.based_on && (ctx.isNew || changed(ctx, 'based_on') || changed(ctx, 'budget_kind'))) {
    if (row.based_on === row.row_id) ctx.reject('A version is not based on itself')
    const base = await ctx.documents.get('budgets.budget_version', String(row.based_on))
    if (base.version_state === 'Draft' && (ctx.isNew || changed(ctx, 'based_on'))) ctx.reject(`${base.version_name} is a draft: a version is based on an approved one`)
    if (base.budget_kind !== row.budget_kind) ctx.reject(`${base.version_name} is a ${base.budget_kind} version: a ${row.budget_kind} version is based on a ${row.budget_kind} one`)
  }
  if (!ctx.isNew && old?.version_state === 'Withdrawn') {
    // Other versions may read their figures through this one, so it is never opened again.
    if (row.version_state !== 'Withdrawn') ctx.reject(`${old.version_name} is withdrawn: it stays as it was; make a new version`)
    if (FIXED_ONCE_APPROVED.some(column => changed(ctx, column))) ctx.reject(`${old.version_name} is withdrawn: only its note can change`)
    return
  }
  // Who approved and when is the server's word: a save cannot name someone else or another time.
  if (row.version_state === 'Approved' && (ctx.isNew || old?.version_state !== 'Approved')) {
    row.approved_by = ctx.user
    row.approved_at = ctx.now
  } else if (!ctx.isNew && old?.version_state === 'Approved') {
    // Withdrawing is the one change of state allowed; nothing else moves with it.
    if ((row.version_state !== 'Withdrawn' && changed(ctx, 'version_state')) || FIXED_ONCE_APPROVED.some(column => changed(ctx, column))) ctx.reject(`${old.version_name} is approved: only its note can change, or withdraw it`)
  } else if (row.version_state !== 'Approved' && old?.version_state !== 'Approved') {
    row.approved_by = null
    row.approved_at = null
  }
}

/** A figure or an adjustment is not moved to another parent: that would take it out of an approved budget or a published close. */
function stays(ctx: Context, column: string, message: string) {
  if (!ctx.isNew && changed(ctx, column)) ctx.reject(message)
}

/**
 * What holds for every budget figure, P&L or sales: it goes on a draft version of its own
 * kind, in a month that version covers, once for its store, month and `what` (a P&L line or
 * a subcategory), and it stays in the version it was entered in.
 */
async function prepareFigure(ctx: Context, kind: 'P&L' | 'Sales', table: string, what: string, said: string) {
  const { row } = ctx
  stays(ctx, 'budget_version', 'A figure stays in the version it was entered in')
  const version = await ctx.documents.get('budgets.budget_version', String(row.budget_version))
  if (version.version_state !== 'Draft') ctx.reject(`${version.version_name} is ${String(version.version_state).toLowerCase()}: revise it to change a figure`)
  if (version.budget_kind !== kind) ctx.reject(`${version.version_name} is a ${version.budget_kind} version: a ${kind === 'P&L' ? 'P&L' : 'sales'} amount goes on a ${kind} version`)
  row.budget_month = monthStart(row.budget_month)
  const month = String(row.budget_month)
  if (month < monthStart(version.covers_from) || month > monthStart(version.covers_to)) ctx.reject(`${fmtMonth(month)} is outside the months ${version.version_name} covers`)
  const same = await ctx.documents.list(table, { filters: [['budget_version', '=', row.budget_version], ['plant', '=', row.plant], [what, '=', row[what]], ['budget_month', '=', month]], fields: ['row_id'], limit_page_length: 2 })
  if (same.some(other => other.row_id !== row.row_id)) ctx.reject(`${version.version_name} already has ${said} for ${row.plant} in ${fmtMonth(month)}: change that amount`)
}

async function prepareBudget(ctx: Context) {
  const line = await ctx.documents.get('budgets.pl_line', String(ctx.row.pl_line))
  if (line.level !== 'Published') ctx.reject(`${line.line_name} is a working line: a budget is held on published lines`)
  if (line.line_kind === 'Subtotal') ctx.reject(`${line.line_name} is a subtotal: it is worked out, not budgeted`)
  await prepareFigure(ctx, 'P&L', 'budgets.pl_budget', 'pl_line', String(line.line_name))
}

const prepareSalesBudget = (ctx: Context) => prepareFigure(ctx, 'Sales', 'budgets.sales_budget', 'subcategory', String(ctx.row.subcategory))

const closeName = (close: Row) => `${fmtMonth(day(close.close_month))} version ${close.version_no}`

async function prepareClose(ctx: Context) {
  const { row } = ctx
  row.close_month = monthStart(row.close_month)
  if (ctx.isNew || changed(ctx, 'close_month') || changed(ctx, 'version_no') || changed(ctx, 'legal_company')) {
    const same = await ctx.documents.list('budgets.monthly_close', { filters: [['legal_company', '=', row.legal_company], ['close_month', '=', row.close_month], ['version_no', '=', row.version_no]], fields: ['row_id'], limit_page_length: 2 })
    if (same.some(other => other.row_id !== row.row_id)) ctx.reject(`${fmtMonth(String(row.close_month))} already has version ${row.version_no} for this company: make a new version from it`)
  }
  const was = ctx.old?.close_state
  if (ctx.isNew || was === 'Open') {
    if (row.close_state === 'Replaced') ctx.reject('Only a published close is replaced, by its next version')
    // Who published and when is the server's word.
    if (row.close_state === 'Published') { row.published_by = ctx.user; row.published_at = ctx.now }
    else { row.published_by = null; row.published_at = null }
    return
  }
  const name = closeName(ctx.old!)
  if (row.close_state === 'Open') ctx.reject(`${name} is ${String(was).toLowerCase()}: it cannot be opened again; make a new version`)
  if (was === 'Replaced' && row.close_state !== 'Replaced') ctx.reject(`${name} was replaced by a later version`)
  const fixed = ['legal_company', 'close_month', 'version_no', 'downloaded_at', 'published_by', 'published_at']
  if (fixed.some(column => changed(ctx, column))) ctx.reject(`${name} is ${String(was).toLowerCase()}: only its note can change`)
}

/** The columns matching to SAP and following up change; they stay open after a close is published. */
const AFTER_PUBLISHING = ['adjustment_state', 'matched_sap_document', 'matched_amount', 'remaining_amount', 'owner', 'ticket', 'withdrawn_in']

async function prepareAdjustment(ctx: Context) {
  const { row, old } = ctx
  stays(ctx, 'monthly_close', 'An adjustment stays with the close that first carried it')
  const close = await ctx.documents.get('budgets.monthly_close', String(row.monthly_close))
  if (close.close_state !== 'Open') {
    const kept = ['row_id', 'updated_at', 'updated_by', 'created_at', 'created_by', ...AFTER_PUBLISHING]
    if (ctx.isNew || Object.keys(row).some(column => !kept.includes(column) && !sameValue(row[column], old?.[column])))
      ctx.reject(`${closeName(close)} is ${String(close.close_state).toLowerCase()}: make a new version to add or change its adjustments`)
  }
  if (ctx.isNew ? row.withdrawn_in : changed(ctx, 'withdrawn_in')) {
    // Undoing a withdrawal a published version already shows would change that publication.
    if (old?.withdrawn_in) {
      const was = await ctx.documents.get('budgets.monthly_close', String(old.withdrawn_in))
      if (was.close_state !== 'Open') ctx.reject(`${closeName(was)} is ${String(was.close_state).toLowerCase()}: this adjustment's withdrawal stays as published`)
    }
    if (row.withdrawn_in) {
      const target = await ctx.documents.get('budgets.monthly_close', String(row.withdrawn_in))
      const later = target.legal_company === close.legal_company && day(target.close_month) === day(close.close_month) && Number(target.version_no) > Number(close.version_no)
      if (!later) ctx.reject(`An adjustment is withdrawn in a later version of its month, not in ${closeName(target)}`)
      if (target.close_state !== 'Open') ctx.reject(`${closeName(target)} is ${String(target.close_state).toLowerCase()}: withdraw an adjustment in a version that is still open`)
    }
  }
  const account = await ctx.documents.get('budgets.gl_account', String(row.gl_account))
  if (!account.pl_line) ctx.reject(`${account.account_name} has no P&L line yet: classify it first`)
  if (!row.pl_line) row.pl_line = account.pl_line
  const [amount, matched] = [Number(row.amount), row.matched_amount == null ? 0 : Number(row.matched_amount)]
  // However it is saved, a match settles no more than the adjustment, and in its direction.
  if (matched !== 0 && (Math.sign(matched) !== Math.sign(amount) || Math.abs(matched) > Math.abs(amount)))
    ctx.reject(`A match settles no more than the adjustment: ${amount < 0 ? '-' : ''}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  const left = remaining(Number(row.amount), row.matched_amount == null ? null : Number(row.matched_amount))
  row.remaining_amount = left.remaining
  // Settled once SAP has posted all of it, whether it was still open or carried into a later month. A released line stays released.
  if (left.settled && row.matched_sap_document && ['Open', 'Carried Forward'].includes(String(row.adjustment_state))) row.adjustment_state = 'Posted In SAP'
}

async function prepareArea(ctx: Context) {
  const { row } = ctx
  if (row.ends_on && day(row.ends_on) < day(row.starts_on)) ctx.reject(`This area ends before it starts (${fmtDay(day(row.starts_on))})`)
  if (!(Number(row.area_sqft) > 0)) ctx.reject('An area is more than nothing', { area_sqft: 'Say the area in sq ft' })
  // One area at a time for a store (or for one of its segments), whichever road the save takes.
  const [from, to] = [day(row.starts_on), row.ends_on ? day(row.ends_on) : '9999-12-31']
  const others = await all(ctx.documents, 'budgets.store_area', [['plant', '=', row.plant]], ['row_id', 'starts_on', 'ends_on', 'business_line_segment'])
  const clash = others.find(other => other.row_id !== row.row_id && (other.business_line_segment ?? null) === (row.business_line_segment ?? null)
    && day(other.starts_on) <= to && (other.ends_on ? day(other.ends_on) : '9999-12-31') >= from)
  if (clash) ctx.reject(`This store already has an area from ${fmtDay(day(clash.starts_on))}${clash.ends_on ? ` to ${fmtDay(day(clash.ends_on))}` : ' with no end'}: end it first, or use Add An Area`)
}

export const validators = {
  'budgets.pl_line': prepareLine,
  'budgets.gl_account': prepareAccount,
  'budgets.budget_version': prepareVersion,
  'budgets.pl_budget': prepareBudget,
  'budgets.sales_budget': prepareSalesBudget,
  'budgets.monthly_close': prepareClose,
  'budgets.monthly_close_adjustment': prepareAdjustment,
  'budgets.store_area': prepareArea,
}
