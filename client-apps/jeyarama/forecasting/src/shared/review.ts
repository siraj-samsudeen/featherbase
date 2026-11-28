// What the Team Leader screen shows besides the Run, and what it asks to be done (#1419). The screen knows only
// these shapes; who keeps them (the story's memory, or the app's tables through the server) is the caller's.
import type { Line } from './model'

/** The Team Leader's answer on one line (TL-30, TL-31): forecast_line_review, and the forecast_change it sent. */
export interface Answer { status: 'accepted' | 'change_proposed'; value: number | null; reasons: string[]; note: string; change?: ChangeSpec }

/** A question asked on a line (TL-33): forecast_question; its answer is a Comment on it. */
export interface Question {
  id: string; line: string; text: string; askedAt: string
  answer: { text: string; by: string } | null
  /** The asker has seen the answer (opened the line, or jumped to it). */
  seen: boolean
}

export interface ReviewState { answers: Record<string, Answer>; questions: Question[]
  /** Answered on an earlier official Run of the month, but Feather Forecast has since moved by more than 10%: asked again. */
  moved?: Record<string, { from: number; to: number }> }

/** What a change does (forecast_change: change_scope, change_method, change_percent / set_value_before_tax,
 *  forecast_date): the whole month set to ₹ or moved by ± %, or some days moved by ± % or each set to ₹. Days
 *  entered together as one range share a `batch` (change_batch) and are approved as one item. */
export type ChangeSpec =
  | { scope: 'month'; method: 'set_value'; value: number }
  | { scope: 'month'; method: 'percent'; percent: number }
  | { scope: 'day'; method: 'percent'; percent: number; days: string[]; batch?: string }
  | { scope: 'day'; method: 'set_value'; value: number; days: string[]; batch?: string }

/** One answer's change: `value` is the month's total after it (what the row and the approver read). The spec says
 *  how it was entered; a ₹ month change made before the modes existed has none. */
export interface Proposal { value: number; reasons: string[]; note: string; change?: ChangeSpec }

/** A change a Team Leader (or anyone below) sent up, as the one who decides it sees it (the Approvals tab). */
export interface ProposalItem {
  id: string
  /** The line's rowId. */
  line: string
  by: string; role: string; section: string
  /** YYYY-MM-DD */
  sentOn: string
  forecast: number; proposed: number
  reasons: string[]; note: string
  change: ChangeSpec
  state: 'waiting' | 'approved' | 'sent_back'
  /** The number approved: the proposal's, or the approver's own (Edit the number). */
  final?: number
  /** Why it was sent back. */
  backReason?: string
}
export interface ProposalActions {
  approve(p: ProposalItem, value?: number): void
  sendBack(p: ProposalItem, reason: string): void
  /** Takes a decision back: the proposal waits again. */
  undo(p: ProposalItem): void
}
export interface ReviewActions {
  accept(line: Line): Promise<void>
  propose(line: Line, proposal: Proposal): Promise<void>
  ask(line: Line, text: string): Promise<void>
  /** The asker opened a line: its answered questions are seen. */
  seen(line: string): Promise<void>
}

/** Who the screen is for and what it covers (TL-4). */
export interface Header { store: string; section: string; person: string; role: string; cutOff: string; month: { name: string; label: string; days: number; year: number }
  /** The day the price bands' stock was counted (YYYY-MM-DD); none when the Run has no bands. */
  stockAsOf?: string | null }

/** TL-30's reasons, in the agreed order, with their change_reason codes; the data model's day-only and month-only
 *  reasons show only for that kind of change. */
export const REASONS: { code: string; label: string; only?: 'month' | 'day' }[] = [
  { code: 'stock_arriving', label: 'Stock arriving' },
  { code: 'stock_short', label: 'Stock out or short' },
  { code: 'range_dropped', label: 'Range dropped' },
  { code: 'display_space', label: 'Display space' },
  { code: 'customers_asking', label: 'Customers asking' },
  { code: 'price_changed', label: 'Price changed' },
  { code: 'last_month_one_off', label: 'Last month was a one-off', only: 'month' },
  { code: 'event_or_festival', label: 'Event or festival', only: 'day' },
  { code: 'may_not_happen', label: 'May not happen', only: 'day' },
  { code: 'store_hours', label: 'Store shut or short hours', only: 'day' },
  { code: 'other', label: 'Other' },
]

/** "just now", "5 min ago", "2 h ago", else the date (DD-Mon-YYYY). */
export function when(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`
}

/** The month's total after a change, on an even day shape (the screens carry the month, not each day's Feather
 *  Forecast): a month set to ₹ is that ₹; ± % moves the month; a day change moves or sets only its days. */
export function monthAfter(fc: number, monthDays: number, c: ChangeSpec): number {
  if (c.scope === 'month') return Math.round(c.method === 'set_value' ? c.value : fc * (1 + c.percent / 100))
  const perDay = fc / monthDays, n = c.days.length
  return Math.round(fc - perDay * n + (c.method === 'set_value' ? c.value * n : perDay * n * (1 + c.percent / 100)))
}

/** The change in words: "Month set to ₹7.50 L", "Month −10%", "3 days (24-Dec-2026 to 26-Dec-2026) +20%". */
export function changeWords(c: ChangeSpec, money: (v: number) => string, date: (iso: string) => string): string {
  const amount = c.method === 'percent' ? `${c.percent > 0 ? '+' : c.percent < 0 ? '−' : ''}${Math.abs(c.percent)}%` : `set to ${money(c.value)}`
  if (c.scope === 'month') return `Month ${amount}`
  const days = c.days.length === 1 ? date(c.days[0]) : `${c.days.length} days (${date(c.days[0])} to ${date(c.days[c.days.length - 1])})`
  return `${days} ${c.method === 'percent' ? amount : `each ${amount}`}`
}

/** The days from one date to another, both included (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
