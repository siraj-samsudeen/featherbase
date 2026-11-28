// #1454: an app declares which of its own Tables are about places, mapping the scope filters to columns as a
// dataset does. The platform then reads every such Table only within each person's places, on every read path
// (place-scope.ts); this file is the declaration and its check when the app is loaded.
import { z } from 'zod'

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

/** Column types a row can be narrowed by: values that compare as the same text in SQL and in code (no dates, no
 *  decimals, whose text forms differ between the two). */
const FILTERABLE = new Set(['Data', 'Choice', 'Select', 'Int', 'Reference', 'Link'])

/** Checked when the app's files are loaded: each scoped Table is the app's own, and every key and mapped column is
 *  one of its plain columns. */
export function validateScopedTables(app: string, tables: readonly { name: string; columns: readonly { column_name: string; column_type: string }[] }[],
  declarations: readonly ScopedTableDeclaration[] | undefined): void {
  for (const declaration of declarations ?? []) {
    const table = tables.find((t) => t.name === declaration.table)
    if (!table || !declaration.table.startsWith(`${app}.`)) throw new Error(`The scoped Table ${declaration.table} is not one of the app's own Tables`)
    // a key is any plain column a read may filter on; a mapped column must compare as the same text in SQL and code
    for (const column of [...declaration.keys, ...Object.values(declaration.filters)]) {
      const found = table.columns.find((c) => c.column_name === column)
      const mapped = Object.values(declaration.filters).includes(column)
      if (!found || (mapped ? !FILTERABLE.has(found.column_type) : ['Sub-table', 'Section Break', 'Column Break'].includes(found.column_type)))
        throw new Error(`The scoped Table ${declaration.table} cannot be filtered on ${column}: it is not one of its plain columns`)
    }
  }
}
