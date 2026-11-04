import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// Relational navigation (#100): client hooks over the server's derived
// reverse-reference map. `Connection` mirrors the :connections row action —
// `filters` is ready to drop into /admin/$table?filters= as-is.

export type Filter = [string, string, unknown]

export interface Connection {
  table: string
  column: string
  via: string | null
  count: number
  filters: Filter[]
  // #432: rows of that Table are written by the platform alone.
  system_written?: boolean
}

export interface Backlink {
  table: string
  column: string
  via: string | null
}

export function useConnections(table: string, name: string, enabled = true) {
  return useQuery({
    queryKey: ['connections', table, name],
    enabled: enabled && Boolean(table) && Boolean(name) && name !== 'new',
    queryFn: () =>
      api.get<{ connections: Connection[] }>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:connections`,
      ),
  })
}

export function useBacklinks(table: string, enabled = true) {
  return useQuery({
    queryKey: ['backlinks', table],
    enabled: enabled && Boolean(table),
    staleTime: 60_000,
    queryFn: () =>
      api.get<{ backlinks: Backlink[] }>(`/api/table/${encodeURIComponent(table)}:backlinks`),
  })
}

// Include the Reference column even on the first path so multiple direct or
// via-sub-table relationships to the same Table remain distinguishable.
export function connectionLabel(c: { table: string; column: string; via: string | null }): string {
  if (c.via) return `${c.table} · via ${c.via} / ${c.column}`
  return `${c.table} · ${c.column}`
}
