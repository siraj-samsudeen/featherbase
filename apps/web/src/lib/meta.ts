import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface DocField {
  fieldname: string
  label: string | null
  fieldtype: string
  options: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  permlevel: number
  idx: number
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
  fields: DocField[]
}

export const NO_COLUMN_TYPES = new Set(['Table', 'Section Break', 'Column Break'])

export const FIELD_TYPES = [
  'Data', 'Int', 'Float', 'Currency', 'Check', 'Select', 'Date', 'Datetime',
  'Text', 'Long Text', 'Link', 'Table', 'Attach', 'Attach Image', 'JSON',
  'Section Break', 'Column Break',
] as const

export function useMeta(doctype: string) {
  return useQuery({
    queryKey: ['meta', doctype],
    queryFn: () => api.get<DocTypeMeta>(`/api/meta/${encodeURIComponent(doctype)}`),
    staleTime: 60_000,
  })
}

// Columns for a list view: name first, then flagged fields (or the first
// two data fields when nothing is flagged), matching Frappe's behavior.
export function listColumns(meta: DocTypeMeta): { fieldname: string; label: string }[] {
  const dataFields = meta.fields.filter(
    (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && !f.hidden,
  )
  let flagged = dataFields.filter((f) => f.in_list_view)
  if (!flagged.length) flagged = dataFields.slice(0, 2)
  return [
    { fieldname: 'name', label: 'Name' },
    ...flagged.map((f) => ({ fieldname: f.fieldname, label: f.label ?? f.fieldname })),
  ]
}
