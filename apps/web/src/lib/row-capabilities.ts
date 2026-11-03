import { queryOptions, useQuery } from '@tanstack/react-query'
import type { RowCapabilities } from 'shared'
import { api, getSessionUser } from './api'

export function rowCapabilitiesQuery(table: string, name: string, revision?: unknown) {
  return queryOptions({
    queryKey: ['row-capabilities', getSessionUser()?.row_id, table, name, revision],
    queryFn: () => api.get<RowCapabilities>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}:capabilities`),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

/** Fresh display advice. Writes still go through their authoritative checks. */
export function useRowCapabilities(table: string, name: string, enabled = true, revision?: unknown) {
  return useQuery({
    ...rowCapabilitiesQuery(table, name, revision),
    enabled,
    // A saved revision must not unmount the row's mounted panels/drafts while
    // advice refreshes. Never carry advice across a different row or identity.
    placeholderData: (previous, query) => query !== undefined && query.queryKey[1] === getSessionUser()?.row_id
      && query.queryKey[2] === table && query.queryKey[3] === name ? previous : undefined,
  })
}
