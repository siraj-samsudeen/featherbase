import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta } from './meta'
import { columnType, tableName } from './doctype-engine'

// CUST-001: apply a Custom Field record to its target DocType — add the
// column (if the fieldtype has one) and a docfield row marked custom. Safe
// to call repeatedly (used at boot to re-apply after a core re-seed).

export interface CustomFieldRec {
  dt: string
  fieldname: string
  label?: string | null
  fieldtype?: string | null
  options?: string | null
  reqd?: boolean | null
  in_list_view?: boolean | null
}

export async function applyCustomField(
  rec: CustomFieldRec,
  tx: typeof sql = sql,
): Promise<void> {
  const fieldtype = rec.fieldtype || 'Data'
  const meta = await getMeta(rec.dt)
  // Column (layout/table types have none).
  const col = columnType(fieldtype)
  if (col)
    await tx.unsafe(
      `alter table "${tableName(rec.dt)}" add column if not exists "${rec.fieldname}" ${col}`,
    )
  // Docfield row: insert or update, always marked custom.
  const existing = meta.fields.find((f) => f.fieldname === rec.fieldname)
  if (existing && !(existing as { custom?: boolean }).custom)
    throw new AppError('ConflictError', `${rec.fieldname} already exists on ${rec.dt}`)
  const idx = existing ? undefined : meta.fields.length + 1
  await tx`
    insert into tab_docfield ${tx({
      parent: rec.dt,
      idx: idx ?? 0,
      fieldname: rec.fieldname,
      label: rec.label ?? rec.fieldname,
      fieldtype,
      options: rec.options ?? null,
      reqd: rec.reqd ?? false,
      in_list_view: rec.in_list_view ?? false,
      custom: true,
    })}
    on conflict (parent, fieldname) do update set
      label = excluded.label, fieldtype = excluded.fieldtype,
      options = excluded.options, reqd = excluded.reqd,
      in_list_view = excluded.in_list_view, custom = true`
  invalidateMeta(rec.dt)
}

export async function removeCustomField(dt: string, fieldname: string): Promise<void> {
  // Drop the docfield (keep the column + data — non-destructive, like schema sync).
  await sql`delete from tab_docfield where parent = ${dt} and fieldname = ${fieldname} and custom = true`
  invalidateMeta(dt)
}

// CUST-001: re-apply every Custom Field record. Run at boot so custom fields
// survive a re-seed of core fixtures that rewrote base docfields.
export async function reapplyCustomFields(): Promise<number> {
  const recs = await sql<CustomFieldRec[]>`
    select dt, fieldname, label, fieldtype, options, reqd, in_list_view from tab_custom_field`
  for (const r of recs) {
    try {
      await applyCustomField(r)
    } catch {
      // A record referencing a now-missing DocType is skipped, not fatal.
    }
  }
  return recs.length
}
