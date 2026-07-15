import { sql } from './db'
import { AppError } from './errors'

// Field types the engine understands (columns generated in META-002/003).
export const FIELD_TYPES = [
  'Data',
  'Int',
  'Float',
  'Currency',
  'Check',
  'Select',
  'Date',
  'Datetime',
  'Text',
  'Long Text',
  'Link',
  'Table',
  'Attach',
  'JSON',
  'Section Break',
  'Column Break',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface DocField {
  name: string
  parent: string
  idx: number
  fieldname: string
  label: string | null
  fieldtype: FieldType
  options: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  permlevel: number
}

export interface DocTypeMeta {
  name: string
  module: string
  issingle: boolean
  istable: boolean
  is_submittable: boolean
  autoname: string
  title_field: string | null
  sort_field: string
  sort_order: string
  track_changes: boolean
  description: string | null
  custom: boolean
  fields: DocField[]
}

export async function getMeta(name: string): Promise<DocTypeMeta> {
  const [dt] = await sql`select * from doctype where name = ${name}`
  if (!dt) throw new AppError('NotFoundError', `DocType ${name} not found`)
  const fields = await sql<DocField[]>`
    select * from docfield where parent = ${name} order by idx, fieldname`
  return { ...(dt as unknown as Omit<DocTypeMeta, 'fields'>), fields }
}
