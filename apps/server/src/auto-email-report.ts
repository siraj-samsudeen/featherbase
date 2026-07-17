import { sql } from './db'
import { AppError } from './errors'
import { getDoc } from './document'
import { getList } from './query'
import { runQueryReport } from './query-report'
import { queueEmail } from './email'

// EML-007: Auto Email Report — run a saved Report server-side and email the
// result as an attachment to a list of recipients on a schedule.

interface ReportResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

// Run any saved Report and return uniform columns+rows. Query Reports run their
// admin SQL; Report Builder reports run a permission-scoped list query using the
// saved columns/filters. The caller's permissions are enforced throughout.
export async function runReportRows(reportName: string, user: string): Promise<ReportResult> {
  const report = await getDoc('Report', reportName, user)
  if (report.report_type === 'Query Report') {
    const { columns, rows } = await runQueryReport(reportName, {}, user)
    return { columns, rows: rows as Record<string, unknown>[] }
  }
  // Report Builder (default): apply the saved view config over the DocType.
  const cfg = (report.config as { columns?: string[]; filters?: [string, string, unknown][]; group_by?: string } | null) ?? {}
  const refDoctype = String(report.ref_doctype ?? '')
  if (!refDoctype) throw new AppError('ValidationError', `${reportName} has no ref_doctype`)
  const columns = [...new Set(['name', ...(cfg.columns ?? [])])]
  const { data } = await getList(
    refDoctype,
    { fields: columns, filters: cfg.filters ?? [], limit_page_length: 500 },
    user,
  )
  return { columns, rows: data as Record<string, unknown>[] }
}

// RFC-4180-ish CSV: quote fields containing comma/quote/newline, double inner
// quotes. Nullish → empty; booleans → Yes/No to match the print/report views.
function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(csvCell).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n')
  return body ? `${header}\n${body}` : header
}

export function toHtmlTable(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) =>
    v == null ? '' : String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`)
    .join('')
  return `<table border="1" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function splitRecipients(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Deliver one Auto Email Report now: run the report, render the attachment, and
// queue an email to each recipient. Stamps `last_sent`. Returns what was sent.
export async function deliverAutoEmailReport(
  name: string,
  user = 'Administrator',
): Promise<{ recipients: number; rows: number }> {
  const aer = await getDoc('Auto Email Report', name, user)
  if (!aer.enabled) throw new AppError('ValidationError', `Auto Email Report ${name} is disabled`)

  const reportName = String(aer.report ?? '')
  const recipients = splitRecipients(aer.recipients)
  if (!recipients.length)
    throw new AppError('ValidationError', `Auto Email Report ${name} has no recipients`)

  const { columns, rows } = await runReportRows(reportName, user)
  const format = String(aer.file_format ?? 'CSV').toUpperCase()

  const subject = `Auto Email Report: ${reportName}`
  const body =
    `Attached is the "${reportName}" report (${rows.length} row${rows.length === 1 ? '' : 's'}).` +
    (format === 'HTML' ? `\n\n${toHtmlTable(columns, rows)}` : '')

  const attachments =
    format === 'HTML'
      ? [{ filename: `${reportName}.html`, content_b64: Buffer.from(toHtmlTable(columns, rows)).toString('base64') }]
      : [{ filename: `${reportName}.csv`, content_b64: Buffer.from(toCsv(columns, rows)).toString('base64') }]

  for (const to of recipients) {
    await queueEmail({
      to,
      subject,
      body,
      reference_doctype: 'Report',
      reference_name: reportName,
      attachments,
    })
  }

  await sql`update tab_auto_email_report set last_sent = now(), modified = now() where name = ${name}`
  return { recipients: recipients.length, rows: rows.length }
}

// How long between sends for each cadence, in milliseconds (approximate month).
const CADENCE_MS: Record<string, number> = {
  Daily: 24 * 60 * 60 * 1000,
  Weekly: 7 * 24 * 60 * 60 * 1000,
  Monthly: 28 * 24 * 60 * 60 * 1000,
}

// EML-007 scheduler pass: deliver every enabled Auto Email Report whose cadence
// has elapsed since its last send (or that has never been sent). Returns the
// list of report-config names delivered. Called by the daily scheduled job and
// exposed for a manual "run now" trigger.
export async function runDueAutoEmailReports(now = new Date()): Promise<string[]> {
  const rows = await sql<{ name: string; frequency: string; last_sent: Date | null }[]>`
    select name, frequency, last_sent from tab_auto_email_report where enabled = true`
  const delivered: string[] = []
  for (const r of rows) {
    const gap = CADENCE_MS[r.frequency] ?? CADENCE_MS.Daily
    const due = !r.last_sent || now.getTime() - new Date(r.last_sent).getTime() >= gap
    if (!due) continue
    await deliverAutoEmailReport(r.name)
    delivered.push(r.name)
  }
  return delivered
}
