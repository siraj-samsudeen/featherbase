import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** The server's answer: `waiting` once an admin has been told (#955); `elsewhere` when the person
 *  belongs in the app at `home`, and nobody was told; `declined` once an admin declined it (#1173). */
export interface AccessAnswer {
  state: 'open' | 'waiting' | 'elsewhere' | 'apps' | 'declined'
  title: string
  home?: string
  /** `apps`: the apps they can open, each open to everyone; nobody was told. */
  apps?: { name: string; title: string; href: string }[]
}

/**
 * #955: a page that finds the person has no access to `app` says so to the
 * server: opening it is the request, so there is no button. Asked once per
 * opening; `waiting` means an admin has been told. Undefined while the answer
 * is on its way, so a page shows nothing it may have to take back; null when
 * asking failed.
 */
export function useAccessRequest(app: string, enabled = true): AccessAnswer | null | undefined {
  const asked = useQuery({
    queryKey: ['access-request', app],
    enabled,
    gcTime: 0,
    retry: false,
    queryFn: () => api.post<AccessAnswer>('/api/access_request', { app }),
  })
  return asked.isError ? null : asked.data
}
