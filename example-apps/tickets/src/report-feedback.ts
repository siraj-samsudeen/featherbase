// #1240: "Feedback on a report", the built-in kind an app raises from one of its reports (Dash's
// "Report an issue"). The app fills in where the person came from; the person only says what is
// wrong. Shared by the server (which checks it) and the ticket page (which shows it).

export const REPORT_FEEDBACK = 'report_feedback'

/** What's wrong: the quick picks a report offers, in the order it offers them. */
export const PROBLEMS = ['Data looks wrong', 'Stock missing', 'Item ran out', 'Target too high or too low', 'Something else'] as const

/** Each detail the ticket keeps, its label on the ticket page, whether it is required, and its longest length. */
export const REPORT_FEEDBACK_FIELDS: readonly { key: string; label: string; required?: true; max: number }[] = [
  { key: 'problem', label: "What's wrong", required: true, max: 60 },
  { key: 'about', label: 'Which item, store or number', max: 200 },
  { key: 'report', label: 'Report', required: true, max: 200 },
  { key: 'report_key', label: 'Report key', required: true, max: 100 },
  { key: 'view', label: 'Link to the view', required: true, max: 2000 },
  { key: 'app', label: 'Raised from', max: 60 },
  { key: 'store', label: 'Store on show', max: 200 },
  { key: 'month', label: 'Month on show', max: 60 },
  { key: 'filters', label: 'Filters the report showed', max: 2000 },
  { key: 'reach', label: 'Their stores and sections', max: 4000 },
  { key: 'subcategories', label: 'Their subcategory codes', max: 8000 },
  { key: 'job', label: 'Their job', max: 500 },
  { key: 'seen_at', label: 'Seen at', max: 40 },
]

/**
 * A link back to the view, as a path on this instance ("/dash/?report=…"): never another site, a
 * protocol-relative address or a script, so the ticket page can draw it as a link.
 */
export function isLocalPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value)
}

/** The details as kept: every value a trimmed string, every key known, the required ones present. */
export function reportFeedbackDetails(value: unknown, reject: (message: string) => never): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('Expected an object')
  const row = value as Record<string, unknown>
  const known = new Map(REPORT_FEEDBACK_FIELDS.map(field => [field.key, field]))
  const unknown = Object.keys(row).find(key => !known.has(key))
  if (unknown) reject(`Feedback on a report has no field ${unknown}`)
  const out: Record<string, string> = {}
  for (const field of REPORT_FEEDBACK_FIELDS) {
    const raw = row[field.key]
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) reject(`${field.label} is required`)
      continue
    }
    if (typeof raw !== 'string') return reject(`${field.label} must be text`)
    const text = raw.trim()
    if (!text) { if (field.required) reject(`${field.label} is required`); continue }
    if (text.length > field.max) reject(`${field.label} is longer than ${field.max} characters`)
    out[field.key] = text
  }
  if (!(PROBLEMS as readonly string[]).includes(out.problem)) reject(`What's wrong must be one of: ${PROBLEMS.join(', ')}`)
  if (!/^[A-Za-z0-9_.-]+$/.test(out.report_key)) reject('Report key must be a key, not a name')
  if (!isLocalPath(out.view)) reject('Link to the view must be a path on this instance')
  if (out.seen_at !== undefined && !(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(out.seen_at) && Number.isFinite(Date.parse(out.seen_at))))
    reject('Seen at must be a time (ISO, UTC)')
  return out
}
