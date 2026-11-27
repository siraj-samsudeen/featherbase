// The Team Leader screen on the app's own tables (#1419): reads one section's lines of the newest official Run
// (forecast_line_month and the rows read beside it), and the person's own answers and questions; writes
// forecast_change, forecast_line_review and forecast_question through the server, which checks every row
// (server.ts). The answer to a question is the newest Comment on it.
import { getRow, listWhere, saveRow } from '../api'
import { day, linesFrom, monthOfRun, type LineMonthRow, type OtherModelRow, type PlanRow, type RunRow, type SalesRow, type Line } from '../shared/model'
import type { Answer, Header, Proposal, Question, ReviewActions, ReviewState } from '../shared/review'

export interface Viewer { name: string; role: string; place: string }
export interface Section { run: RunRow; storeCode: string; header: Header; lines: Line[]; state: ReviewState }

const LINE_FIELDS = ['run_id', 'store_code', 'store_name', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name', 'section_name',
  'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'december_step_on_top', 'from_last_year', 'adjustments',
  ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`])]

interface ReviewRow { row_id: string; subcategory_name: string; answer: Answer['status']; forecast_change: string | null }
interface ChangeRow { row_id: string; set_value_before_tax: string | number | null; changed_value_before_tax: string | number | null; explanation: string; reasons?: { reason_code: string }[]; change_status: string }
interface QuestionRow { row_id: string; subcategory_name: string; question_text: string; created_at: string; answered_by_role: string | null; answer_seen_at: string | null }
interface CommentRow { ref_name: string; content: string; created_at: string }

/** A Team Leader's section ("Lakeside · Girls Bottoms") in the newest official Run that has it; null when none does. */
export async function loadSection(viewer: Viewer): Promise<Section | null> {
  const [store, section] = viewer.place.split(' · ')
  if (!section) return null
  const runs = (await listWhere<RunRow>('forecasting.forecast_run', ['run_id', 'purpose', 'origin_date', 'horizon_from', 'horizon_to'], [['purpose', '=', 'official']]))
    .sort((a, b) => b.horizon_from.localeCompare(a.horizon_from))
  if (!runs.length) return null
  const rows = await listWhere<LineMonthRow & { row_id: string }>('forecasting.forecast_line_month', LINE_FIELDS,
    [['store_name', '=', store], ['section_name', '=', section], ['run_id', 'in', runs.map(r => r.run_id)]])
  const run = runs.find(r => rows.some(l => l.run_id === r.run_id))
  if (!run) return null
  const mine = rows.filter(l => l.run_id === run.run_id), storeCode = mine[0].store_code, subs = mine.map(l => l.subcategory_name)
  const near = [['store_code', '=', storeCode], ['subcategory_name', 'in', subs]] as [string, string, unknown][]
  const [sales, plans, others] = await Promise.all([
    listWhere<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], near),
    listWhere<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_value_before_tax', 'plan_qty', 'calendar_year', 'calendar_month'],
      [...near, ['calendar_year', '=', Number(run.horizon_from.slice(0, 4))], ['calendar_month', '=', Number(run.horizon_from.slice(5, 7))]]),
    listWhere<OtherModelRow>('forecasting.other_model_line', ['model', 'store_code', 'subcategory_name', 'forecast_value_before_tax'], [...near, ['month_from', '=', run.horizon_from.slice(0, 10)]]),
  ])
  const lines = linesFrom({ lines: mine, sales, plans, others }, storeCode)
  const header: Header = { store: mine[0].store_name, section, person: viewer.name, role: viewer.role, cutOff: day(run.origin_date), month: monthOfRun(run.horizon_from) }
  return { run, storeCode, header, lines, state: await loadState(run.run_id, storeCode, viewer.name) }
}

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
