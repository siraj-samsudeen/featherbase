// #1105 (mcp-table-lifecycle D3): an agent sends a file to /mcp as CSV text,
// and the server reads it into rows of cells, header row first, the way the
// import wizard's parser hands rows to the import. RFC 4180: a cell in double
// quotes may hold the delimiter, a line break, or a quote written twice.
import { AppError } from './errors'

export type CsvDelimiter = ',' | '\t' | ';'

export function parseCsv(text: string, delimiter: CsvDelimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let quoteRow = 0
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const endRow = () => {
    row.push(cell)
    rows.push(row)
    row = []
    cell = ''
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (src[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else if (ch === '"' && cell === '') {
      quoted = true
      quoteRow = rows.length + 1
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      endRow()
    } else cell += ch
  }
  if (quoted) throw new AppError('ValidationError', `The file's row ${quoteRow} opens a quoted cell that is never closed`)
  if (cell !== '' || row.length) endRow()
  return rows
}
