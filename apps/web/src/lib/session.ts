import { useQuery } from '@tanstack/react-query'
import { api, getSessionUser } from './api'

// Current session identity + roles, resolved from the server (whoami) and
// cached. Used to gate role-only UI like the SET-003 permission manager.
interface WhoAmI {
  name: string
  email: string
  full_name: string | null
  roles: string[]
  theme?: 'light' | 'dark'
  palette?: 'classic' | 'ivory' | 'graphite' | 'indigo'
  language?: string
  // True on a dev-preview deployment. The shell says so out loud: anyone
  // handed the link should know the data is disposable.
  preview?: boolean
}

export function useWhoAmI() {
  return useQuery({
    queryKey: ['whoami'],
    queryFn: () => api.get<WhoAmI>('/api/whoami'),
    staleTime: 5 * 60_000,
    // Signed out there is nothing to ask — and an anonymous whoami would ride
    // the sid cookie (if one survives) and answer as the previous user.
    enabled: Boolean(getSessionUser()),
  })
}

export function useIsPreview(): boolean {
  return useWhoAmI().data?.preview ?? false
}

export function useIsSystemManager(): boolean {
  const q = useWhoAmI()
  return q.data?.roles?.includes('System Manager') ?? false
}
