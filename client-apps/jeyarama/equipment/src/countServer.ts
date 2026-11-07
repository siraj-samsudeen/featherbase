import { MISSING_DECISIONS, UNLISTED_DECISIONS, pickSample, reviewLines, withinPlace } from './countRules'
import type { Context } from './server'
import { istDay } from './inventoryServer'

type Row = Record<string, unknown>
type Documents = Context['documents']

const STAGES = ['Planned', 'Counting', 'In review', 'Closed']

async function all(documents: Documents, table: string, filters: [string, string, unknown][], fields: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields, limit_page_length: 500, limit_start: rows.length } as Parameters<Documents['list']>[1])
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

const counterIds = async (documents: Documents, count: unknown) =>
  (await all(documents, 'equipment.counter', [['count', '=', count]], ['person'])).map(row => String(row.person))

/** The review lines of a count, from its fixed list, records, decisions and where assets are now. */
export async function countReview(documents: Documents, count: unknown) {
  const expected = await all(documents, 'equipment.count_expected', [['count', '=', count]], ['asset', 'expected_place'])
  const scans = await all(documents, 'equipment.scan', [['count', '=', count]], ['row_id', 'asset', 'outcome', 'duplicate'])
  const decisions = await all(documents, 'equipment.count_decision', [['count', '=', count]], ['asset', 'scan', 'decision'])
  const assets = await all(documents, 'equipment.asset', [], ['row_id', 'place'])
  return reviewLines({
    expected: expected.map(row => ({ asset: String(row.asset), expected_place: (row.expected_place as string) ?? null })),
    scans: scans.map(row => ({ row_id: String(row.row_id), asset: (row.asset as string) ?? null, outcome: String(row.outcome), duplicate: Boolean(row.duplicate) })),
    placeNow: new Map(assets.map(row => [String(row.row_id), (row.place as string) ?? null])),
    decisions: decisions.map(row => ({ asset: (row.asset as string) ?? null, scan: (row.scan as string) ?? null, decision: String(row.decision) })),
  })
}

/** A count's stage moves forward only, starts only from Assets, and closes only with every decision. */
export async function prepareCount(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (old?.count_state === 'Closed') ctx.reject('A closed count stays closed')
  const stage = String(row.count_state ?? 'Planned')
  if (ctx.isNew && stage !== 'Planned') ctx.reject('A new count starts as Planned')
  const before = String(old?.count_state ?? 'Planned')
  if (STAGES.indexOf(stage) < STAGES.indexOf(before)) ctx.reject(`A count cannot go back from ${before} to ${stage}`)
  if (row.count_kind === 'Sample' && !(Number(row.sample_size) > 0)) ctx.reject('Choose how many assets the sample counts', { sample_size: 'Choose the sample size' })
  // The reviewer is kept as a person ID; actions cannot follow a link to Person. Only an
  // Assets Manager can see the expected list, so only one can review.
  if (ctx.isNew || row.reviewer !== old?.reviewer) {
    const managers = await ctx.documents.members('equipment.count_expected')
    if (!managers.some(person => person.row_id === row.reviewer)) ctx.reject('The reviewer must be an Assets Manager, who can see the expected list', { reviewer: 'Choose an Assets Manager' })
  }
  if (!ctx.isNew && row.reviewer && (await counterIds(ctx.documents, row.row_id)).includes(String(row.reviewer)))
    ctx.reject('The reviewer can’t also be a counter on this count')
  if (old && (row.snapshot_at ? String(row.snapshot_at) : null) !== (old.snapshot_at ? String(old.snapshot_at) : null) && old.snapshot_at)
    ctx.reject('A started count keeps its expected list')
  if (stage !== 'Planned') {
    const fixed = row.snapshot_at ? await all(ctx.documents, 'equipment.count_expected', [['count', '=', row.row_id]], ['row_id']) : []
    if (!row.snapshot_at || fixed.length !== Number(row.expected_total)) ctx.reject('Start the count from Assets to fix its expected list')
  }
  if (stage === 'Closed' && row.count_kind === 'Fresh inventory') {
    const lines = await all(ctx.documents, 'equipment.asset', [['counted_in', '=', row.row_id]], ['place', 'counted_at'])
    const closes = await all(ctx.documents, 'equipment.area_close', [['count', '=', row.row_id]], ['area', 'close_day'])
    const signed = new Set(closes.map(close => `${String(close.area)}|${(close.close_day instanceof Date ? close.close_day.toISOString() : String(close.close_day)).slice(0, 10)}`))
    if (lines.some(line => !signed.has(`${String(line.place)}|${istDay(line.counted_at)}`))) ctx.reject('Have the site manager close every area and day before closing the count')
    row.closed_at = old?.closed_at ?? ctx.now
  } else if (stage === 'Closed') {
    if (!(await countReview(ctx.documents, row.row_id)).closable) ctx.reject('Decide every missing and unlisted line before closing')
    row.closed_at = old?.closed_at ?? ctx.now
  }
}

/** The expected list is written once, by starting the count, and never changed. */
export async function prepareExpected(ctx: Context): Promise<void> {
  if (!ctx.isNew) ctx.reject('The expected list is fixed when the count starts')
  const count = await ctx.documents.get('equipment.count', String(ctx.row.count))
  if (count.count_state !== 'Planned' || count.snapshot_at) ctx.reject('The expected list is fixed when the count starts')
}

export async function prepareCounter(ctx: Context): Promise<void> {
  const count = await ctx.documents.get('equipment.count', String(ctx.row.count))
  if (count.count_state === 'Closed') ctx.reject('This count is closed')
  if (String(count.reviewer) === String(ctx.row.person)) ctx.reject('The reviewer can’t also be a counter on this count')
}

/** A counter's record: who, when, where and why, with repeats flagged. */
export async function prepareScan(ctx: Context): Promise<void> {
  const { row } = ctx
  if (!ctx.isNew) ctx.reject('A count record is kept as it was made')
  const count = await ctx.documents.get('equipment.count', String(row.count))
  if (count.count_state === 'Planned') ctx.reject('This count is not counting yet')
  if (count.count_state === 'Closed') ctx.reject('This count is closed')
  if (!(await counterIds(ctx.documents, row.count)).includes(ctx.user)) ctx.reject('Only this count’s counters record items')
  const places = await all(ctx.documents, 'equipment.place', [], ['row_id', 'parent_place'])
  if (!withinPlace(String(row.area), String(count.scope_place), places.map(p => ({ row_id: String(p.row_id), parent_place: (p.parent_place as string) ?? null }))))
    ctx.reject('Record items only in the place being counted', { area: 'Choose an area inside the counted place' })

  const typed = String(row.typed_tag ?? '').trim()
  if (row.outcome === 'Not on the list') {
    row.asset = null
    if (!String(row.description ?? '').trim()) ctx.reject('Describe the item that is not on the list', { description: 'Describe the item' })
    if (!String(row.reason ?? '').trim()) ctx.reject('Say why the item is not on the list', { reason: 'Give a reason' })
    row.manual = true
  } else {
    if (typed) {
      if (!String(row.reason ?? '').trim()) ctx.reject('Say why the tag was typed', { reason: 'Say why the tag was typed' })
      const found = await all(ctx.documents, 'equipment.asset', [[typed.startsWith('JRA-') ? 'tag_no' : 'row_id', '=', typed]], ['row_id'])
      if (!found.length) ctx.reject(`No asset has the tag ${typed}; record it as not on the list`)
      row.asset = found[0].row_id
      row.manual = true
    } else {
      row.manual = false
    }
    if (!row.asset) ctx.reject('Scan or type the tag')
  }

  if (count.count_state === 'In review') {
    const recount = await all(ctx.documents, 'equipment.count_decision', [['count', '=', row.count], ['asset', '=', row.asset ?? ''], ['decision', '=', 'Recount']], ['row_id'])
    if (!row.asset || !recount.length) ctx.reject('Only items sent back for recount can be recorded during review')
    row.for_recount = true
  } else {
    row.for_recount = false
  }
  row.duplicate = row.asset
    ? (await all(ctx.documents, 'equipment.scan', [['count', '=', row.count], ['asset', '=', row.asset]], ['duplicate'])).some(scan => !scan.duplicate)
    : false
}

/** Only the count's reviewer, who neither counted nor recorded, decides each line. */
export async function prepareDecision(ctx: Context): Promise<void> {
  const { row } = ctx
  const count = await ctx.documents.get('equipment.count', String(row.count))
  if (String(count.reviewer) !== ctx.user) ctx.reject('Only the count’s reviewer decides its lines')
  if ((await counterIds(ctx.documents, row.count)).includes(ctx.user)) ctx.reject('Someone who counted can’t review the count')
  const recorded = await all(ctx.documents, 'equipment.scan', [['count', '=', row.count]], ['created_by'])
  if (recorded.some(scan => scan.created_by === ctx.user)) ctx.reject('Someone who recorded items can’t review the count')
  if (count.count_state !== 'In review') ctx.reject('Decide lines once the count is in review')
  if (Boolean(row.asset) === Boolean(row.scan)) ctx.reject('A decision is for one missing asset or one item not on the list')
  if (row.asset && !(MISSING_DECISIONS as readonly string[]).includes(String(row.decision))) ctx.reject('Choose a decision that fits a missing item')
  if (row.scan && !(UNLISTED_DECISIONS as readonly string[]).includes(String(row.decision))) ctx.reject('Choose a decision that fits an item not on the list')
  if (ctx.isNew) {
    const key: [string, string, unknown] = row.asset ? ['asset', '=', row.asset] : ['scan', '=', row.scan]
    if ((await all(ctx.documents, 'equipment.count_decision', [['count', '=', row.count], key], ['row_id'])).length)
      ctx.reject('This line already has a decision; change that one instead')
  }
}

interface ActionContext {
  payload: unknown
  documents: Documents & {
    create(table: string, values: Row): Promise<Row>
    update(table: string, values: Row): Promise<Row>
  }
  reject(message: string, fields?: Record<string, string>): never
}

export const countActions = {
  /** Fix the expected list: every asset in the counted place now, or a random sample of them. */
  async start_count(ctx: ActionContext) {
    const request = ctx.payload as { row_id?: unknown; updated_at?: unknown } | null
    if (!request || typeof request.row_id !== 'string' || typeof request.updated_at !== 'string') ctx.reject('Choose a count and its current revision')
    const count = await ctx.documents.get('equipment.count', request.row_id)
    if (count.count_state !== 'Planned') ctx.reject('This count has already started')
    const counters = await counterIds(ctx.documents, count.row_id)
    if (!counters.length) ctx.reject('Add at least one counter before starting')
    if (counters.includes(String(count.reviewer))) ctx.reject('The reviewer can’t also be a counter on this count')
    // A recount's list was fixed when Finance started it; a fresh count starts with nothing expected.
    if (count.snapshot_at) {
      await ctx.documents.update('equipment.count', { row_id: count.row_id, updated_at: request.updated_at, count_state: 'Counting' })
      return { expected: Number(count.expected_total) }
    }
    const places = (await all(ctx.documents, 'equipment.place', [], ['row_id', 'parent_place']))
      .map(p => ({ row_id: String(p.row_id), parent_place: (p.parent_place as string) ?? null }))
    const inScope = (await all(ctx.documents, 'equipment.asset', [], ['row_id', 'place', 'book_status']))
      .filter(asset => asset.book_status !== 'Retired' && withinPlace(String(asset.place), String(count.scope_place), places))
    const expected = count.count_kind === 'Fresh inventory' ? [] : count.count_kind === 'Sample' ? pickSample(inScope, Number(count.sample_size), Math.random) : inScope
    for (const asset of expected)
      await ctx.documents.create('equipment.count_expected', { count: count.row_id, asset: asset.row_id, expected_place: asset.place })
    await ctx.documents.update('equipment.count', {
      row_id: count.row_id, updated_at: request.updated_at, count_state: 'Counting', snapshot_at: new Date().toISOString(), expected_total: expected.length,
    })
    return { expected: expected.length }
  },
}
