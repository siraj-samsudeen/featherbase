import { sql } from './db'
import { saveDoc } from './document'
import { invalidateMeta } from './meta'

// CUST-005: export a Table's customizations (Custom Fields + Property
// Setters) as a portable JSON bundle, and import a bundle to recreate them.
// Import goes through saveDoc so the Custom Field controller materializes the
// column, exactly as a manual creation would.

export interface CustomFieldExport {
  dt: string
  column_name: string
  label: string | null
  column_type: string
  reference_table: string | null
  choices: string | null
  row_table: string | null
  reqd: boolean
  in_list_view: boolean
}
export interface MetadataOverrideExport {
  table_name: string
  column_name: string | null
  property: string
  value: string | null
}
export interface CustomizationBundle {
  table: string
  custom_fields: CustomFieldExport[]
  property_setters: MetadataOverrideExport[]
}

export async function exportCustomizations(table: string): Promise<CustomizationBundle> {
  const cf = await sql`
    select dt, column_name, label, column_type, reference_table, choices, row_table, reqd, in_list_view
    from custom_field where dt = ${table} order by column_name`
  const ps = await sql`
    select table_name, column_name, property, value
    from metadata_override where table_name = ${table} order by column_name, property`
  return {
    table,
    custom_fields: cf as unknown as CustomFieldExport[],
    property_setters: ps as unknown as MetadataOverrideExport[],
  }
}

export async function importCustomizations(
  bundle: Partial<CustomizationBundle>,
  user = 'Administrator',
): Promise<{ custom_fields: number; property_setters: number }> {
  let cfCount = 0
  let psCount = 0
  const touched = new Set<string>()

  for (const f of bundle.custom_fields ?? []) {
    const [existing] = await sql`
      select row_id from custom_field where dt = ${f.dt} and column_name = ${f.column_name}`
    if (existing) continue // already present — idempotent
    await saveDoc(
      'Custom Field',
      {
        name: `${f.dt}-${f.column_name}`,
        dt: f.dt,
        column_name: f.column_name,
        label: f.label ?? null,
        column_type: f.column_type ?? 'Data',
        reference_table: f.reference_table ?? null,
        choices: f.choices ?? null,
        row_table: f.row_table ?? null,
        reqd: f.reqd ?? false,
        in_list_view: f.in_list_view ?? false,
      },
      user,
    )
    touched.add(f.dt)
    cfCount++
  }

  for (const p of bundle.property_setters ?? []) {
    const [existing] = await sql`
      select row_id from metadata_override
      where table_name = ${p.table_name} and coalesce(column_name, '') = ${p.column_name ?? ''}
        and property = ${p.property}`
    if (existing) continue
    await saveDoc(
      'Metadata Override',
      {
        name: `${p.table_name}-${p.column_name ?? ''}-${p.property}`,
        table_name: p.table_name,
        column_name: p.column_name ?? null,
        property: p.property,
        value: p.value ?? null,
      },
      user,
    )
    touched.add(p.table_name)
    psCount++
  }

  for (const t of touched) invalidateMeta(t)
  return { custom_fields: cfCount, property_setters: psCount }
}
