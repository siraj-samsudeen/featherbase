import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** The server's answer: `waiting` once an admin has been told (#955); `elsewhere` when the person
 *  belongs in the app at `home`, and nobody was told. */
export interface AccessAnswer {
  state: 'open' | 'waiting' | 'elsewhere'
  title: string
  home?: string
}

/**
 * #955: a page that finds the person has no access to `app` says so to the
 * server: opening it is the request, so there is no button. Asked once per
 * opening; `waiting` means an admin has been told.
 */
export function useAccessRequest(app: string, enabled = true): AccessAnswer | undefined {
  return useQuery({
    queryKey: ['access-request', app],
    enabled,
    gcTime: 0,
    retry: false,
    queryFn: () => api.post<AccessAnswer>('/api/access_request', { app }),
  }).data
}
