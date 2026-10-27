import { ROW_KEY } from './meta'
import { sql } from './db'
import { AppError } from './errors'
import { getDoc } from './document'
import { getList } from './query'
import { queueEmail } from './email'

// EML-007: Auto Email Report — run a saved Report server-side and email the
// result as an attachment to a list of recipients on a schedule.

interface ReportResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

// Run a saved Report Builder report and return uniform columns+rows: a
// permission-scoped list query using the saved columns/filters, so the
// caller's permissions are enforced throughout. `allRows` pages through
// every row the caller may see (#338: an emailed report is never cut off);
// otherwise the first page of 500, ordered as the list orders them.
const PAGE = 500

export async function runReportRows(
  reportName: string,
  user: string,
  { allRows = false }: { allRows?: boolean } = {},
): Promise<ReportResult> {
  const report = await getDoc('Report', reportName, user)
  const cfg = (report.config as { columns?: string[]; filters?: [string, string, unknown][]; group_by?: string } | null) ?? {}
  const refTable = String(report.ref_table ?? '')
  if (!refTable) throw new AppError('ValidationError', `${reportName} has no ref_table`)
  const columns = [...new Set([ROW_KEY, ...(cfg.columns ?? [])])]
  const args = { fields: columns, filters: cfg.filters ?? [], limit_page_length: PAGE }
  if (!allRows) {
    const { data } = await getList(refTable, args, user)
    return { columns, rows: data as Record<string, unknown>[] }
  }
  // Paged by Row ID, each page after the last one seen: a unique key, so no
  // row is skipped or repeated, even if rows are added or removed meanwhile.
  const rows: Record<string, unknown>[] = []
  for (;;) {
    const after: [string, string, unknown][] = rows.length ? [[ROW_KEY, '>', rows[rows.length - 1][ROW_KEY]]] : []
    const { data } = await getList(refTable, { ...args, filters: [...args.filters, ...after], order_by: `${ROW_KEY} asc` }, user)
    rows.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE) return { columns, rows }
  }
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

function toHtmlTable(columns: string[], rows: Record<string, unknown>[]): string {
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
// `user` is whoever asks for the send and must be able to open the schedule;
// the report itself always runs as the person who set the schedule up
// (#338), so recipients see that person's rows and columns, whoever sends.
export async function deliverAutoEmailReport(
  name: string,
  user = 'Administrator',
): Promise<{ recipients: number; rows: number }> {
  const aer = await getDoc('Auto Email Report', name, user)
  if (!aer.enabled) throw new AppError('ValidationError', `Auto Email Report ${name} is disabled`)
  const owner = await scheduleOwner(name, String(aer.created_by ?? ''))

  const reportName = String(aer.report ?? '')
  const recipients = splitRecipients(aer.recipients)
  if (!recipients.length)
    throw new AppError('ValidationError', `Auto Email Report ${name} has no recipients`)

  const { columns, rows } = await runReportRows(reportName, owner, { allRows: true })
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
      ref_table: 'Report',
      reference_name: reportName,
      attachments,
    })
  }

  await sql`update auto_email_report set last_sent = now(), updated_at = now() where row_id = ${name}`
  return { recipients: recipients.length, rows: rows.length }
}

// #338: the schedule's owner, who must still be someone who can sign in —
// a schedule left behind by a disabled or removed person sends nothing.
async function scheduleOwner(name: string, createdBy: string): Promise<string> {
  const [owner] = await sql`
    select enabled from person where row_id = ${createdBy}
    union all select enabled from service_account where row_id = ${createdBy}`
  if (!owner?.enabled)
    throw new AppError(
      'ValidationError',
      `Auto Email Report ${name} was set up by someone who can no longer sign in; it was not sent`,
    )
  return createdBy
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
  const rows = await sql<{ row_id: string; frequency: string; last_sent: Date | null }[]>`
    select row_id, frequency, last_sent from auto_email_report where enabled = true`
  const delivered: string[] = []
  const failed: string[] = []
  for (const r of rows) {
    const gap = CADENCE_MS[r.frequency] ?? CADENCE_MS.Daily
    const due = !r.last_sent || now.getTime() - new Date(r.last_sent).getTime() >= gap
    if (!due) continue
    // One schedule that cannot be sent (its owner gone, a column they cannot
    // see) does not hold back the others; the pass then fails, naming it.
    try {
      await deliverAutoEmailReport(r.row_id as string)
      delivered.push(r.row_id as string)
    } catch (err) {
      failed.push(`${r.row_id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failed.length)
    throw new AppError('ValidationError', `Some scheduled reports were not sent. ${failed.join('; ')}`)
  return delivered
}
