import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta } from './meta'
import { pgType, tableName } from './table-engine'

// CUST-001: apply a Custom Field record to its target Table — add the
// column (if the column_type has one) and a column_def row marked custom.
// Safe to call repeatedly (used at boot to re-apply after a core re-seed).

export interface CustomFieldRec {
  dt: string
  column_name: string
  label?: string | null
  column_type?: string | null
  reference_table?: string | null
  choices?: string | null
  row_table?: string | null
  reqd?: boolean | null
  in_list_view?: boolean | null
}

export async function applyCustomField(
  rec: CustomFieldRec,
  tx: typeof sql = sql,
): Promise<void> {
  const columnType = rec.column_type || 'Data'
  const meta = await getMeta(rec.dt)
  // Column (layout/sub-table types have none).
  const col = pgType(columnType)
  if (col)
    await tx.unsafe(
      `alter table "${tableName(rec.dt)}" add column if not exists "${rec.column_name}" ${col}`,
    )
  // column_def row: insert or update, always marked custom.
  const existing = meta.columns.find((f) => f.column_name === rec.column_name)
  if (existing && !(existing as { custom?: boolean }).custom)
    throw new AppError('ConflictError', `${rec.column_name} already exists on ${rec.dt}`)
  const position = existing ? undefined : meta.columns.length + 1
  await tx`
    insert into column_def ${tx({
      parent: rec.dt,
      position: position ?? 0,
      column_name: rec.column_name,
      label: rec.label ?? rec.column_name,
      column_type: columnType,
      reference_table: rec.reference_table ?? null,
      choices: rec.choices ?? null,
      row_table: rec.row_table ?? null,
      reqd: rec.reqd ?? false,
      in_list_view: rec.in_list_view ?? false,
      custom: true,
    })}
    on conflict (parent, column_name) do update set
      label = excluded.label, column_type = excluded.column_type,
      reference_table = excluded.reference_table, choices = excluded.choices,
      row_table = excluded.row_table, reqd = excluded.reqd,
      in_list_view = excluded.in_list_view, custom = true`
  invalidateMeta(rec.dt)
}

export async function removeCustomField(dt: string, columnName: string): Promise<void> {
  // Drop the column_def (keep the column + data — non-destructive, like schema sync).
  await sql`delete from column_def where parent = ${dt} and column_name = ${columnName} and custom = true`
  invalidateMeta(dt)
}

// CUST-001: re-apply every Custom Field record. Run at boot so custom columns
// survive a re-seed of core fixtures that rewrote base column_def rows.
export async function reapplyCustomFields(): Promise<number> {
  const recs = await sql<CustomFieldRec[]>`
    select dt, column_name, label, column_type, reference_table, choices, row_table, reqd, in_list_view
    from custom_field`
  for (const r of recs) {
    try {
      await applyCustomField(r)
    } catch {
      // A record referencing a now-missing Table is skipped, not fatal.
    }
  }
  return recs.length
}
