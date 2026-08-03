// RFC-4180 CSV parsing/serialization for the csv-folder driver, written for
// BYTE STABILITY: every untouched record keeps its original raw text (slice
// of the source file) AND its original line terminator — including mixed
// \n / \r\n / lone-\r files — so a read→write round trip with no edits
// reproduces the file byte for byte. Only records actually edited or
// inserted are re-serialized (minimal RFC-4180 quoting, terminated with the
// file's dominant EOL). That property is what keeps dbt seed diffs
// reviewable.

export interface CsvRecord {
  fields: string[]
  raw: string // record text exactly as it appeared (no EOL)
  eol: string // the terminator that FOLLOWED this record ('' = end of file)
}

export interface CsvModel {
  headerRaw: string
  headers: string[]
  headerEol: string
  records: CsvRecord[]
  // Dominant terminator, used only for records WE author.
  defaultEol: '\n' | '\r\n'
}

export function parseCsv(text: string): CsvModel {
  const defaultEol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let recordStart = 0
  let inQuotes = false
  let i = 0
  const pushRecord = (end: number, eol: string) => {
    fields.push(field)
    field = ''
    records.push({ fields, raw: text.slice(recordStart, end), eol })
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
      const eol = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch
      i += eol.length
      pushRecord(end, eol)
      recordStart = i
      continue
    }
    field += ch
    i++
  }
  // Text remaining after the last terminator = a final record with no EOL.
  if (recordStart < text.length || text.length === 0) pushRecord(text.length, '')

  const header = records.shift() ?? { fields: [], raw: '', eol: '' }
  return {
    headerRaw: header.raw,
    headers: header.fields,
    headerEol: header.eol,
    records,
    defaultEol,
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
  let out = model.headerRaw + model.headerEol
  for (const r of model.records) out += r.raw + r.eol
  return out
}
