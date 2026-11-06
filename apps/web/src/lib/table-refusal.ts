import { ApiError } from './api'

const COLUMN_PATH = /^columns\.(\d+)(?:\..+)?$/

// Paths that are not a column are already plain field names; give them the
// user's word for the control rather than the payload key.
const TOP_LEVEL_LABEL: Record<string, string> = {
  name: 'Table name',
  module: 'Module',
  id_pattern: 'Row ID',
  columns: 'Columns',
  system: 'Table',
}

/** A column as it was sent: its place in the payload is its place in this
 *  list, `sourceIndex` its place on the person's screen. */
export interface SentColumn {
  column_name: string
  label: string
  sourceIndex: number
}

// The user's mental model must never straddle two numbering schemes
// (2026-08-11 owner directive): a server path like `columns.0.column_name`
// is translated to the row it came from and named by the label the user
// typed. Returns the per-row errors to mark inline, plus sentences for the
// banner.
export function describeFieldErrors(
  fields: Record<string, string>,
  kept: SentColumn[],
): { rows: Record<number, string>; parts: string[] } {
  const rows: Record<number, string> = {}
  const parts: string[] = []
  for (const [path, message] of Object.entries(fields)) {
    const match = COLUMN_PATH.exec(path)
    const col = match ? kept[Number(match[1])] : undefined
    if (!col) {
      const label = TOP_LEVEL_LABEL[path] ?? (path.includes('.') ? null : path)
      parts.push(label ? `${label}: ${message}` : message)
      continue
    }
    const who = col.label.trim() || col.column_name.trim()
    rows[col.sourceIndex] = rows[col.sourceIndex] ? `${rows[col.sourceIndex]}; ${message}` : message
    parts.push(`Column “${who}”: ${message}`)
  }
  return { rows, parts }
}

/** What a refusal says to a person: the server's message and, when it names
 *  them, each refused field and why. A bare "Invalid Table definition" tells
 *  nobody what to fix. */
export function refusalMessage(err: unknown, fallback: string, kept: SentColumn[] = []): string {
  if (!(err instanceof ApiError)) return fallback
  const parts = err.fields ? describeFieldErrors(err.fields, kept).parts : []
  return parts.length ? `${err.message} — ${parts.join('; ')}` : err.message
}
