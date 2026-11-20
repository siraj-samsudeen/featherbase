// The Budgets app's operations: the changes that touch more than one row, or that record who
// did them. The platform runs each one in a single transaction, as the caller, so a table's
// grants and the save rules apply to every row an operation writes: a Budget Viewer's
// operation is refused at its first write.
import { monthsBetween } from './plRules'
import { all, day, type Documents, type Row } from './serverRules'
import { fmtDay, fmtMonth } from './words'

interface ActionContext {
  user: string
  payload: unknown
  documents: Documents & { create(table: string, values: Row): Promise<Row>; update(table: string, values: Row): Promise<Row> }
  reject(message: string, fields?: Record<string, string>): never
}
interface ReadContext {
  payload?: unknown
  reject?(message: string): never
  datasets?: { live(name: string, filters?: unknown): Promise<{ rows: unknown[] }> }
}

const text = (ctx: ActionContext, value: unknown, what: string) => (typeof value === 'string' && value.trim() ? value.trim() : ctx.reject(`Say ${what}`))
const list = <T>(ctx: ActionContext, value: unknown, what: string) => (Array.isArray(value) && value.length ? value as T[] : ctx.reject(`Choose ${what}`))
/** Today in India, where the finance team works. */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

export const actions = {
  /** Budget amounts into a draft version: a store, line and month that is already there is changed, any other is added. */
  async paste_budget(ctx: ActionContext) {
    const payload = ctx.payload as { version?: unknown; values?: unknown }
    const version = text(ctx, payload.version, 'which version')
    const values = list<{ plant: string; pl_line: string; budget_month: string; amount: number }>(ctx, payload.values, 'at least one amount')
    const held = new Map((await all(ctx.documents, 'budgets.pl_budget', [['budget_version', '=', version]], ['row_id', 'updated_at', 'plant', 'pl_line', 'budget_month']))
      .map(row => [`${row.plant}|${row.pl_line}|${day(row.budget_month).slice(0, 7)}`, row]))
    let added = 0, changedRows = 0
    for (const value of values) {
      const existing = held.get(`${value.plant}|${value.pl_line}|${String(value.budget_month).slice(0, 7)}`)
      if (existing) { await ctx.documents.update('budgets.pl_budget', { row_id: existing.row_id, updated_at: existing.updated_at, amount: value.amount }); changedRows++ }
      else { await ctx.documents.create('budgets.pl_budget', { budget_version: version, plant: value.plant, pl_line: value.pl_line, budget_month: value.budget_month, amount: value.amount }); added++ }
    }
    return { added, changed: changedRows }
  },

  /** A new draft for some of a version's months, starting from that version's figures. */
  async revise_version(ctx: ActionContext) {
    const payload = ctx.payload as { version?: unknown; version_name?: unknown; covers_from?: unknown; covers_to?: unknown }
    const from = await ctx.documents.get('budgets.budget_version', text(ctx, payload.version, 'which version'))
    const months = monthsBetween(text(ctx, payload.covers_from, 'the first month'), text(ctx, payload.covers_to, 'the last month'))
    if (!months.length || months[0] < day(from.covers_from) || months[months.length - 1].slice(0, 7) > day(from.covers_to).slice(0, 7))
      ctx.reject(`A revision covers months inside the version it revises (${fmtMonth(day(from.covers_from))} to ${fmtMonth(day(from.covers_to))})`)
    const made = await ctx.documents.create('budgets.budget_version', {
      version_name: text(ctx, payload.version_name, 'what to call the revision'), budget_kind: from.budget_kind, fiscal_year: from.fiscal_year, operating_region: from.operating_region ?? null,
      covers_from: months[0], covers_to: months[months.length - 1], version_state: 'Draft', based_on: from.row_id,
    })
    const table = from.budget_kind === 'Sales' ? 'budgets.sales_budget' : 'budgets.pl_budget'
    const columns = from.budget_kind === 'Sales' ? ['plant', 'budget_month', 'subcategory', 'budget_quantity', 'budget_value'] : ['plant', 'budget_month', 'pl_line', 'amount']
    let copied = 0
    for (const row of await all(ctx.documents, table, [['budget_version', '=', from.row_id]], columns)) {
      if (!months.includes(`${day(row.budget_month).slice(0, 7)}-01`)) continue
      await ctx.documents.create(table, { ...Object.fromEntries(columns.map(column => [column, column === 'budget_month' ? day(row[column]) : row[column]])), budget_version: made.row_id })
      copied++
    }
    return { version: made.row_id, copied }
  },

  async approve_version(ctx: ActionContext) {
    const version = await ctx.documents.get('budgets.budget_version', text(ctx, (ctx.payload as { version?: unknown }).version, 'which version'))
    if (version.version_state !== 'Draft') ctx.reject(`${version.version_name} is already ${String(version.version_state).toLowerCase()}`)
    await ctx.documents.update('budgets.budget_version', { row_id: version.row_id, updated_at: version.updated_at, version_state: 'Approved', approved_on: today(), approved_by: ctx.user })
    return { version: version.row_id }
  },

  /** Manual lines into an open close. The save rule gives each its account's P&L line. */
  async paste_adjustments(ctx: ActionContext) {
    const payload = ctx.payload as { close?: unknown; values?: unknown }
    const close = text(ctx, payload.close, 'which close')
    const values = list<Row>(ctx, payload.values, 'at least one line')
    for (const value of values)
      await ctx.documents.create('budgets.close_adjustment', { month_close: close, plant: value.plant, gl_account: value.gl_account, amount: value.amount, adjustment_type: value.adjustment_type, reason: value.reason, owner: value.owner ?? ctx.user })
    return { added: values.length }
  },

  /** An SAP posting settles some or all of an adjustment. */
  async match_adjustment(ctx: ActionContext) {
    const payload = ctx.payload as { adjustment?: unknown; document?: unknown; amount?: unknown }
    const line = await ctx.documents.get('budgets.close_adjustment', text(ctx, payload.adjustment, 'which adjustment'))
    const document = text(ctx, payload.document, 'the SAP document')
    if (typeof payload.amount !== 'number' || !Number.isFinite(payload.amount) || payload.amount === 0) ctx.reject('Say the amount the document settles')
    if (Number(line.remaining_amount) === 0) ctx.reject('Nothing remains to match on this adjustment')
    await ctx.documents.update('budgets.close_adjustment', { row_id: line.row_id, updated_at: line.updated_at,
      matched_sap_document: line.matched_sap_document ? `${line.matched_sap_document}, ${document}` : document,
      matched_amount: Math.round((Number(line.matched_amount ?? 0) + (payload.amount as number)) * 100) / 100 })
    return { adjustment: line.row_id }
  },

  async set_adjustments(ctx: ActionContext) {
    const payload = ctx.payload as { adjustments?: unknown; change?: Row }
    const ids = list<string>(ctx, payload.adjustments, 'at least one adjustment')
    const change = payload.change ?? {}
    if (!Object.keys(change).length || Object.keys(change).some(column => !['adjustment_state', 'owner', 'adjustment_type'].includes(column))) ctx.reject('Together, adjustments change their state, owner or type')
    for (const id of ids) {
      const line = await ctx.documents.get('budgets.close_adjustment', id)
      await ctx.documents.update('budgets.close_adjustment', { row_id: line.row_id, updated_at: line.updated_at, ...change })
    }
    return { changed: ids.length }
  },

  async publish_close(ctx: ActionContext) {
    const close = await ctx.documents.get('budgets.month_close', text(ctx, (ctx.payload as { close?: unknown }).close, 'which close'))
    if (close.close_state !== 'Open') ctx.reject(`This close is already ${String(close.close_state).toLowerCase()}`)
    await ctx.documents.update('budgets.month_close', { row_id: close.row_id, updated_at: close.updated_at, close_state: 'Published', published_on: today(), published_by: ctx.user })
    return { close: close.row_id }
  },

  /** The next version of a month, from its latest one, which it replaces. Adjustments stay with the version that first carried them. */
  async new_close_version(ctx: ActionContext) {
    const payload = ctx.payload as { close?: unknown; downloaded_at?: unknown }
    const close = await ctx.documents.get('budgets.month_close', text(ctx, payload.close, 'which close'))
    const versions = await all(ctx.documents, 'budgets.month_close', [['legal_company', '=', close.legal_company], ['close_month', '=', day(close.close_month)]], ['row_id', 'version_no'])
    const latest = Math.max(...versions.map(v => Number(v.version_no)))
    if (Number(close.version_no) !== latest) ctx.reject(`Make a new version from the latest one, version ${latest}`)
    if (close.close_state === 'Open') ctx.reject('Publish this version before making the next one')
    await ctx.documents.update('budgets.month_close', { row_id: close.row_id, updated_at: close.updated_at, close_state: 'Replaced' })
    const made = await ctx.documents.create('budgets.month_close', { legal_company: close.legal_company, close_month: day(close.close_month), version_no: latest + 1,
      downloaded_at: text(ctx, payload.downloaded_at, 'when the trial balance was downloaded'), close_state: 'Open' })
    return { close: made.row_id }
  },

  async set_accounts(ctx: ActionContext) {
    const payload = ctx.payload as { accounts?: unknown; change?: Row }
    const ids = list<string>(ctx, payload.accounts, 'at least one account')
    const change = payload.change ?? {}
    if (!Object.keys(change).length || Object.keys(change).some(column => !['pl_line', 'store_rule', 'falls_back_to_cost_centre'].includes(column))) ctx.reject('Together, accounts change their P&L line or store rule')
    for (const id of ids) {
      const account = await ctx.documents.get('budgets.gl_account', id)
      await ctx.documents.update('budgets.gl_account', { row_id: account.row_id, updated_at: account.updated_at, ...change })
    }
    return { changed: ids.length }
  },

  /** A store's area from a date; the area before it ends the day before. */
  async add_store_area(ctx: ActionContext) {
    const payload = ctx.payload as { plant?: unknown; starts_on?: unknown; area_sqft?: unknown; note?: unknown }
    const plant = text(ctx, payload.plant, 'which store')
    const starts = text(ctx, payload.starts_on, 'the day it starts')
    const open = (await all(ctx.documents, 'budgets.store_area', [['plant', '=', plant]], ['row_id', 'updated_at', 'starts_on', 'ends_on', 'business_line_segment']))
      .filter(row => !row.ends_on && !row.business_line_segment)
    for (const before of open) {
      if (day(before.starts_on) >= starts) ctx.reject(`This store already has an area from ${fmtDay(day(before.starts_on))}: a new one starts after it`)
      const end = new Date(Date.parse(`${starts}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      await ctx.documents.update('budgets.store_area', { row_id: before.row_id, updated_at: before.updated_at, ends_on: end })
    }
    const made = await ctx.documents.create('budgets.store_area', { plant, starts_on: starts, area_sqft: payload.area_sqft, note: payload.note ?? null })
    return { area: made.row_id }
  },
}

const NOT_SET_UP = 'NotSetUpError'

export const reads = {
  /**
   * The actual P&L for some months, from the warehouse: one row per company, month, close
   * version, plant and working line, as posted and as published. Featherbase keeps no copy.
   * With no warehouse connected it answers `connected: false`, and the pages show budgets alone.
   */
  async actuals(ctx: ReadContext) {
    const months = (ctx.payload as { months?: unknown })?.months
    if (!Array.isArray(months) || !months.length || months.some(month => typeof month !== 'string' || !/^\d{4}-\d{2}-01$/.test(month))) ctx.reject!('Say which months')
    try {
      const answer = await ctx.datasets!.live('board_pl', { close_month: months })
      // The platform hands an integer back as text; a close's version is a number here.
      return { connected: true, rows: (answer.rows as Record<string, unknown>[]).map(row => ({ ...row, close_version: Number(row.close_version) })) }
    } catch (error) {
      if ((error as { type?: string }).type === NOT_SET_UP) return { connected: false, rows: [] }
      throw error
    }
  },
}
