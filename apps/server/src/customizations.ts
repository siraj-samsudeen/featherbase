import { sql } from './db'
import { saveDoc } from './document'
import { invalidateMeta } from './meta'

// CUST-005: export a DocType's customizations (Custom Fields + Property
// Setters) as a portable JSON bundle, and import a bundle to recreate them.
// Import goes through saveDoc so the Custom Field controller materializes the
// column, exactly as a manual creation would.

export interface CustomFieldExport {
  dt: string
  fieldname: string
  label: string | null
  fieldtype: string
  options: string | null
  reqd: boolean
  in_list_view: boolean
}
export interface PropertySetterExport {
  doc_type: string
  field_name: string | null
  property: string
  value: string | null
}
export interface CustomizationBundle {
  doctype: string
  custom_fields: CustomFieldExport[]
  property_setters: PropertySetterExport[]
}

export async function exportCustomizations(doctype: string): Promise<CustomizationBundle> {
  const cf = await sql`
    select dt, fieldname, label, fieldtype, options, reqd, in_list_view
    from tab_custom_field where dt = ${doctype} order by fieldname`
  const ps = await sql`
    select doc_type, field_name, property, value
    from tab_property_setter where doc_type = ${doctype} order by field_name, property`
  return {
    doctype,
    custom_fields: cf as unknown as CustomFieldExport[],
    property_setters: ps as unknown as PropertySetterExport[],
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
      select name from tab_custom_field where dt = ${f.dt} and fieldname = ${f.fieldname}`
    if (existing) continue // already present — idempotent
    await saveDoc(
      'Custom Field',
      {
        name: `${f.dt}-${f.fieldname}`,
        dt: f.dt,
        fieldname: f.fieldname,
        label: f.label ?? null,
        fieldtype: f.fieldtype ?? 'Data',
        options: f.options ?? null,
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
      select name from tab_property_setter
      where doc_type = ${p.doc_type} and coalesce(field_name, '') = ${p.field_name ?? ''}
        and property = ${p.property}`
    if (existing) continue
    await saveDoc(
      'Property Setter',
      {
        name: `${p.doc_type}-${p.field_name ?? ''}-${p.property}`,
        doc_type: p.doc_type,
        field_name: p.field_name ?? null,
        property: p.property,
        value: p.value ?? null,
      },
      user,
    )
    touched.add(p.doc_type)
    psCount++
  }

  for (const dt of touched) invalidateMeta(dt)
  return { custom_fields: cfCount, property_setters: psCount }
}
