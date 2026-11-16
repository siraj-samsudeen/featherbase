import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { viewColumns } from './list-view-columns'
import type { ReadingPresentation } from 'shared'

export interface ColumnDef {
  row_id: string
  parent: string
  position: number
  column_name: string
  label: string | null
  column_type: string
  reference_table: string | null
  /** #1021: when reference_table is a view, the base Table its rows are of. */
  reference_base?: string
  /** #881: on a link to a row of any Table, the column holding its Table;
   *  its `choices` then lists the Tables allowed, one per line. */
  table_column?: string | null
  choices: string | null
  choice_labels?: Record<string, string> | null
  row_table: string | null
  reqd: boolean
  unique: boolean
  default_value: string | null
  read_only: boolean
  hidden: boolean
  in_list_view: boolean
  tier: 'basic' | 'restricted'
  /** One plain line shown under the control (#473). */
  description?: string | null
  /** On a source-bound Table: the source table this column's foreign key lands on (#796). */
  source_fk_schema?: string | null
  source_fk_table?: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  submission_status: string
}

export interface TableMeta {
  name: string
  module: string
  kind: 'table' | 'sub_table' | 'settings' | 'view'
  /** #1021: a view's base Table and the filters choosing its rows. A view
   *  holds no rows of its own: its rows open and save as base rows. */
  view_of?: string | null
  view_filters?: [string, string, unknown][] | null
  is_submittable: boolean
  id_pattern: string
  title_column: string | null
  reading_presentation?: ReadingPresentation | null
  sort_column: string
  sort_order: string
  track_changes: boolean
  enable_assignments?: boolean
  enable_tags?: boolean
  enable_files?: boolean
  enable_discussion?: boolean
  description: string | null
  custom: boolean
  // #74: platform tables created by the migration chain — grouped under the
  // sidebar's collapsed System section, never hidden.
  system: boolean
  // #651: the installed app that owns this Table, if any.
  owner_app?: string | null
  // #432: the platform alone writes this Table's rows (Activity Log, Version,
  // Background Job, …). Lists and forms show it read-only for everyone.
  system_written?: boolean
  /** Private work (mandatory access); never deleted permanently (#859). */
  access_policy?: unknown
  // #905: an archived Table keeps its rows readable but takes no new rows or
  // edits. Who archived it, when, and what replaced it.
  archived_at?: string | null
  archived_by?: string | null
  archived_note?: string | null
  // EDS-13: set when the Table is bound to an external Data Source. The Admin
  // shows a source badge and, for read-only sources, renders lists/forms
  // without any write affordance.
  data_source?: string | null
  external_pk?: string | null
  external_modified?: string | null
  source_access?: 'read_only' | 'read_write' | null
  source_engine?: string | null
  // Server-derived: engine can write AND access is read_write. The Admin
  // gates every write affordance on this, never on access alone.
  source_writable?: boolean
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  submission_status: string
  position: number
  columns: ColumnDef[]
  /** Column names the caller may read; served per request beside cached metadata. */
  readable_columns?: string[]
  /** Server-resolved storage, never inferred from a display label. */
  storage_identity?: {
    schema: string
    relation: string
    row_key: string[]
    data_source: string | null
    discriminator: { table_name: string } | null
  } | null
}

export const NO_COLUMN_TYPES = new Set(['Sub-table', 'Section Break', 'Column Break'])

/** When the platform made and last changed a row: on every row, in no Table's columns. */
export const ROW_STAMPS: Record<'created_at' | 'updated_at', { label: string; column_type: 'Datetime'; by: 'created_by' | 'updated_by' }> = {
  created_at: { label: 'Created', column_type: 'Datetime', by: 'created_by' },
  updated_at: { label: 'Updated', column_type: 'Datetime', by: 'updated_by' },
}

export const COLUMN_TYPES = [
  'Data', 'Int', 'Float', 'Currency', 'Check', 'Choice', 'Date', 'Datetime',
  'Text', 'Long Text', 'Reference', 'Sub-table', 'Attach', 'Attach Image', 'JSON',
  'Section Break', 'Column Break',
] as const

// EDS-7: a bound Table on a read-only source (or a source whose engine has
// no write path) accepts no writes; the Admin drops the affordances entirely
// (EDS-13: "absent, not merely disabled"). Trusts the server-derived
// source_writable — a duckdb source misconfigured read_write still reads
// as read-only here (review finding 7).
export function isSourceReadOnly(meta: TableMeta | undefined): boolean {
  if (!meta?.data_source) return false
  return meta.source_writable !== true
}

// #432: rows only the platform writes — no create, edit, delete, import,
// merge or column change for anyone, administrators included.
export function isSystemWritten(meta: TableMeta | undefined): boolean {
  return meta?.system_written === true
}

// Every row-write affordance (New, Save, Delete, Rename, Import, bulk edit)
// hangs on this: absent when a read-only source owns the rows or when the
// platform does.
export function isRowsReadOnly(meta: TableMeta | undefined): boolean {
  return isSourceReadOnly(meta) || isSystemWritten(meta) || isArchived(meta) || isView(meta)
}

/** #1021: the Table a link's values are rows of: a view's base, since a
 *  link to a view stores and opens base rows. */
export function linkRowsTable(column: { reference_table?: string | null; reference_base?: string | null }): string | null {
  return column.reference_base ?? column.reference_table ?? null
}

/** #1021: a view: a filtered lens on its base, whose rows are its base's. */
export function isView(meta: TableMeta | undefined): meta is TableMeta & { kind: 'view'; view_of: string } {
  return meta?.kind === 'view' && Boolean(meta.view_of)
}

/** One plain line for a view's filter: "Is Store is Yes, Region is North". */
export function describeViewFilters(meta: Pick<TableMeta, 'columns' | 'view_filters'>): string {
  const words: Record<string, string> = {
    '=': 'is', '!=': 'is not', '>': 'is more than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most',
    like: 'is like', 'not like': 'is not like', in: 'is one of', 'not in': 'is none of',
  }
  const shown = (v: unknown) => v === true ? 'Yes' : v === false ? 'No' : v === null ? 'empty' : Array.isArray(v) ? v.map(String).join(', ') : String(v)
  return (meta.view_filters ?? []).map(([column, op, value]) => {
    const col = meta.columns.find((c) => c.column_name === column)
    // The server keeps only VIEW_OPERATORS (views.ts), each worded above.
    return `${col?.label ?? column} ${words[op]} ${shown(value)}`
  }).join(', ')
}

/** #905: archived: its rows read only for everyone, until it is un-archived. */
export function isArchived(meta: TableMeta | undefined): boolean {
  return Boolean(meta?.archived_at)
}

/** The one query for a Table's metadata — shared by useMeta and by callers
 *  that must know a Table exists before acting (the recents recorder). */
export function metaQuery(table: string) {
  return {
    queryKey: ['meta', table],
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(table)}:meta`),
    staleTime: 60_000,
  }
}

export function useMeta(table: string, enabled = true) {
  return useQuery({ ...metaQuery(table), enabled: enabled && Boolean(table) })
}

// Columns for a list view: Row ID first, then the Table's list columns (or
// the first two data columns when none is flagged) — a list with nobody's
// arrangement applied. #738: one definition, in list-view-columns.
export function listColumns(meta: TableMeta) {
  return viewColumns(meta, {})
}
