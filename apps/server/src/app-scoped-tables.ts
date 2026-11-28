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
import { getMeta } from './meta'
import { sql } from './db'
import { tableRelation } from './table-engine'

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
  /** The columns to answer, besides row_id and updated_at; every column of the row itself when absent. A Sub-table
   *  column named here comes with its rows (each child row's own columns), in their order. */
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
      const meta = await getMeta(table)
      const subTables = meta.columns.filter((c) => c.column_type === 'Sub-table' && options.fields?.includes(c.column_name))
      // without fields, every column of the row itself (a Sub-table only when named)
      const own = meta.columns.filter((c) => !['Sub-table', 'Section Break', 'Column Break'].includes(c.column_type)).map((c) => c.column_name)
      const fields = [...new Set(['row_id', 'updated_at', ...(options.fields ? options.fields.filter((f) => !subTables.some((c) => c.column_name === f)) : own)])]
      const rows = new Map<string, Record<string, unknown>>()
      for (const group of where.any) {
        // A place's own filters and the read's, all of which must hold.
        const conditions = [...group, ...where.all].map(({ column, values }) => [column, 'in', values] as [string, string, unknown])
        // by row_id, after the last one read, so a row saved meanwhile neither shifts a page nor is read twice
        for (let after: string | null = null; ;) {
          const page = (await getList(table, { filters: [...conditions, ...(after === null ? [] : [['row_id', '>', after] as [string, string, unknown]])],
            fields, order_by: 'row_id asc', limit_page_length: PAGE })).data as Record<string, unknown>[]
          for (const row of page) rows.set(String(row.row_id), row)
          if (rows.size > SCOPED_LIST_LIMIT) throw new AppError('ValidationError', `More than ${SCOPED_LIST_LIMIT} rows of ${table}: narrow the read by its keys`)
          if (page.length < PAGE) break
          after = String(page[page.length - 1].row_id)
        }
      }
      const answer = [...rows.values()].sort((a, b) => (String(a.row_id) < String(b.row_id) ? -1 : 1))
      for (const column of subTables) await attachChildren(meta.name, column.column_name, column.row_table!, answer)
      return JSON.parse(JSON.stringify(answer)) as Record<string, unknown>[]
    },
  })
}

/** Each row's rows of one Sub-table, as loadChildren reads them (document.ts): by parent, in their order. */
async function attachChildren(parentType: string, column: string, childTable: string, rows: Record<string, unknown>[]) {
  const child = await getMeta(childTable)
  const own = child.columns.filter((c) => !['Sub-table', 'Section Break', 'Column Break'].includes(c.column_type)).map((c) => c.column_name)
  const byParent = new Map<string, Record<string, unknown>[]>(rows.map((row) => [String(row.row_id), []]))
  const ids = [...byParent.keys()]
  for (let i = 0; i < ids.length; i += 1000) {
    for (const r of await sql`select parent, ${sql(['row_id', ...own])} from ${sql(await tableRelation(childTable))}
        where parent in ${sql(ids.slice(i, i + 1000))} and parenttype = ${parentType} and parentfield = ${column} order by parent, position`) {
      const { parent, ...values } = r as Record<string, unknown>
      byParent.get(String(parent))!.push(values)
    }
  }
  for (const row of rows) row[column] = byParent.get(String(row.row_id))
}

/** An outbound read's handler runs after its transaction has closed, so it reads no Table. */
export const CLOSED_SCOPED_TABLES: ReturnType<typeof scopedTables> = Object.freeze({
  list: () => { throw new AppError('ValidationError', 'This read is outbound and its transaction has closed: read scoped Tables in a read that is not outbound') },
})
