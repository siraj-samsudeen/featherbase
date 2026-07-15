import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { FIELD_TYPES, type DocTypeMeta, getMeta } from './meta'

// Columns every generated table has (META-005); user fields cannot shadow them.
export const STANDARD_COLUMNS = [
  'name',
  'owner',
  'creation',
  'modified',
  'modified_by',
  'docstatus',
  'idx',
  'parent',
  'parenttype',
  'parentfield',
] as const

// META-002: how each fieldtype maps to a Postgres column type.
// Layout fields and Table fields produce no column at all.
const COLUMN_TYPES: Record<string, string | null> = {
  Data: 'varchar(140)',
  Int: 'bigint',
  Float: 'double precision',
  Currency: 'numeric(21,9)',
  Check: 'boolean',
  Select: 'text',
  Date: 'date',
  Datetime: 'timestamptz',
  Text: 'text',
  'Long Text': 'text',
  Link: 'varchar(140)',
  Table: null,
  Attach: 'text',
  JSON: 'jsonb',
  'Section Break': null,
  'Column Break': null,
}

export function columnType(fieldtype: string): string | null {
  if (!(fieldtype in COLUMN_TYPES))
    throw new AppError('ValidationError', `Unknown fieldtype ${fieldtype}`)
  return COLUMN_TYPES[fieldtype]
}

const fieldSchema = z.object({
  fieldname: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'fieldname must be snake_case'),
  label: z.string().optional(),
  fieldtype: z.enum(FIELD_TYPES),
  options: z.string().optional(),
  reqd: z.boolean().optional(),
  unique: z.boolean().optional(),
  default_value: z.string().optional(),
  read_only: z.boolean().optional(),
  hidden: z.boolean().optional(),
  in_list_view: z.boolean().optional(),
  permlevel: z.number().int().min(0).max(9).optional(),
})

export const doctypeDefSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9 ]{0,60}$/, 'invalid DocType name'),
  module: z.string().optional(),
  issingle: z.boolean().optional(),
  istable: z.boolean().optional(),
  is_submittable: z.boolean().optional(),
  autoname: z.string().optional(),
  title_field: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(fieldSchema).min(1),
})

export type DocTypeDef = z.infer<typeof doctypeDefSchema>

function validateDef(def: DocTypeDef) {
  const fields: Record<string, string> = {}
  const seen = new Set<string>()
  for (const f of def.fields) {
    if ((STANDARD_COLUMNS as readonly string[]).includes(f.fieldname))
      fields[f.fieldname] = `'${f.fieldname}' is a reserved column name`
    if (seen.has(f.fieldname)) fields[f.fieldname] = 'duplicate fieldname'
    seen.add(f.fieldname)
    if (['Link', 'Table', 'Select'].includes(f.fieldtype) && !f.options)
      fields[f.fieldname] = `${f.fieldtype} field requires options`
  }
  if (Object.keys(fields).length)
    throw new AppError('ValidationError', 'Invalid DocType definition', fields)
}

export async function createDocType(input: unknown): Promise<DocTypeMeta> {
  const parsed = doctypeDefSchema.safeParse(input)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues)
      fields[issue.path.join('.')] = issue.message
    throw new AppError('ValidationError', 'Invalid DocType definition', fields)
  }
  const def = parsed.data
  validateDef(def)

  const [existing] = await sql`select 1 from doctype where name = ${def.name}`
  if (existing)
    throw new AppError('ConflictError', `DocType ${def.name} already exists`)

  await sql.begin(async (tx) => {
    await tx`insert into doctype ${tx({
      name: def.name,
      module: def.module ?? 'Core',
      issingle: def.issingle ?? false,
      istable: def.istable ?? false,
      is_submittable: def.is_submittable ?? false,
      autoname: def.autoname ?? 'hash',
      title_field: def.title_field ?? null,
      description: def.description ?? null,
    })}`
    for (const [i, f] of def.fields.entries()) {
      await tx`insert into docfield ${tx({
        parent: def.name,
        idx: i + 1,
        fieldname: f.fieldname,
        label: f.label ?? f.fieldname,
        fieldtype: f.fieldtype,
        options: f.options ?? null,
        reqd: f.reqd ?? false,
        unique: f.unique ?? false,
        default_value: f.default_value ?? null,
        read_only: f.read_only ?? false,
        hidden: f.hidden ?? false,
        in_list_view: f.in_list_view ?? false,
        permlevel: f.permlevel ?? 0,
      })}`
    }
  })
  return getMeta(def.name)
}
