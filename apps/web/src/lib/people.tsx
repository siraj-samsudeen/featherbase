import { useQueries, useQuery } from '@tanstack/react-query'
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
    .catch(
      () => {
        for (const resolvers of batch.values()) for (const r of resolvers) r(null)
      },
    )
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

/** A principal id's display name and whether it is still being fetched.
 *  Ids that are not opaque (Administrator, Guest) are their own name. */
export function usePrincipalNameState(id: string | null | undefined): { name: string | null; loading: boolean } {
  const opaque = Boolean(id && isOpaqueId(id))
  const q = useQuery({
    queryKey: ['principal-name', id],
    enabled: opaque,
    staleTime: 5 * 60_000,
    queryFn: () => loadName(id!),
  })
  if (!id) return { name: null, loading: false }
  if (!opaque) return { name: id, loading: false }
  return { name: q.data ?? null, loading: q.isLoading }
}

/** The display name for a principal id: null while loading or when it has none. */
export function usePrincipalName(id: string | null | undefined): string | null {
  return usePrincipalNameState(id).name
}

/** What to show for a principal: its name; while loading "…"; with no name
 *  at all a neutral "Unnamed person" — never the opaque id. */
export function principalLabel(id: string, name: string | null, loading: boolean): string {
  if (name) return name
  if (!isOpaqueId(id)) return id
  return loading ? '…' : 'Unnamed person'
}

/** Labels for many principal ids at once — for text that can't hold a
 *  component, such as a list's checkbox names. Text that is not an opaque id
 *  reads as itself. */
export function usePrincipalLabels(ids: readonly string[]): (id: string) => string {
  const opaque = [...new Set(ids.filter(isOpaqueId))]
  const results = useQueries({
    queries: opaque.map((id) => ({ queryKey: ['principal-name', id], staleTime: 5 * 60_000, queryFn: () => loadName(id) })),
  })
  const byId = new Map(opaque.map((id, i) => [id, results[i]]))
  return (id) => {
    const q = byId.get(id)
    return q ? principalLabel(id, q.data ?? null, q.isLoading) : id
  }
}

export function PrincipalName({ id }: { id: string }) {
  // "…" only while the name is actually being fetched; a person with no
  // name, or one this viewer may not read, is "Unnamed person".
  const { name, loading } = usePrincipalNameState(id)
  return <span data-testid="principal-name" title={name ?? undefined}>{principalLabel(id, name, loading)}</span>
}

/** A record name as a person would read it: a principal's name for an opaque
 *  id (#414), the text itself for anything else. */
export function ShownName({ id }: { id: string }) {
  return isOpaqueId(id) ? <PrincipalName id={id} /> : <>{id}</>
}
