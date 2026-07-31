// RFC-4180 CSV parsing/serialization for the csv-folder driver, written for
// BYTE STABILITY: every untouched record keeps its original raw text (slice
// of the source file), so a read→write round trip with no edits reproduces
// the file byte for byte — quoting quirks, CRLF, trailing newline and all.
// Only records actually edited or inserted are re-serialized (minimal
// RFC-4180 quoting). That property is what keeps dbt seed diffs reviewable.

export interface CsvModel {
  headerRaw: string // header record exactly as it appeared (no EOL)
  headers: string[]
  // One entry per data record: parsed fields + the raw record text (no EOL).
  records: { fields: string[]; raw: string }[]
  eol: '\n' | '\r\n'
  trailingNewline: boolean
}

export function parseCsv(text: string): CsvModel {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const records: { fields: string[]; raw: string }[] = []
  let fields: string[] = []
  let field = ''
  let recordStart = 0
  let inQuotes = false
  let i = 0
  const pushRecord = (end: number) => {
    fields.push(field)
    field = ''
    records.push({ fields, raw: text.slice(recordStart, end) })
    fields = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      fields.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\n' || ch === '\r') {
      const end = i
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i++
      pushRecord(end)
      recordStart = i
      continue
    }
    field += ch
    i++
  }
  const trailingNewline = text.length > 0 && recordStart >= text.length
  if (!trailingNewline) pushRecord(text.length)

  const header = records.shift() ?? { fields: [], raw: '' }
  return {
    headerRaw: header.raw,
    headers: header.fields,
    records,
    eol,
    trailingNewline,
  }
}

// Minimal RFC-4180 quoting for records we author.
export function serializeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function serializeRecord(fields: string[]): string {
  return fields.map(serializeField).join(',')
}

export function serializeCsv(model: CsvModel): string {
  const lines = [model.headerRaw, ...model.records.map((r) => r.raw)]
  return lines.join(model.eol) + (model.trailingNewline ? model.eol : '')
}
