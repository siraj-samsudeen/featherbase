// #1240: "Report an issue" on a report. The reader says what is wrong; this file turns that and
// where they came from into the ticket Tickets keeps ("Feedback on a report"). The ticket's shape
// (quick picks, fields, limits) is Tickets' own, imported from it, so the two never disagree.
import { PROBLEMS, REPORT_FEEDBACK, REPORT_FEEDBACK_FIELDS } from '../../../../example-apps/tickets/src/report-feedback.ts'

export { PROBLEMS }
export type Problem = typeof PROBLEMS[number]

export const TICKET_KIND = REPORT_FEEDBACK

/** One store the reader reaches: the whole store, or its sections and subcategory codes. */
export interface ReachedStore { store: string; name: string | null; whole: boolean; sections: string[]; subcategories: string[] }

/** What Dash's server says about the reader and the report (the `feedback_context` read). */
export interface FeedbackContext {
  state: 'ok'
  report: { key: string; name: string }
  person: string | null
  jobs: string[]
  reach: ReachedStore[]
}

/** What the page knows that the server doesn't: the view on show and what the Dive reported. */
export interface PageView {
  /** The address of this view, a path on this instance ("/dash/?report=…"). */
  path: string
  store?: string
  month?: 'this' | 'last'
  /** The filters the Dive last reported, as it named them. */
  diveFilters?: Readonly<Record<string, string>>
}

/** Tickets' limits, so a long value is cut here, plainly, rather than refused there. */
const limit = (key: string) => REPORT_FEEDBACK_FIELDS.find(field => field.key === key)!.max
const LIMITS = { about: limit('about'), filters: limit('filters'), reach: limit('reach'), subcategories: limit('subcategories'), job: limit('job'), store: limit('store') }

export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const storeWords = (s: ReachedStore) => s.name ? `${s.name} (${s.store})` : s.store

/** The reader's stores and sections in words: "T Nagar (P101): Sarees, Silk (14 subcategories)". */
export function reachText(reach: readonly ReachedStore[]): string {
  if (!reach.length) return 'No store'
  const parts = reach.map(s => s.whole ? `${storeWords(s)}: whole store`
    : `${storeWords(s)}: ${s.sections.length ? `${s.sections.join(', ')} ` : ''}(${s.subcategories.length} subcategor${s.subcategories.length === 1 ? 'y' : 'ies'})`)
  return cut(parts.length > 12 ? `${parts.length} stores. ${parts.join('; ')}` : parts.join('; '), LIMITS.reach)
}

/** The subcategory codes, store by store, for whoever checks the figures. Whole stores need none. */
export function subcategoryText(reach: readonly ReachedStore[]): string {
  return cut(reach.filter(s => !s.whole && s.subcategories.length).map(s => `${s.store}: ${s.subcategories.join(', ')}`).join('; '), LIMITS.subcategories)
}

/** The Dive's filters in words, keys in order: "month: 2026-11 · store: P101". */
export function filtersText(filters: Readonly<Record<string, string>> | undefined): string {
  if (!filters) return ''
  return cut(Object.keys(filters).sort().map(key => `${key}: ${filters[key]}`).join(' · '), LIMITS.filters)
}

/**
 * The filters a Dive reports about itself, from a message it posts: `{ type: 'dash:dive-filters',
 * filters: {...} }`, or the same `filters` on its ready message. Only plain values are kept, as
 * text; anything else is ignored, never trusted as more than what the reader saw.
 */
export function filtersFromMessage(data: unknown): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null
  const { type, filters } = data as { type?: unknown; filters?: unknown }
  if (type !== 'dash:dive-filters' && type !== 'dash:dive-ready') return null
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters as Record<string, unknown>).slice(0, 30)) {
    if (!/^[\w .-]{1,60}$/.test(key)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = cut(String(value), 200)
    else if (Array.isArray(value) && value.every(v => typeof v === 'string' || typeof v === 'number')) out[key] = cut(value.join(', '), 200)
  }
  return out
}

export interface Answer { problem: Problem; about: string; note: string }

/** The `create` payload Tickets takes: the title everyone may read, the note, and the details only the raiser and support read. */
export function ticketPayload(context: FeedbackContext, view: PageView, answer: Answer, now: Date) {
  const about = cut(answer.about.trim(), LIMITS.about)
  const note = answer.note.trim()
  const store = view.store ? context.reach.find(s => s.store === view.store) : undefined
  const details: Record<string, string> = {
    problem: answer.problem, report: context.report.name, report_key: context.report.key, view: view.path, app: 'Dash',
    reach: reachText(context.reach), seen_at: now.toISOString(),
  }
  if (about) details.about = about
  if (view.store) details.store = cut(store ? storeWords(store) : view.store, LIMITS.store)
  if (view.month) details.month = view.month === 'last' ? 'Last month' : 'This month'
  const filters = filtersText(view.diveFilters)
  if (filters) details.filters = filters
  const codes = subcategoryText(context.reach)
  if (codes) details.subcategories = codes
  if (context.jobs.length) details.job = cut(context.jobs.join('; '), LIMITS.job)
  return {
    // The title is public to everyone who can open Tickets, so it names the report and the pick, never the reader's words.
    title: `${answer.problem}: ${context.report.name}`,
    original: note || (about ? `${answer.problem}: ${about}` : answer.problem),
    kind: TICKET_KIND,
    details,
  }
}

/**
 * The address of the view on show, for the ticket's link back: Dash's own path and query, always
 * naming the report, and the store and month on show when the page knows them. A Dive with its own
 * pickers keeps its store and month to itself, so the address's would be stale: its link names the
 * report alone, and its filters say what was on show.
 */
export function viewPath(location: { pathname: string; search: string }, reportKey: string,
  { pickersInDive = false, store, month }: { pickersInDive?: boolean; store?: string; month?: 'this' | 'last' } = {}): string {
  const path = location.pathname.startsWith('/dash') ? location.pathname : '/dash/'
  const query = new URLSearchParams(pickersInDive ? '' : location.search)
  if (!query.get('report')) query.set('report', reportKey)
  if (!pickersInDive && store) query.set('store', store)
  if (!pickersInDive && month) query.set('month', month)
  return `${path}?${query}`
}

/** One submission, kept for its retries: the same key and payload until the reader changes what they send. */
export interface Submission { key: string; answer: string; said: Answer; payload: ReturnType<typeof ticketPayload> }

/** The submission to send now: the pending one if the reader's answer is unchanged, else a new one. */
export function submissionFor(pending: Submission | null, context: FeedbackContext, view: PageView, answer: Answer, now: Date, newKey: () => string): Submission {
  const said = JSON.stringify([answer.problem, answer.about, answer.note, view])
  return pending && pending.answer === said ? pending : { key: newKey(), answer: said, said: answer, payload: ticketPayload(context, view, answer, now) }
}
