import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// person-rename: a person's id is opaque (`psn_…`), so a screen never shows
// it where a name exists. Names are fetched in batches — every name asked
// for in the same tick goes in one POST /api/people/names.

const OPAQUE = /^(psn|svc)_[a-z2-7]{20}$/

export function isOpaqueId(id: string): boolean {
  return OPAQUE.test(id)
}

let queued: Map<string, ((name: string | null) => void)[]> | null = null

function flush() {
  const batch = queued!
  queued = null
  api
    .post<{ names: Record<string, string | null> }>('/api/people/names', { ids: [...batch.keys()] })
    .then(({ names }) => {
      for (const [id, resolvers] of batch) for (const r of resolvers) r(names[id] ?? null)
    })
    .catch(() => {
      for (const resolvers of batch.values()) for (const r of resolvers) r(null)
    })
}

function loadName(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!queued) {
      queued = new Map()
      setTimeout(flush, 0)
    }
    queued.set(id, [...(queued.get(id) ?? []), resolve])
  })
}

/** The display name for a principal id: null while loading or when it has
 *  none. Ids that are not opaque (Administrator, Guest) are their own name. */
export function usePrincipalName(id: string | null | undefined): string | null {
  const opaque = Boolean(id && isOpaqueId(id))
  const q = useQuery({
    queryKey: ['principal-name', id],
    enabled: opaque,
    staleTime: 5 * 60_000,
    queryFn: () => loadName(id!),
  })
  if (!id) return null
  if (!opaque) return id
  return q.data ?? null
}

/** What to show for a principal: its name; while loading "…"; with no name
 *  at all a neutral "Unnamed person" — never the opaque id. */
export function principalLabel(id: string, name: string | null, loading: boolean): string {
  if (name) return name
  if (!isOpaqueId(id)) return id
  return loading ? '…' : 'Unnamed person'
}

export function PrincipalName({ id }: { id: string }) {
  const name = usePrincipalName(id)
  const loading = isOpaqueId(id) && name === null
  return <span data-testid="principal-name" title={name ?? undefined}>{principalLabel(id, name, loading)}</span>
}
