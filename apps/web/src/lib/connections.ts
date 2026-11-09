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

/** The one query for a row's counted backlinks. */
export function connectionsQuery(table: string, name: string) {
  return {
    queryKey: ['connections', table, name],
    queryFn: () =>
      api.get<{ connections: Connection[] }>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:connections`,
      ),
  }
}

export function useConnections(table: string, name: string, enabled = true) {
  return useQuery({
    ...connectionsQuery(table, name),
    enabled: enabled && Boolean(table) && Boolean(name) && name !== 'new',
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
