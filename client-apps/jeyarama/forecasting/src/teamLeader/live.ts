// The Team Leader screen on the app's tables (#1419): reads one section's lines of the newest official Run from the
// read-only copies of the warehouse feeds (forecast_line_month and the copies read beside it), which section each
// subcategory is in from the live org chart (the org_chart read), and the person's own answers and questions; writes
// forecast_change, forecast_line_review and forecast_question through the server, which checks every row
// (server.ts). The answer to a question is the newest Comment on it.
import { getRow, listWhere, readOp, saveRow } from '../api'
import { day, linesFrom, monthOfRun, type LineMonthRow, type OtherModelRow, type PlanRow, type RunRow, type SalesRow, type Line } from '../shared/model'
import { ITEM_HEALTH_FIELDS, needsAttention, type Finding, type ItemHealthRow } from '../shared/findings'
import { ITEM_FIELDS, MIX_FIELDS, STOCK_FIELDS, daysLeft, stockAsOf, type BandMixRow, type StockBandRow, type TopItemRow } from '../shared/bands'
import type { OrgChart } from '../orgChart'
import { carryAnswers } from '../shared/carry'
import type { Answer, Header, Proposal, Question, ReviewActions, ReviewState } from '../shared/review'

export interface Viewer { name: string; role: string; place: string }
/** A section of one store in one Run. storeCode is the store's plant code, as the copies key it; header.store its
 *  site code, as the org chart and people's places name it. */
export interface Section { run: RunRow; storeCode: string; header: Header; lines: Line[]; state: ReviewState; org: OrgChart }

const LINE_FIELDS = ['run_id', 'store_code', 'store_short_code', 'subcategory_code', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name',
  'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'seasonal_step_on_top', 'from_last_year', 'adjustments', 'rebalanced_within_category', 'price_and_rounding',
  ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`, `weight_b${i}`])]

interface ReviewRow { row_id: string; run_id: string; subcategory_name: string; answer: Answer['status']; forecast_change: string | null; forecast_month: string | null; engine_value_before_tax: number | string | null; updated_at: string }
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

/** One store's org chart today, from the server (the client never reads the org Tables); asked once per store. */
const orgs = new Map<string, Promise<OrgChart>>()
export function orgOf(store: string): Promise<OrgChart> {
  if (!orgs.has(store)) orgs.set(store, readOp<OrgChart>('org_chart', { store }).catch(error => { orgs.delete(store); throw error }))
  return orgs.get(store)!
}
/** A subcategory's section today, by its code: the Section's row id, or null when the org chart places it nowhere. */
const sectionOf = (org: OrgChart, code: string | null) => (code ? org.subcategories[code]?.section ?? null : null)

/** One section of a store for the landing page: where it is, who reviews it, and how far the review has got. */
export interface SectionSummary { floor: string; floorOrder: number; section: string; teamLeaders: string[]; subcategories: number; reviewed: number; fc: number }
export interface StoreSummary { run: RunRow; stores: string[]; store: string; month: ReturnType<typeof monthOfRun>; cutOff: string; sections: SectionSummary[]; noSection: { subcategories: number; fc: number } }

/** Every section of a store in the newest official Run (the store named, else the Run's largest), for the landing page. */
export async function loadStore(store?: string | null): Promise<StoreSummary | null> {
  const runs = await officialRuns()
  const run = runs[0]
  if (!run) return null
  const rows = await listWhere<{ store_short_code: string; subcategory_code: string; subcategory_name: string; forecast_value_before_tax: number | string }>(
    'forecasting.forecast_line_month', ['store_short_code', 'subcategory_code', 'subcategory_name', 'forecast_value_before_tax'], [['run_id', 'in', runs.filter(r => r.horizon_from === run.horizon_from).map(r => r.run_id)]])
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.store_short_code, (count.get(r.store_short_code) ?? 0) + 1)
  const stores = [...count.keys()].sort()
  const chosen = store && count.has(store) ? store : [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!chosen) return null
  const mine = rows.filter(r => r.store_short_code === chosen)
  const [org, reviews] = await Promise.all([
    orgOf(chosen),
    listWhere<{ subcategory_name: string }>('forecasting.forecast_line_review', ['subcategory_name'], [['run_id', '=', run.run_id]]),
  ])
  const answered = new Set(reviews.map(r => r.subcategory_name))
  const bySection = new Map<string, SectionSummary>()
  let noSection = { subcategories: 0, fc: 0 }
  for (const r of mine) {
    const fc = Number(r.forecast_value_before_tax), at = org.sections.find(s => s.id === sectionOf(org, r.subcategory_code))
    if (!at) { noSection = { subcategories: noSection.subcategories + 1, fc: noSection.fc + fc }; continue }
    const s = bySection.get(at.id) ?? { floor: at.floor, floorOrder: at.floorOrder, section: at.name, subcategories: 0, reviewed: 0, fc: 0, teamLeaders: at.teamLeaders }
    s.subcategories++; s.fc += fc; if (answered.has(r.subcategory_name)) s.reviewed++
    bySection.set(at.id, s)
  }
  const sections = [...bySection.values()].sort((a, b) => a.floorOrder - b.floorOrder || a.floor.localeCompare(b.floor) || b.fc - a.fc)
  return { run, stores, store: chosen, month: monthOfRun(run.horizon_from), cutOff: day(run.origin_date), sections, noSection }
}

/** The place name of a store's subcategories that the org chart puts in no section. */
export const NO_SECTION = 'Not placed in a section'

/** A Team Leader's section ("Lakeside · Girls Bottoms"), or a store's subcategories in no section, in the newest
 *  official Run that has it; null when none does. */
export async function loadSection(viewer: Viewer): Promise<Section | null> {
  const [store, section] = viewer.place.split(' · ')
  if (!section) return null
  const runs = await officialRuns()
  if (!runs.length) return null
  const org = await orgOf(store)
  const at = org.sections.find(s => s.name === section)
  const rows = await listWhere<LineMonthRow & { row_id: string }>('forecasting.forecast_line_month', LINE_FIELDS,
    [['store_short_code', '=', store], ['run_id', 'in', runs.map(r => r.run_id)]])
  const inSection = (code: string | null) => (section === NO_SECTION ? !org.sections.some(s => s.id === sectionOf(org, code)) : !!at && sectionOf(org, code) === at.id)
  const run = runs.find(r => rows.some(l => l.run_id === r.run_id && inSection(l.subcategory_code)))
  if (!run) return null
  const mine = rows.filter(l => l.run_id === run.run_id && inSection(l.subcategory_code)), storeCode = mine[0].store_code, names = mine.map(l => l.subcategory_name)
  // the line feeds name their lines as the Run does; today's stock is keyed by each item's own code
  const near = [['store_code', '=', storeCode], ['subcategory_name', 'in', names]] as [string, string, unknown][]
  const ofRun = [...near, ['run_id', '=', run.run_id]] as [string, string, unknown][]
  const coded = [['store_code', '=', storeCode], ['subcategory_code', 'in', mine.flatMap(l => (l.subcategory_code ? [l.subcategory_code] : []))]] as [string, string, unknown][]
  const [sales, plans, others, mix, stock, items] = await Promise.all([
    listWhere<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], ofRun),
    listWhere<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_month', 'plan_value_before_tax', 'plan_qty'], [...ofRun, ['plan_month', '=', run.horizon_from.slice(0, 10)]]),
    listWhere<OtherModelRow>('forecasting.other_model_day', ['model', 'store_code', 'subcategory_name', 'forecast_value_before_tax'], [...near, ['official_run_id', '=', run.run_id]]),
    // By Price Band: the split over this Run's 28 days, and today's stock
    listWhere<BandMixRow>('forecasting.price_band_mix', MIX_FIELDS, ofRun),
    listWhere<StockBandRow>('forecasting.stock_band', STOCK_FIELDS, coded),
    listWhere<TopItemRow>('forecasting.price_band_top_item', ITEM_FIELDS, ofRun),
  ])
  const lines = linesFrom({ lines: mine, sales, plans, others, bands: { mix, stock, items } }, storeCode)
  const header: Header = { store, section, person: viewer.name, role: viewer.role, cutOff: day(run.origin_date), month: monthOfRun(run.horizon_from), stockAsOf: stockAsOf(stock) }
  return { run, storeCode, header, lines, org, state: await loadState(run, storeCode, viewer.name, lines) }
}

/** Needs Your Attention for a section: every item's health here and at the region's other stores (each store's own
 *  rows of the same feed), and who to ask (the org chart), read only for this page. None when no item health is
 *  loaded. */
export async function loadFindings(section: Section): Promise<{ findings: Finding[]; othersAsOf: string | null; salesTo: string | null; stockAsOf: string | null } | null> {
  const { storeCode, header, lines, org } = section
  if (!header.stockAsOf) return null
  // the items' 7/14/28 days end on the store's last complete day (refreshed each morning), not the Run's origin
  const health = await listWhere<ItemHealthRow & { sales_as_of_date: string | null; stock_as_of: string | null }>('forecasting.item_health', [...ITEM_HEALTH_FIELDS, 'sales_as_of_date', 'stock_as_of'],
    [['store_short_code', 'in', Object.keys(org.stores).length ? Object.keys(org.stores) : [header.store]], ['subcategory_code', 'in', lines.flatMap(l => (l.code ? [l.code] : []))]])
  const here = health.filter(r => r.store_code === storeCode), others = health.filter(r => r.store_code !== storeCode)
  if (!here.length) return null
  const month = { name: header.month.name, days: header.month.days, left: daysLeft(header.stockAsOf, header.month) }
  return { findings: needsAttention(lines, health, org, month, storeCode),
    othersAsOf: newest(others.map(r => r.stock_as_of)), salesTo: newest(here.map(r => r.sales_as_of_date)), stockAsOf: newest(here.map(r => r.stock_as_of)) }
}
/** The newest of some dates, YYYY-MM-DD. */
const newest = (dates: (string | null)[]) => dates.reduce<string | null>((a, d) => (d && (!a || d.slice(0, 10) > a) ? d.slice(0, 10) : a), null)

/** The person's answers and questions on this Run at this store. An answer given on an earlier official Run of the
 *  same month is carried while Feather Forecast moved 10% or less, else asked for again (carry.ts). */
export async function loadState(run: RunRow, storeCode: string, person: string, lines: Line[]): Promise<ReviewState> {
  const runId = run.run_id, month = run.horizon_from.slice(0, 10)
  const at = [['run_id', '=', runId], ['store_code', '=', storeCode]] as [string, string, unknown][]
  const [stored, asked] = await Promise.all([
    listWhere<ReviewRow>('forecasting.forecast_line_review', ['run_id', 'subcategory_name', 'answer', 'forecast_change', 'forecast_month', 'engine_value_before_tax'],
      [['store_code', '=', storeCode], ['reviewer', '=', person], ['forecast_month', '=', month]]),
    listWhere<QuestionRow>('forecasting.forecast_question', ['subcategory_name', 'question_text', 'created_at', 'answered_by_role', 'answer_seen_at'], [...at, ['asked_by', '=', person]], 'created_at asc'),
  ])
  // this Run's own answers, and earlier Runs' answers carried while Feather Forecast stayed within 10%
  const { answers: kept, moved } = carryAnswers(stored.map(r => ({ run: r.run_id, month: r.forecast_month, subcategory: r.subcategory_name,
    engine: r.engine_value_before_tax == null || r.engine_value_before_tax === '' ? null : Number(r.engine_value_before_tax), updatedAt: r.updated_at, answer: r })),
    runId, month, Object.fromEntries(lines.map(l => [l.name, l.fc])))
  const reviews = Object.values(kept)
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
  return { answers, questions, moved }
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
