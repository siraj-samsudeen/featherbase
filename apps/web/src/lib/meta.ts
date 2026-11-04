import { useContext, useMemo } from 'react'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getToken } from './api'
import { NavigationVisitContext, useNavigationVisit } from './recents'
import { viewColumns } from './list-view-columns'
import { tableSlug, type ReadingPresentation } from 'shared'

export interface ColumnDef {
  row_id: string
  parent: string
  position: number
  column_name: string
  label: string | null
  column_type: string
  reference_table: string | null
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
  status: string
}

export interface TableMeta {
  name: string
  module: string
  kind: 'table' | 'sub_table' | 'settings'
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
  status: string
  position: number
  columns: ColumnDef[]
  /** #738: the levels of column the caller may read; served per request
   *  beside the cached meta. */
  readable_tiers?: ('basic' | 'restricted')[]
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
  return isSourceReadOnly(meta) || isSystemWritten(meta)
}

/** The one query for a Table's metadata — shared by useMeta and by callers
 *  that must know a Table exists before acting (the recents recorder). */
export function metaQuery(table: string) {
  return {
    queryKey: ['meta', tableSlug(table), getToken(), table],
    queryFn: () => api.get<TableMeta>(`/api/table/${encodeURIComponent(table)}:meta`),
    staleTime: 60_000,
  }
}

export function useMeta(table: string, enabled = true) {
  const client = useQueryClient()
  const arrival = useContext(NavigationVisitContext)
  const visit = useNavigationVisit(`/api/table/${encodeURIComponent(table)}:meta`)
  // A failed save changing credentials must not remount this arrival's query.
  const token = useMemo(getToken, [arrival?.key])
  const address = arrival?.table ?? table
  return useQuery({
    ...metaQuery(table),
    // A slug boundary and its canonical-name consumers share this query;
    // metadata from another sign-in never supplies a route's schema.
    queryKey: ['meta', tableSlug(table), token, address],
    ...(visit ? {
      queryKey: ['meta', tableSlug(table), token, address, visit.key],
      queryFn: () => visit.read<TableMeta>(),
      // Filter navigation must not remove the control being edited. Only
      // the fresh read above records a visit; this is display-only schema.
      placeholderData: (previous: TableMeta | undefined, previousQuery) => {
        if (previous && tableSlug(previous.name) === tableSlug(table) && previousQuery?.queryKey[2] === token
          && previousQuery.queryKey[3] === address
          && previousQuery.state.status === 'success') return previous
        if (onlineManager.isOnline()) return undefined
        // An offline remount may display its own last successful schema,
        // never another sign-in's cache or data predating a definitive denial.
        const cached = client.getQueryCache().findAll({ queryKey: ['meta', tableSlug(table), token, address] })
          .sort((a, b) => Math.max(b.state.dataUpdatedAt, b.state.errorUpdatedAt)
            - Math.max(a.state.dataUpdatedAt, a.state.errorUpdatedAt)
            || b.state.errorUpdatedAt - a.state.errorUpdatedAt)[0]
        return cached?.state.status === 'success' ? client.getQueryData<TableMeta>(cached.queryKey) : undefined
      },
    } : {}),
    enabled: enabled && Boolean(table),
  })
}

// Columns for a list view: Row ID first, then the Table's list columns (or
// the first two data columns when none is flagged) — a list with nobody's
// arrangement applied. #738: one definition, in list-view-columns.
export function listColumns(meta: TableMeta) {
  return viewColumns(meta, {})
}
