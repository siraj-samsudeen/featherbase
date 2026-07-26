import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface ColumnDef {
  name: string
  parent: string
  position: number
  column_name: string
  label: string | null
  column_type: string
  reference_table: string | null
  choices: string | null
  row_table: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  tier: 'basic' | 'restricted'
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  status: string
}

export interface TableMeta {
  name: string
  module: string
  kind: 'table' | 'sub_table' | 'settings'
  is_submittable: boolean
  id_pattern: string
  title_column: string | null
  sort_column: string
  sort_order: string
  track_changes: boolean
  description: string | null
  custom: boolean
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  status: string
  position: number
  columns: ColumnDef[]
}

export const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

export const COLUMN_TYPES = [
  'Data', 'Int', 'Float', 'Currency', 'Check', 'Choice', 'Date', 'Datetime',
  'Text', 'Long Text', 'Reference', 'Sub-table', 'Attach', 'Attach Image', 'JSON',
  'Section Break', 'Column Break',
] as const

export function useMeta(doctype: string) {
  return useQuery({
    queryKey: ['meta', doctype],
    queryFn: () => api.get<TableMeta>(`/api/meta/${encodeURIComponent(doctype)}`),
    staleTime: 60_000,
  })
}

// Columns for a list view: name first, then flagged columns (or the first
// two data columns when nothing is flagged), matching Frappe's behavior.
export function listColumns(
  meta: TableMeta,
): { column_name: string; label: string; column_type: string }[] {
  const dataColumns = meta.columns.filter(
    (c) => !NO_COLUMN_TYPES.has(c.column_type) && !c.hidden,
  )
  let flagged = dataColumns.filter((c) => c.in_list_view)
  if (!flagged.length) flagged = dataColumns.slice(0, 2)
  return [
    { column_name: 'name', label: 'Name', column_type: 'Data' },
    ...flagged.map((c) => ({
      column_name: c.column_name,
      label: c.label ?? c.column_name,
      column_type: c.column_type,
    })),
  ]
}
