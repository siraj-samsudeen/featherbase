import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// Relational navigation (#100): client hooks over the server's derived
// reverse-reference map. `Connection` mirrors the :connections row action —
// `filters` is ready to drop into /admin/$doctype?filters= as-is.

export type Filter = [string, string, unknown]

export interface Connection {
  table: string
  column: string
  via: string | null
  count: number
  filters: Filter[]
}

export interface Backlink {
  table: string
  column: string
  via: string | null
}

export function useConnections(doctype: string, name: string, enabled = true) {
  return useQuery({
    queryKey: ['connections', doctype, name],
    enabled: enabled && Boolean(doctype) && Boolean(name) && name !== 'new',
    queryFn: () =>
      api.get<{ connections: Connection[] }>(
        `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}:connections`,
      ),
  })
}

export function useBacklinks(doctype: string, enabled = true) {
  return useQuery({
    queryKey: ['backlinks', doctype],
    enabled: enabled && Boolean(doctype),
    staleTime: 60_000,
    queryFn: () =>
      api.get<{ backlinks: Backlink[] }>(`/api/table/${encodeURIComponent(doctype)}:backlinks`),
  })
}

// The display label for a connection/backlink group. The via-sub-table case
// reads "Purchase Order · via PO Line"; a second Reference column into the
// same table disambiguates as "Employee · reports_to".
export function connectionLabel(c: { table: string; column: string; via: string | null }): string {
  if (c.via) return `${c.table} · via ${c.via}`
  return c.table
}
