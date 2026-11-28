// #1454: an app's own Tables read within the reader's places. A person_scope
// read lists rows of a Table the app declares under `scopedTables`, and the
// platform answers only the rows the reader's places reach, by the same
// mapping and the same fail-closed rule as a dataset (datasetWhere): a place
// contributes rows only when the Table maps every filter the place names, and
// no place means no row. The rows are read as the platform, so the Table
// itself needs no read grant for the people the read serves: who sees which
// row is decided here, from the places, never by the app's code.
import { z } from 'zod'
import type { PersonScope } from 'shared'
import { AppError } from './errors'
import { datasetWhere, type DatasetDeclaration } from './app-datasets'
import { getList } from './query'

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length

const scopedTableSchema = z.object({
  /** One of the app's own Tables. */
  table: z.string().min(1),
  /** The columns a read may filter on, besides the places. */
  keys: z.array(identifier).refine(distinct, 'Scoped Table keys must be distinct'),
  /** Scope filter key → column, as a dataset maps them. At least one. */
  filters: z.record(identifier, identifier).refine((filters) => Object.keys(filters).length > 0, 'A scoped Table maps at least one scope filter'),
}).strict()

export const scopedTablesDeclaration = z.array(scopedTableSchema)
  .refine((tables) => distinct(tables.map((t) => t.table)), 'Each scoped Table is declared once')

export type ScopedTableDeclaration = z.infer<typeof scopedTableSchema>

/** Column types a row cannot be narrowed by. */
const UNFILTERABLE = new Set(['Sub-table', 'Section Break', 'Column Break', 'JSON', 'Text', 'Long Text', 'Attach', 'Attach Image'])

/** Checked when the app's files are loaded: each scoped Table is the app's own, and every key and mapped column is
 *  one of its plain columns. */
export function validateScopedTables(app: string, tables: readonly { name: string; columns: readonly { column_name: string; column_type: string }[] }[],
  declarations: readonly ScopedTableDeclaration[] | undefined): void {
  for (const declaration of declarations ?? []) {
    const table = tables.find((t) => t.name === declaration.table)
    if (!table || !declaration.table.startsWith(`${app}.`)) throw new Error(`The scoped Table ${declaration.table} is not one of the app's own Tables`)
    for (const column of [...declaration.keys, ...Object.values(declaration.filters)]) {
      const found = table.columns.find((c) => c.column_name === column)
      if (!found || UNFILTERABLE.has(found.column_type))
        throw new Error(`The scoped Table ${declaration.table} cannot be filtered on ${column}: it is not one of its plain columns`)
    }
  }
}

/** A scoped Table as datasetWhere reads a dataset: its keys and its mapping. */
const asDataset = (declaration: ScopedTableDeclaration) => ({ name: declaration.table, keys: declaration.keys, filters: declaration.filters }) as unknown as DatasetDeclaration

export interface ScopedListOptions {
  /** The columns to answer, besides row_id and updated_at; all readable columns when absent. */
  fields?: string[]
}

/** The largest answer one list may give; a read that needs more narrows by its keys. */
export const SCOPED_LIST_LIMIT = 100_000
const PAGE = 500

/**
 * `context.scopedTables` for one read: the app's declared Tables, each row
 * within the reader's frozen places. One query a place (each place is one AND
 * group; places are joined by OR, as a dataset's are), the rows merged by
 * row_id, so a row two places reach is answered once.
 */
export function scopedTables(declarations: readonly ScopedTableDeclaration[], places: PersonScope | undefined) {
  return Object.freeze({
    async list(table: string, filters?: unknown, options: ScopedListOptions = {}): Promise<Record<string, unknown>[]> {
      const declaration = declarations.find((d) => d.table === table)
      if (!declaration) throw new AppError('ValidationError', `The app has not declared the scoped Table ${String(table)}`)
      if (options.fields !== undefined && (!Array.isArray(options.fields) || options.fields.some((f) => typeof f !== 'string')))
        throw new AppError('ValidationError', 'fields is a list of column names')
      const where = datasetWhere(asDataset(declaration), places, filters)
      const fields = options.fields ? [...new Set(['row_id', 'updated_at', ...options.fields])] : undefined
      const rows = new Map<string, Record<string, unknown>>()
      for (const group of where.any) {
        // A place's own filters and the read's, all of which must hold.
        const conditions = [...group, ...where.all].map(({ column, values }) => [column, 'in', values] as [string, string, unknown])
        for (let start = 0; ; start += PAGE) {
          const page = (await getList(table, { filters: conditions, ...(fields ? { fields } : {}), order_by: 'row_id asc',
            limit_start: start, limit_page_length: PAGE })).data as Record<string, unknown>[]
          for (const row of page) rows.set(String(row.row_id), row)
          if (rows.size > SCOPED_LIST_LIMIT) throw new AppError('ValidationError', `More than ${SCOPED_LIST_LIMIT} rows of ${table}: narrow the read by its keys`)
          if (page.length < PAGE) break
        }
      }
      return JSON.parse(JSON.stringify([...rows.values()].sort((a, b) => (String(a.row_id) < String(b.row_id) ? -1 : 1)))) as Record<string, unknown>[]
    },
  })
}

/** An outbound read's handler runs after its transaction has closed, so it reads no Table. */
export const CLOSED_SCOPED_TABLES: ReturnType<typeof scopedTables> = Object.freeze({
  list: () => { throw new AppError('ValidationError', 'This read is outbound and its transaction has closed: read scoped Tables in a read that is not outbound') },
})
