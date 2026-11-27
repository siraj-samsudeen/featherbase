// What the Team Leader screen shows besides the Run, and what it asks to be done (#1419). The screen knows only
// these shapes; who keeps them (the story's memory, or the app's tables through the server) is the caller's.
import type { Line } from './model'

/** The Team Leader's answer on one line (TL-30, TL-31): forecast_line_review, and the forecast_change it sent. */
export interface Answer { status: 'accepted' | 'change_proposed'; value: number | null; reasons: string[]; note: string }

/** A question asked on a line (TL-33): forecast_question; its answer is a Comment on it. */
export interface Question {
  id: string; line: string; text: string; askedAt: string
  answer: { text: string; by: string } | null
  /** The asker has seen the answer (opened the line, or jumped to it). */
  seen: boolean
}

export interface ReviewState { answers: Record<string, Answer>; questions: Question[] }

export interface Proposal { value: number; reasons: string[]; note: string }
export interface ReviewActions {
  accept(line: Line): Promise<void>
  propose(line: Line, proposal: Proposal): Promise<void>
  ask(line: Line, text: string): Promise<void>
  /** The asker opened a line: its answered questions are seen. */
  seen(line: string): Promise<void>
}

/** Who the screen is for and what it covers (TL-4). */
export interface Header { store: string; section: string; person: string; role: string; cutOff: string; month: { name: string; label: string; days: number; year: number } }

/** TL-30's reasons, in the agreed order, with their change_reason codes. */
export const REASONS: { code: string; label: string }[] = [
  { code: 'stock_arriving', label: 'Stock arriving' },
  { code: 'stock_short', label: 'Stock out or short' },
  { code: 'range_dropped', label: 'Range dropped' },
  { code: 'display_space', label: 'Display space' },
  { code: 'customers_asking', label: 'Customers asking' },
  { code: 'price_changed', label: 'Price changed' },
  { code: 'last_month_one_off', label: 'Last month was a one-off' },
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
