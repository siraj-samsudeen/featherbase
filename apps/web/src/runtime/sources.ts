import { checkPage, PAGE_ROW_CAP, PAGE_ROW_COLUMNS, type PageDefinition, type PagePart, type PageStateValue, type PageTableSource } from 'shared'
import { resolveValue, writePath, type Row } from './grammar'

// #1410: a page's data sources. A Table source is read through the normal list
// API as the person looking; what they type on the page is laid over the rows
// that were read, and reaches the server only when a button saves it.

/** The columns a page reads from each Table source, as the shared checker finds them: the list API answers only the columns it is asked for. */
export function columnsRead(definition: PageDefinition): Record<string, string[]> {
  return Object.fromEntries(checkPage(definition).tables.map(({ source, columns }) => [source, [...new Set(columns.map((use) => use.column))]]))
}

/**
 * What a Table source asks the list API for: each filter on the page's state given that state's value, and
 * the columns it lists, or else the ones the page reads from it (`reads`), with the columns every row carries.
 */
export function sourceRequest(source: PageTableSource, state: Record<string, PageStateValue>, reads: string[] = []) {
  const scope = { model: { state, data: {} } }
  return {
    table: source.table,
    filters: source.filters?.map(([column, operator, value]) => [column, operator, resolveValue(value, scope)]),
    fields: [...new Set([...(source.columns ?? reads), ...PAGE_ROW_COLUMNS])],
    order_by: source.order_by,
    limit_page_length: source.limit ?? PAGE_ROW_CAP,
  }
}

/** The sources a part reads from the top of the page: in a {"@path"}, in the rows it repeats over, or put into its text. */
export function sourcesRead(part: PagePart): string[] {
  const found = new Set<string>()
  const note = (path: unknown) => {
    const source = typeof path === 'string' ? /^\/data\/([^/]+)/.exec(path)?.[1] : undefined
    if (source) found.add(source)
  }
  const visit = (value: unknown): void => {
    if (typeof value === 'string') for (const put of value.matchAll(/\$\{([^}]*)\}/g)) note(put[1])
    if (typeof value !== 'object' || value === null) return
    const held = value as Record<string, unknown>
    note(held['@path'])
    if ('componentId' in held) note(held.path)
    Object.values(held).forEach(visit)
  }
  visit(part)
  return [...found]
}

/** What tells a row apart on the page: its id, or its place when it has none (a sample row). */
export const rowKey = (row: Row, index: number) => String(row.row_id ?? index)

/** The rows as the page shows them: each with what was typed into it laid over what was read. */
export function withTyped(rows: Row[], typed: Record<string, Row> = {}): Row[] {
  return rows.map((row, index) => (typed[rowKey(row, index)] ? { ...row, ...typed[rowKey(row, index)] } : row))
}

/** What was typed on the page and not yet saved: by source, then by row, the columns typed into. */
export type Typed = Record<string, Record<string, Row>>

/** `typed` after a value is written at a row's path ("/data/lines/0/planned_qty"): kept under that row's key, so it stays with the row when the rows are read again. */
export function typeInto(typed: Typed, data: Record<string, Row[]>, path: string, value: unknown): Typed {
  const [, , source, place, column, ...deeper] = path.split('/') as [string, string, string, string, string?, ...string[]]
  const index = Number(place)
  const row = data[source]?.[index]
  if (!row || !column) return typed
  const key = rowKey(row, index)
  const next = writePath(row, `/${[column, ...deeper].join('/')}`, value)
  return { ...typed, [source]: { ...typed[source], [key]: { ...typed[source]?.[key], [column]: next[column] } } }
}

/** `typed` once a row has been saved: what was typed into it is no longer waiting. */
export function forgetTyped(typed: Typed, sources: string[], row: string): Typed {
  return Object.fromEntries(Object.entries(typed).map(([source, rows]) => [
    source,
    sources.includes(source) ? Object.fromEntries(Object.entries(rows).filter(([key]) => key !== row)) : rows,
  ]))
}
