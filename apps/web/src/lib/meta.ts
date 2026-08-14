import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface ColumnDef {
  row_id: string
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
  // #74: platform tables created by the migration chain — grouped under the
  // sidebar's collapsed System section, never hidden.
  system: boolean
  // EDS-13: set when the Table is bound to an external Data Source. The Desk
  // shows a source badge and, for read-only sources, renders lists/forms
  // without any write affordance.
  data_source?: string | null
  external_pk?: string | null
  external_modified?: string | null
  source_access?: 'read_only' | 'read_write' | null
  source_engine?: string | null
  // Server-derived: engine can write AND access is read_write. The Desk
  // gates every write affordance on this, never on access alone.
  source_writable?: boolean
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

// EDS-7: a bound Table on a read-only source (or a source whose engine has
// no write path) accepts no writes; the Desk drops the affordances entirely
// (EDS-13: "absent, not merely disabled"). Trusts the server-derived
// source_writable — a duckdb source misconfigured read_write still reads
// as read-only here (review finding 7).
export function isSourceReadOnly(meta: TableMeta | undefined): boolean {
  if (!meta?.data_source) return false
  return meta.source_writable !== true
}

export function useMeta(doctype: string, enabled = true) {
  return useQuery({
    queryKey: ['meta', doctype],
    enabled: enabled && Boolean(doctype),
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(doctype)}:meta`),
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
    { column_name: 'row_id', label: 'Row ID', column_type: 'Data' },
    ...flagged.map((c) => ({
      column_name: c.column_name,
      label: c.label ?? c.column_name,
      column_type: c.column_type,
    })),
  ]
}
