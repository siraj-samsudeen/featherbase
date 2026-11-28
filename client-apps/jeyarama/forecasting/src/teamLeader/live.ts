// The Team Leader screen on the app's own tables (#1419): reads one section's lines of the newest official Run
// (forecast_line_month and the rows read beside it), and the person's own answers and questions; writes
// forecast_change, forecast_line_review and forecast_question through the server, which checks every row
// (server.ts). The answer to a question is the newest Comment on it.
import { getRow, listWhere, saveRow } from '../api'
import { day, linesFrom, monthOfRun, type LineMonthRow, type OtherModelRow, type PlanRow, type RunRow, type SalesRow, type Line } from '../shared/model'
import { ITEM_HEALTH_FIELDS, OTHER_STORE_FIELDS, PEOPLE_FIELDS, needsAttention, type Finding, type ItemHealthRow, type OtherStoreRow, type PeopleRow } from '../shared/findings'
import { ITEM_FIELDS, MIX_FIELDS, STOCK_FIELDS, daysLeft, stockAsOf, type BandMixRow, type StockBandRow, type TopItemRow } from '../shared/bands'
import type { Answer, Header, Proposal, Question, ReviewActions, ReviewState } from '../shared/review'

export interface Viewer { name: string; role: string; place: string }
export interface Section { run: RunRow; storeCode: string; header: Header; lines: Line[]; state: ReviewState }

const LINE_FIELDS = ['run_id', 'store_code', 'store_name', 'material_group_code', 'suggested_section', 'suggested_section_note', 'section_row_ids', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name', 'section_name',
  'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'december_step_on_top', 'from_last_year', 'adjustments', 'rebalanced_within_category', 'price_and_rounding',
  ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`, `weight_b${i}`])]

interface ReviewRow { row_id: string; subcategory_name: string; answer: Answer['status']; forecast_change: string | null }
interface ChangeRow { row_id: string; set_value_before_tax: string | number | null; changed_value_before_tax: string | number | null; explanation: string; reasons?: { reason_code: string }[]; change_status: string }
interface QuestionRow { row_id: string; subcategory_name: string; question_text: string; created_at: string; answered_by_role: string | null; answer_seen_at: string | null }
interface CommentRow { ref_name: string; content: string; created_at: string }

/** The official Runs people review, newest month first. Made-up Runs (a local instance's fixture) are left out
 *  whenever a real one is loaded, so a real store never shares the screen with the made-up one. */
export async function officialRuns(): Promise<(RunRow & { model?: string })[]> {
  const runs = (await listWhere<RunRow & { model?: string }>('forecasting.forecast_run', ['run_id', 'model', 'purpose', 'origin_date', 'horizon_from', 'horizon_to'], [['purpose', '=', 'official']]))
    .sort((a, b) => b.horizon_from.localeCompare(a.horizon_from))
  const real = runs.filter(r => r.model !== 'made_up')
  return real.length ? real : runs
}

/** One section of a store for the landing page: where it is, who reviews it, and how far the review has got. */
export interface SectionSummary { floor: string; floorOrder: number; section: string; teamLeaders: string[]; subcategories: number; reviewed: number; fc: number
  /** Its subcategories' names, for the landing's search. */
  subcategoryNames: string[] }
export interface StoreSummary { run: RunRow; stores: string[]; store: string; month: ReturnType<typeof monthOfRun>; cutOff: string; sections: SectionSummary[]; noSection: { subcategories: number; fc: number } }

/** Every section of a store in the newest official Run (the store named, else the Run's largest), for the landing page. */
export async function loadStore(store?: string | null): Promise<StoreSummary | null> {
  const runs = await officialRuns()
  const run = runs[0]
  if (!run) return null
  const rows = await listWhere<{ store_name: string; section_name: string; floor_name: string | null; floor_order: number | string | null; subcategory_name: string; forecast_value_before_tax: number | string }>(
    'forecasting.forecast_line_month', ['store_name', 'section_name', 'floor_name', 'floor_order', 'subcategory_name', 'forecast_value_before_tax'], [['run_id', 'in', runs.filter(r => r.horizon_from === run.horizon_from).map(r => r.run_id)]])
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.store_name, (count.get(r.store_name) ?? 0) + 1)
  const stores = [...count.keys()].sort()
  const chosen = store && count.has(store) ? store : [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!chosen) return null
  const mine = rows.filter(r => r.store_name === chosen)
  const [reviews, reach] = await Promise.all([
    listWhere<{ subcategory_name: string }>('forecasting.forecast_line_review', ['subcategory_name'], [['run_id', '=', run.run_id]]),
    listWhere<{ full_name: string; place: string }>('forecasting.reach', ['full_name', 'place'], [['role', '=', 'Team Leader'], ['place', 'like', `${chosen} · %`]]),
  ])
  const answered = new Set(reviews.map(r => r.subcategory_name))
  const bySection = new Map<string, SectionSummary>()
  let noSection = { subcategories: 0, fc: 0 }
  for (const r of mine) {
    const fc = Number(r.forecast_value_before_tax)
    if (r.section_name === NO_SECTION) { noSection = { subcategories: noSection.subcategories + 1, fc: noSection.fc + fc }; continue }
    const s = bySection.get(r.section_name) ?? { floor: r.floor_name || 'No floor', floorOrder: Number(r.floor_order ?? 99), section: r.section_name, subcategories: 0, subcategoryNames: [] as string[], reviewed: 0, fc: 0,
      teamLeaders: reach.filter(p => p.place === `${chosen} · ${r.section_name}`).map(p => p.full_name) }
    s.subcategories++; s.subcategoryNames.push(r.subcategory_name); s.fc += fc; if (answered.has(r.subcategory_name)) s.reviewed++
    bySection.set(r.section_name, s)
  }
  const sections = [...bySection.values()].sort((a, b) => a.floorOrder - b.floorOrder || a.floor.localeCompare(b.floor) || b.fc - a.fc)
  return { run, stores, store: chosen, month: monthOfRun(run.horizon_from), cutOff: day(run.origin_date), sections, noSection }
}

/** The section name the copy gives a subcategory that the org chart places in no section. */
export const NO_SECTION = 'Not placed in a section'

/** A Team Leader's section ("Lakeside · Girls Bottoms") in the newest official Run that has it; null when none does. */
export async function loadSection(viewer: Viewer): Promise<Section | null> {
  const [store, section] = viewer.place.split(' · ')
  if (!section) return null
  const runs = await officialRuns()
  if (!runs.length) return null
  const rows = await listWhere<LineMonthRow & { row_id: string }>('forecasting.forecast_line_month', LINE_FIELDS,
    [['store_name', '=', store], ['section_name', '=', section], ['run_id', 'in', runs.map(r => r.run_id)]])
  const run = runs.find(r => rows.some(l => l.run_id === r.run_id))
  if (!run) return null
  const mine = rows.filter(l => l.run_id === run.run_id), storeCode = mine[0].store_code, subs = mine.map(l => l.subcategory_name)
  const near = [['store_code', '=', storeCode], ['subcategory_name', 'in', subs]] as [string, string, unknown][]
  const ofRun = [...near, ['run_id', '=', run.run_id]] as [string, string, unknown][]
  const [sales, plans, others, mix, stock, items] = await Promise.all([
    listWhere<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], near),
    listWhere<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_value_before_tax', 'plan_qty', 'calendar_year', 'calendar_month'],
      [...near, ['calendar_year', '=', Number(run.horizon_from.slice(0, 4))], ['calendar_month', '=', Number(run.horizon_from.slice(5, 7))]]),
    listWhere<OtherModelRow>('forecasting.other_model_line', ['model', 'store_code', 'subcategory_name', 'forecast_value_before_tax'], [...near, ['month_from', '=', run.horizon_from.slice(0, 10)]]),
    // By Price Band: the split over this Run's 28 days, and today's stock
    listWhere<BandMixRow>('forecasting.price_band_mix', MIX_FIELDS, ofRun),
    listWhere<StockBandRow>('forecasting.stock_band', STOCK_FIELDS, near),
    listWhere<TopItemRow>('forecasting.price_band_top_item', ITEM_FIELDS, ofRun),
  ])
  const lines = linesFrom({ lines: mine, sales, plans, others, bands: { mix, stock, items } }, storeCode)
  const header: Header = { store: mine[0].store_name, section, person: viewer.name, role: viewer.role, cutOff: day(run.origin_date), month: monthOfRun(run.horizon_from), stockAsOf: stockAsOf(stock) }
  return { run, storeCode, header, lines, state: await loadState(run.run_id, storeCode, viewer.name) }
}

/** Needs Your Attention for a section: every item's health, who to ask, and the same items at the region's other
 *  stores, read only for this page. None when the Run's copies carry no item health. */
export async function loadFindings(section: Section): Promise<{ findings: Finding[]; othersAsOf: string | null; salesTo: string | null; stockAsOf: string | null } | null> {
  const { storeCode, header, lines } = section
  if (!header.stockAsOf) return null
  // the items' 7/14/28 days end on the store's last complete day (refreshed each morning), not the Run's origin
  const at = [['store_code', '=', storeCode], ['subcategory_name', 'in', lines.map(l => l.name)]] as [string, string, unknown][]
  const [health, people, others] = await Promise.all([
    listWhere<ItemHealthRow & { sales_as_of_date: string | null; stock_as_of: string | null }>('forecasting.item_health', [...ITEM_HEALTH_FIELDS, 'sales_as_of_date', 'stock_as_of'], at),
    listWhere<PeopleRow>('forecasting.merchandise_people', PEOPLE_FIELDS, [['subcategory_name', 'in', lines.map(l => l.name)]]),
    listWhere<OtherStoreRow & { stock_as_of: string | null }>('forecasting.item_other_stores', [...OTHER_STORE_FIELDS, 'stock_as_of'], at),
  ])
  if (!health.length) return null
  const month = { name: header.month.name, days: header.month.days, left: daysLeft(header.stockAsOf, header.month) }
  return { findings: needsAttention(lines, health, people, month, storeCode, others),
    othersAsOf: newest(others.map(r => r.stock_as_of)), salesTo: newest(health.map(r => r.sales_as_of_date)), stockAsOf: newest(health.map(r => r.stock_as_of)) }
}
/** The newest of some dates, YYYY-MM-DD. */
const newest = (dates: (string | null)[]) => dates.reduce<string | null>((a, d) => (d && (!a || d.slice(0, 10) > a) ? d.slice(0, 10) : a), null)

/** The person's answers and questions on this Run at this store. */
export async function loadState(runId: string, storeCode: string, person: string): Promise<ReviewState> {
  const at = [['run_id', '=', runId], ['store_code', '=', storeCode]] as [string, string, unknown][]
  const [reviews, asked] = await Promise.all([
    listWhere<ReviewRow>('forecasting.forecast_line_review', ['subcategory_name', 'answer', 'forecast_change'], [...at, ['reviewer', '=', person]]),
    listWhere<QuestionRow>('forecasting.forecast_question', ['subcategory_name', 'question_text', 'created_at', 'answered_by_role', 'answer_seen_at'], [...at, ['asked_by', '=', person]], 'created_at asc'),
  ])
  const changes = await Promise.all(reviews.filter(r => r.forecast_change).map(r => getRow<ChangeRow>('forecasting.forecast_change', r.forecast_change!)))
  const comments = asked.length ? await listWhere<CommentRow>('Comment', ['ref_name', 'content', 'created_at'],
    [['ref_table', '=', 'forecasting.forecast_question'], ['ref_name', 'in', asked.map(q => q.row_id)]], 'created_at asc') : []
  const answers: Record<string, Answer> = {}
  for (const r of reviews) {
    const c = changes.find(x => x.row_id === r.forecast_change)
    answers[r.subcategory_name] = r.answer === 'accepted' || !c ? { status: 'accepted', value: null, reasons: [], note: '' }
      : { status: 'change_proposed', value: Number(c.changed_value_before_tax), reasons: (c.reasons ?? []).map(x => x.reason_code), note: c.explanation }
  }
  const questions: Question[] = asked.map(q => {
    const last = comments.filter(c => c.ref_name === q.row_id).at(-1)
    return { id: q.row_id, line: q.subcategory_name, text: q.question_text, askedAt: q.created_at,
      answer: last ? { text: plain(last.content), by: `${q.answered_by_role || 'Forecast Creator'} · Head Office` } : null,
      seen: Boolean(last && q.answer_seen_at && Date.parse(q.answer_seen_at) >= Date.parse(last.created_at)) }
  })
  return { answers, questions }
}
/** A Comment's words without its markup. */
const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? html

/** What the screen asks for, saved as the signed-in person (the server checks they are `person`). */
export function liveActions(section: Section, person: string, reload: () => void): ReviewActions {
  // the line's key; the server takes the rest of it (division, subdivision) from the line itself
  const lineKey = (l: Line) => ({ run_id: section.run.run_id, store_code: section.storeCode, category_name: l.category, subcategory_name: l.name })
  const review = async (l: Line) => (await listWhere<ReviewRow & { updated_at: string }>('forecasting.forecast_line_review', ['subcategory_name', 'answer', 'forecast_change'],
    [['run_id', '=', section.run.run_id], ['store_code', '=', section.storeCode], ['subcategory_name', '=', l.name], ['reviewer', '=', person]]))[0]
  /** A sent change this person made on the line goes when a new answer replaces it. */
  const retire = async (old: (ReviewRow & { updated_at: string }) | undefined, to: 'replaced' | 'withdrawn') => {
    if (!old?.forecast_change) return
    const c = await getRow<ChangeRow & { updated_at: string }>('forecasting.forecast_change', old.forecast_change)
    if (c.change_status === 'sent') await saveRow('forecasting.forecast_change', { row_id: c.row_id, updated_at: c.updated_at, change_status: to })
  }
  const answer = async (l: Line, status: Answer['status'], change: string | null) => {
    const old = await review(l)
    await saveRow('forecasting.forecast_line_review', { ...(old ? { row_id: old.row_id, updated_at: old.updated_at } : {}), ...lineKey(l),
      reviewer: person, answer: status, forecast_change: change })
    return old
  }
  return {
    async accept(l) {
      const old = await answer(l, 'accepted', null)
      await retire(old, 'withdrawn')
      reload()
    },
    async propose(l, p: Proposal) {
      const old = await review(l)
      const saved = await saveRow('forecasting.forecast_change', { ...lineKey(l), change_scope: 'month', change_method: 'set_value', set_value_before_tax: p.value,
        explanation: p.note, reasons: p.reasons.map(reason_code => ({ reason_code })), proposed_by: person, change_status: 'sent', replaces_change: old?.forecast_change ?? null })
      const id = String((saved as { row_id?: string; data?: { row_id: string } }).row_id ?? (saved as { data?: { row_id: string } }).data?.row_id)
      await answer(l, 'change_proposed', id)
      await retire(old, 'replaced')
      reload()
    },
    async ask(l, text) {
      await saveRow('forecasting.forecast_question', { ...lineKey(l), question_text: text, asked_by: person, question_status: 'open', about: 'line' })
      reload()
    },
    async seen(name) {
      const q = section.state.questions.filter(x => x.line === name && x.answer && !x.seen)
      if (!q.length) return
      const rows = await listWhere<{ row_id: string; updated_at: string }>('forecasting.forecast_question', [], [['row_id', 'in', q.map(x => x.id)]])
      const now = new Date().toISOString()
      for (const r of rows) await saveRow('forecasting.forecast_question', { row_id: r.row_id, updated_at: r.updated_at, answer_seen_at: now })
      reload()
    },
  }
}
