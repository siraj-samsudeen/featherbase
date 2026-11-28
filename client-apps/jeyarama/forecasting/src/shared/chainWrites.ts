// The managers' pages on the app's tables (#1442): the Team Leaders' changes they see in Approvals, the decisions the
// Store Manager makes on them, and the viewer's own changes and questions. Every write goes through the server, which
// decides who may move which status (server.ts, CHANGE_MOVES); this file only says what was asked.
import { listWhere, saveRow } from '../api'
import type { Line } from './model'
import type { Answer, ChangeSpec, Proposal, ProposalItem, Question, ReviewState } from './review'

/** A forecast_change row as the pages read it. */
export interface ChangeRow {
  row_id: string; updated_at: string; created_at?: string; run_id: string; store_code: string; subcategory_name: string
  change_scope: string; change_method: string; change_percent: number | string | null; set_value_before_tax: number | string | null
  engine_value_before_tax: number | string | null; changed_value_before_tax: number | string | null; explanation: string
  change_status: string; proposed_by: string; proposed_by_role: string | null
  decided_by: string | null; decision_note: string | null; replaces_change: string | null
}
export const CHANGE_FIELDS = ['created_at', 'run_id', 'store_code', 'subcategory_name', 'change_scope', 'change_method', 'change_percent', 'set_value_before_tax',
  'engine_value_before_tax', 'changed_value_before_tax', 'explanation', 'change_status', 'proposed_by', 'proposed_by_role', 'decided_by', 'decision_note', 'replaces_change']

/** A line's key, as the change tables hold it: Run, store (plant code) and subcategory. */
export const keyOf = (runId: unknown, storeCode: unknown, sub: unknown) => `${String(runId)}\u0000${String(storeCode)}\u0000${String(sub)}`
const lineKey = (l: Line) => ({ run_id: l.runId, store_code: l.storeCode, category_name: l.category, subcategory_name: l.name })
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v))
const idOf = (saved: unknown) => {
  const s = saved as { row_id?: string; updated_at?: string; data?: { row_id: string; updated_at?: string } }
  return { row_id: String(s.row_id ?? s.data?.row_id), updated_at: String(s.updated_at ?? s.data?.updated_at ?? '') }
}

/** Each change's reasons, by change. A viewer who may not read the sub-table sees the cards without reason chips. */
async function reasonsOf(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await listWhere<{ parent: string; reason_code: string }>('forecasting.forecast_change_reason', ['parent', 'reason_code'], [['parent', 'in', ids.slice(i, i + 200)]])
      .catch(() => [] as { parent: string; reason_code: string }[])
    for (const r of rows) out.set(r.parent, [...(out.get(r.parent) ?? []), r.reason_code])
  }
  return out
}

/** The Team Leaders' changes on these Runs' lines, as the managers' Approvals show them: waiting (sent), approved
 *  (as sent, or replaced by the Store Manager's own number), or sent back. Withdrawn changes, and changes a Team
 *  Leader replaced with their next one, are gone. */
export async function loadProposals(runIds: string[], lines: Line[]): Promise<{ proposals: ProposalItem[]; rows: Map<string, ChangeRow> }> {
  const rows = await listWhere<ChangeRow>('forecasting.forecast_change', CHANGE_FIELDS, [['run_id', 'in', runIds], ['change_status', 'in', ['sent', 'approved', 'rejected', 'replaced']]], 'created_at asc')
  const byId = new Map(rows.map(r => [r.row_id, r]))
  const lineAt = new Map(lines.map(l => [keyOf(l.runId, l.storeCode, l.name), l]))
  // the Store Manager's own number that replaced a change, by the change it replaced
  // (only when the one who decided that change made it, on the same line: replaces_change itself is not checked on entry)
  const replacement = new Map(rows.filter(r => {
    const of = r.replaces_change ? byId.get(r.replaces_change) : undefined
    return r.change_status === 'approved' && of && of.decided_by === r.proposed_by && keyOf(of.run_id, of.store_code, of.subcategory_name) === keyOf(r.run_id, r.store_code, r.subcategory_name)
  }).map(r => [r.replaces_change!, r]))
  const sent = rows.filter(r => r.proposed_by_role === 'Team Leader' && (r.change_status !== 'replaced' || r.decided_by))
  const reasons = await reasonsOf(sent.map(r => r.row_id))
  const proposals: ProposalItem[] = []
  for (const r of sent) {
    const l = lineAt.get(keyOf(r.run_id, r.store_code, r.subcategory_name))
    if (!l) continue
    const forecast = num(r.engine_value_before_tax), proposed = num(r.changed_value_before_tax)
    const change: ChangeSpec = r.change_method === 'percent' ? { scope: 'month', method: 'percent', percent: num(r.change_percent) } : { scope: 'month', method: 'set_value', value: proposed }
    const by = replacement.get(r.row_id)
    const state = r.change_status === 'sent' ? 'waiting' : r.change_status === 'rejected' ? 'sent_back' : 'approved'
    proposals.push({ id: r.row_id, line: l.rowId, by: r.proposed_by, role: 'Team Leader', section: l.section, sentOn: String(r.created_at ?? '').slice(0, 10),
      forecast, proposed, reasons: reasons.get(r.row_id) ?? [], note: r.explanation, change, state,
      ...(state === 'approved' ? { final: r.change_status === 'replaced' && by ? num(by.changed_value_before_tax) : proposed } : {}),
      ...(state === 'sent_back' ? { backReason: r.decision_note ?? '' } : {}) })
  }
  return { proposals, rows: byId }
}

interface QuestionRow { row_id: string; run_id: string; store_code: string; subcategory_name: string; question_text: string; created_at: string; answered_by_role: string | null; answer_seen_at: string | null }
interface CommentRow { ref_name: string; content: string; created_at: string }
const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? html

/** The viewer's own changes on these lines (final, as a manager's are) and the questions they asked, with answers. */
export async function loadViewerState(runIds: string[], lines: Line[], person: string): Promise<{ state: ReviewState; own: Map<string, ChangeRow> }> {
  const lineAt = new Map(lines.map(l => [keyOf(l.runId, l.storeCode, l.name), l]))
  const [mine, asked] = await Promise.all([
    listWhere<ChangeRow>('forecasting.forecast_change', CHANGE_FIELDS, [['run_id', 'in', runIds], ['proposed_by', '=', person], ['change_status', '=', 'approved']], 'created_at asc'),
    listWhere<QuestionRow>('forecasting.forecast_question', ['run_id', 'store_code', 'subcategory_name', 'question_text', 'created_at', 'answered_by_role', 'answer_seen_at'],
      [['run_id', 'in', runIds], ['asked_by', '=', person]], 'created_at asc'),
  ])
  const own = new Map<string, ChangeRow>(), answers: Record<string, Answer> = {}
  const reasons = await reasonsOf(mine.map(r => r.row_id))
  // the newest final change on a line is the one that counts
  for (const r of mine) {
    const l = lineAt.get(keyOf(r.run_id, r.store_code, r.subcategory_name))
    if (!l) continue
    own.set(l.rowId, r)
    answers[l.rowId] = { status: 'change_proposed', value: num(r.changed_value_before_tax), reasons: reasons.get(r.row_id) ?? [], note: r.explanation }
  }
  const comments = asked.length ? await listWhere<CommentRow>('Comment', ['ref_name', 'content', 'created_at'],
    [['ref_table', '=', 'forecasting.forecast_question'], ['ref_name', 'in', asked.map(q => q.row_id)]], 'created_at asc').catch(() => [] as CommentRow[]) : []
  const questions: Question[] = asked.flatMap(q => {
    const l = lineAt.get(keyOf(q.run_id, q.store_code, q.subcategory_name))
    if (!l) return []
    const last = comments.filter(c => c.ref_name === q.row_id).at(-1)
    return [{ id: q.row_id, line: l.rowId, text: q.question_text, askedAt: q.created_at,
      answer: last ? { text: plain(last.content), by: `${q.answered_by_role || 'Forecast Creator'} · Head Office` } : null,
      seen: Boolean(last && q.answer_seen_at && Date.parse(q.answer_seen_at) >= Date.parse(last.created_at)) }]
  })
  return { state: { answers, questions }, own }
}

/** The writes behind a manager's page, as the signed-in person (`person`, in `role`); each returns once the server saved it. */
export function chainWrites(person: string, role: string, rows: Map<string, ChangeRow>, own: Map<string, ChangeRow>, lineOf: (rowId: string) => Line | undefined) {
  /** The row's newest version (a save hands it back; the server refuses a stale one). */
  const save = async (r: ChangeRow, patch: Record<string, unknown>) => {
    const saved = idOf(await saveRow('forecasting.forecast_change', { row_id: r.row_id, updated_at: r.updated_at, ...patch }))
    const next = { ...r, ...patch, updated_at: saved.updated_at || r.updated_at } as ChangeRow
    rows.set(r.row_id, next)
    return next
  }
  const row = (p: ProposalItem) => {
    const r = rows.get(p.id)
    if (!r) throw new Error('That change is no longer on this Run; reload the page')
    return r
  }
  /** A final change of the viewer's own on a line (a manager's change, or the Store Manager's number in place of a proposal). */
  const ownChange = async (l: Line, value: number, reasons: string[], note: string, replaces: string | null) => {
    const saved = idOf(await saveRow('forecasting.forecast_change', { ...lineKey(l), change_scope: 'month', change_method: 'set_value', set_value_before_tax: Math.round(value),
      explanation: note, reasons: reasons.map(reason_code => ({ reason_code })), proposed_by: person, proposed_by_role: role, change_status: 'approved', replaces_change: replaces }))
    const r = { row_id: saved.row_id, updated_at: saved.updated_at, run_id: String(l.runId), store_code: String(l.storeCode), subcategory_name: l.name, change_scope: 'month',
      change_method: 'set_value', change_percent: null, set_value_before_tax: value, engine_value_before_tax: l.fc, changed_value_before_tax: value, explanation: note,
      change_status: 'approved', proposed_by: person, proposed_by_role: role, decided_by: null, decision_note: null, replaces_change: replaces } as ChangeRow
    rows.set(r.row_id, r)
    return r
  }
  /** The newest copy of a row this page holds (every save refreshes it; the server refuses a stale one). */
  const fresh = (r: ChangeRow) => rows.get(r.row_id) ?? r
  /** The Store Manager's number that stands in place of a proposal, by the proposal. */
  const replacedBy = new Map<string, ChangeRow>()
  for (const r of rows.values()) if (r.change_status === 'approved' && r.replaces_change && r.proposed_by === person && rows.get(r.replaces_change)?.proposed_by !== person) replacedBy.set(r.replaces_change, r)
  /** Withdraws the viewer's own final change on a line, if any: one approved number per line (#1442). */
  const dropOwn = async (line: string, keep?: ChangeRow) => {
    const before = own.get(line)
    if (!before || before.row_id === keep?.row_id) return
    await save(fresh(before), { change_status: 'withdrawn' })
    own.delete(line)
    for (const [k, v] of replacedBy) if (v.row_id === before.row_id) replacedBy.delete(k)
  }
  return {
    async approve(p: ProposalItem, value?: number) {
      const r = fresh(row(p))
      if (value == null || Math.round(value) === Math.round(p.proposed)) {
        await save(r, { change_status: 'approved', decided_by: person })
        // the proposal is the line's number now; the Store Manager's own earlier one goes, or the step is taken back
        try { await dropOwn(p.line) } catch (e) { await save(fresh(r), { change_status: 'sent' }).catch(() => undefined); throw e }
        return
      }
      // Edit the number: the Store Manager's own number replaces the proposal; if marking the proposal fails, the number goes too
      const l = lineOf(p.line)
      if (!l) throw new Error('That subcategory is not on this page')
      const mine = await ownChange(l, value, p.reasons, `In place of ${p.by}'s proposal: ${p.note}`, r.row_id)
      try { await save(r, { change_status: 'replaced', decided_by: person }) } catch (e) { await save(fresh(mine), { change_status: 'withdrawn' }).catch(() => undefined); throw e }
      await dropOwn(p.line, mine).catch(() => undefined) // an older own number left approved is outranked by this newer one
      replacedBy.set(r.row_id, mine)
      own.set(p.line, mine)
    },
    async sendBack(p: ProposalItem, reason: string) { await save(fresh(row(p)), { change_status: 'rejected', decided_by: person, decision_note: reason }) },
    async undo(p: ProposalItem) {
      const r = fresh(row(p)), mine = replacedBy.get(r.row_id), was = r.change_status
      await save(r, { change_status: 'sent' })
      if (!mine) return
      // the Store Manager's number goes with the decision; if it can't, the decision is put back
      try { await save(fresh(mine), { change_status: 'withdrawn' }) } catch (e) { await save(fresh(r), { change_status: was, decided_by: person }).catch(() => undefined); throw e }
      replacedBy.delete(r.row_id)
      if (own.get(p.line)?.row_id === mine.row_id) own.delete(p.line)
    },
    /** The viewer's own change on a line: final at once; it replaces their earlier one there (and, where that one
     *  stood in place of a proposal, stands in its place now, so Undo still finds it). */
    async propose(l: Line, pr: Proposal) {
      const before = own.get(l.rowId)
      const proposal = before ? [...replacedBy].find(([, v]) => v.row_id === before.row_id)?.[0] : undefined
      const mine = await ownChange(l, pr.value, pr.reasons, pr.note, proposal ?? before?.row_id ?? null)
      if (before) try { await save(fresh(before), { change_status: 'withdrawn' }) } catch (e) { await save(fresh(mine), { change_status: 'withdrawn' }).catch(() => undefined); throw e }
      if (proposal) replacedBy.set(proposal, mine)
      own.set(l.rowId, mine)
    },
    /** Feather Forecast stands on the line: the viewer's own change there goes. */
    async accept(l: Line) { await dropOwn(l.rowId) },
    async ask(l: Line, text: string) {
      const saved = idOf(await saveRow('forecasting.forecast_question', { ...lineKey(l), question_text: text, asked_by: person, question_status: 'open', about: 'line' }))
      return saved.row_id
    },
    async seen(questions: Question[]) {
      if (!questions.length) return
      const now = new Date().toISOString()
      const fresh = await listWhere<{ row_id: string; updated_at: string }>('forecasting.forecast_question', [], [['row_id', 'in', questions.map(q => q.id)]])
      for (const q of fresh) await saveRow('forecasting.forecast_question', { row_id: q.row_id, updated_at: q.updated_at, answer_seen_at: now })
    },
  }
}
export type ChainWrites = ReturnType<typeof chainWrites>
