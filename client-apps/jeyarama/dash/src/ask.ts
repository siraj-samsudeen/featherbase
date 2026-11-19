// What the Ask box shows: an answer from one of the app's semantic models
// (this month against target, or this month beside the months before it),
// drawn the way the report draws its figures. No React here, so it is tested
// as plain functions.
import { ApiError } from './api'
import { dataLine, inr, percent, signedInr } from './page'

export interface AskColumn { name: string; kind: 'dimension' | 'measure' | 'metric'; unit?: 'percent'; definition?: string }
export interface AskResult {
  columns: AskColumn[]
  rows: (string | number | boolean | null)[][]
  truncated: boolean
  places: string[]
  at: string | null
  asOf?: string | null
  unmatched?: { dimension: string; value: string }[]
}
/** What a question got: figures (null while they are being prepared), or a question asked back. The platform keeps the question, so a follow-up carries on from it. */
export interface Asked { question: string; model?: string; /** The SQL that answered it, when SQL did. */ sql?: string; plan?: unknown; result?: AskResult | null; clarify?: string }
export const MAX_QUESTION_LENGTH = 500

/** Questions to start from: verified questions of the app's models (ask.test.ts keeps the two in step). */
export const SUGGESTIONS = [
  'How is my store doing against target this month?',
  'Which subcategories are furthest behind target?',
  'Which sections are furthest behind target?',
  'Which subcategories have sold the most?',
  'How do my sales compare with last month?',
]

const LABELS: Record<string, string> = {
  store: 'Store', subcategory: 'Subcategory', section: 'Section', department: 'Department', target: 'Target', sales: 'Sales', gap: 'Gap', achieved: 'Achieved',
  target_quantity: 'Target quantity', sales_quantity: 'Sales quantity',
  month: 'Month', sales_last_month: 'Sales last month', target_last_month: 'Target last month', sales_change: 'Change', sales_growth: 'Growth',
  achieved_last_month: 'Achieved last month', month_sales: 'Sales', month_target: 'Target', month_achieved: 'Achieved',
}
const PLURALS: Record<string, string> = { store: 'stores', subcategory: 'subcategories', section: 'sections', department: 'departments', month: 'months' }
const RUPEES = new Set(['target', 'sales', 'sales_last_month', 'target_last_month', 'month_sales', 'month_target'])
/** Differences: shown with their sign, a negative one marked. */
const SIGNED = new Set(['gap', 'sales_change'])

/** A column's heading: the report's own word for it, or its name in plain words. */
export function columnLabel(name: string): string {
  const words = name.replace(/_/g, ' ')
  return LABELS[name] ?? words.charAt(0).toUpperCase() + words.slice(1)
}

/** One figure as the report writes it: rupees with paise, a signed gap, a percentage, "—" for nothing. */
export function cell(column: AskColumn, value: string | number | boolean | null): { text: string; numeric: boolean; negative: boolean } {
  // A row with no section (a subcategory no section owns) says so: a bare dash reads as a mistake.
  if (column.kind === 'dimension') return { text: value !== null ? String(value) : column.name in PLURALS ? `No ${columnLabel(column.name).toLowerCase()}` : '—', numeric: false, negative: false }
  const figure = typeof value === 'number' ? value : null
  if (figure === null) return { text: '—', numeric: true, negative: false }
  if (column.unit === 'percent') return { text: percent(figure), numeric: true, negative: false }
  if (SIGNED.has(column.name)) return { text: signedInr(figure), numeric: true, negative: figure < 0 }
  if (RUPEES.has(column.name)) return { text: inr(figure), numeric: true, negative: false }
  return { text: figure.toLocaleString('en-IN', { maximumFractionDigits: 3 }), numeric: true, negative: false }
}

/** How recent the figures are, in the report's own wording. */
export function answerDataLine({ asOf, at }: Pick<AskResult, 'asOf' | 'at'>): string {
  return dataLine({ data_through: asOf ?? null, refreshed_at: at })
}

/** Whose figures the answer counted. A long list is counted, not recited. */
export function coversLine(places: readonly string[]): string {
  return places.length <= 3 ? `Covers: ${places.join('; ')}` : `Covers your ${places.length} stores and sections`
}

/** A name in the question that matched nothing the asker may see. */
export function unmatchedLine({ dimension, value }: { dimension: string; value: string }): string {
  return `“${value}” is not one of your ${PLURALS[dimension] ?? `${columnLabel(dimension).toLowerCase()} names`}, so nothing matched it.`
}

/** How each figure was worked out, one line per figure. */
export function definitionLines(columns: readonly AskColumn[]): string[] {
  return columns.filter(column => column.definition).map(column => `${columnLabel(column.name)}: ${column.definition}`)
}

/** What to say when a question was refused. The platform's own words are kept where it wrote them for the asker. */
export function askFailure(error: unknown): string {
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 401) return 'Sign in again to ask a question.'
  if (status === 403) return "You don't have access to ask about any store yet."
  if (status === 429) return 'Too many questions just now. Try again in a minute.'
  if (status === 409 || status === 417 || status === 503) return (error as ApiError).message
  return "That question couldn't be answered. Try again."
}
