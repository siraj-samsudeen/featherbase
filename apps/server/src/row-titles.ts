import { z } from 'zod'
import { rowDisplayTitle } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { scopedWhere } from './query'

// Home cleanup: what a person reads for each referenced row (Home tiles,
// Recent, the activity feed). Scoped like a list read — a row the caller may
// not read, a missing row, or a Table that cannot be read here (unknown,
// source-bound, Settings) is simply left out, and the caller falls back to
// what it already had.

export interface RowRef {
  table: string
  row_id: string
}
export interface RowTitle extends RowRef {
  title: string
}

const bodySchema = z.object({
  rows: z.array(z.object({ table: z.string().min(1).max(140), row_id: z.string().min(1).max(400) })).max(100),
})

export function validateRowTitleRequest(body: unknown): RowRef[] {
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throw new AppError('ValidationError', 'Expected { rows: [{ table, row_id }] } (max 100)')
  return parsed.data.rows
}

export async function rowTitles(user: string, refs: RowRef[]): Promise<RowTitle[]> {
  const byTable = new Map<string, Set<string>>()
  for (const r of refs) byTable.set(r.table, (byTable.get(r.table) ?? new Set()).add(r.row_id))
  const out: RowTitle[] = []
  for (const [table, ids] of byTable) {
    // A Table this caller cannot read here (an AppError) is left out; any
    // other failure propagates.
    const scoped = await scopedWhere(table, user, [['row_id', 'in', [...ids]]])
      .catch((err: unknown) => (err instanceof AppError ? null : Promise.reject(err)))
    if (!scoped) continue
    const { meta, table: relation, where, cols } = scoped
    const rows = await sql`select * from ${sql(relation)} where ${where}`
    // Only the columns this caller may read take part in the title.
    const readable = { ...meta, columns: meta.columns.filter((c) => cols.has(c.column_name)) }
    const titleMeta = { ...readable, title_column: meta.title_column && cols.has(meta.title_column) ? meta.title_column : null }
    for (const row of rows) {
      const rowId = String(row[meta.row_key])
      out.push({ table, row_id: rowId, title: rowDisplayTitle(titleMeta, row, rowId) })
    }
  }
  return out
}
