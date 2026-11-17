import { useQueries, useQuery, type QueryClient } from '@tanstack/react-query'
import { SYSTEM_ACTOR_LABELS } from 'shared'
import { RecordLink } from '@featherbase/shop-floor'
import { api } from './api'
import { useCapabilities } from './session'

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

// #1224: who made, changed, retired or archived rows of a Table, named by the
// server when the viewer may read those rows (POST /api/people/actor_names),
// even without Person read. Batched per Table like the names above.
const actorQueues = new Map<string, Map<string, ((name: string | null) => void)[]>>()

function loadActorName(table: string, id: string): Promise<string | null> {
  return new Promise((resolve) => {
    let queue = actorQueues.get(table)
    if (!queue) {
      queue = new Map()
      actorQueues.set(table, queue)
      setTimeout(() => {
        const batch = actorQueues.get(table)!
        actorQueues.delete(table)
        api.post<{ names: Record<string, string | null> }>('/api/people/actor_names', { table, ids: [...batch.keys()] })
          .then(({ names }) => { for (const [i, rs] of batch) for (const r of rs) r(names[i] ?? null) })
          .catch(() => { for (const rs of batch.values()) for (const r of rs) r(null) })
      }, 0)
    }
    queue.set(id, [...(queue.get(id) ?? []), resolve])
  })
}

/** After a principal is renamed: drop every cached name for them, the plain
 *  lookup and each Table's actor lookup (#1224), so every surface reads anew. */
export function invalidatePrincipalName(client: QueryClient, id: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['principal-name', id] }),
    client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'actor-name' && q.queryKey[2] === id }),
  ])
}

/** A principal id's display name and whether it is still being fetched.
 *  With `actorOf`, the id is who acted on rows of that Table (#1224).
 *  Ids that are not opaque (Administrator, Guest) are their own name. */
export function usePrincipalNameState(id: string | null | undefined, actorOf?: string): { name: string | null; loading: boolean } {
  const opaque = Boolean(id && isOpaqueId(id))
  const q = useQuery({
    queryKey: actorOf ? ['actor-name', actorOf, id] : ['principal-name', id],
    enabled: opaque,
    staleTime: 5 * 60_000,
    queryFn: () => (actorOf ? loadActorName(actorOf, id!) : loadName(id!)),
  })
  if (!id) return { name: null, loading: false }
  if (!opaque) return { name: SYSTEM_ACTOR_LABELS[id] ?? id, loading: false }
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
  if (!isOpaqueId(id)) return SYSTEM_ACTOR_LABELS[id] ?? id
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

export function PrincipalName({ id, actorOf }: { id: string; actorOf?: string }) {
  // "…" only while the name is actually being fetched; a person with no
  // name, or one this viewer may not read, is "Unnamed person". With
  // `actorOf`, who acted on that Table's rows is named to anyone who may
  // read those rows (#1224).
  const { name, loading } = usePrincipalNameState(id, actorOf)
  return <span data-testid="principal-name" title={name ?? undefined}>{principalLabel(id, name, loading)}</span>
}

/** #1264: the Table a principal is a record of: a person's Person row, a
 *  service account's Service Account row; the system's own actors (jobs, steps)
 *  are no record. */
export function principalTable(id: string): 'Person' | 'Service Account' | null {
  if (id === 'Administrator' || id.startsWith('psn_')) return 'Person'
  if (id.startsWith('svc_')) return 'Service Account'
  return null
}

/** #1264, "every record shown is a RecordLink": a person or service account
 *  named and linked to their record for a viewer who may open it, plain words
 *  otherwise; a system actor reads as its phrase. `name` is one the server
 *  already gave (#1224); without it the name is looked up. Never inside
 *  another link: there PrincipalName draws the words alone. */
export function PrincipalLink({ id, name: given, actorOf }: { id: string; name?: string | null; actorOf?: string }) {
  const caps = useCapabilities()
  const looked = usePrincipalNameState(given ? null : id, actorOf)
  const name = given || looked.name
  const table = principalTable(id)
  if (!table || !name) {
    if (given) return <span data-testid="principal-name" title={given}>{given}</span>
    // A system actor, or plain text that is no principal, reads as its words alone.
    if (!isOpaqueId(id)) return <>{SYSTEM_ACTOR_LABELS[id] ?? id}</>
    return <PrincipalName id={id} actorOf={actorOf} />
  }
  return (
    <span data-testid="principal-name">
      <RecordLink table={table} rowId={id} name={name} canOpen={Boolean(caps && (caps.manage || caps.tables.includes(table)))} />
    </span>
  )
}

/** #1224: who did something. The server names the actor with the payload
 *  (a person's display name even when this viewer may not read Person, a
 *  service account as "Automation (…)", a system step as a phrase); without
 *  that name it falls back to the viewer's own lookup. #1264: a link to them. */
export function ActorName({ id, name }: { id: string; name?: string | null }) {
  return <PrincipalLink id={id} name={name} />
}

/** A record name as a person would read it: a principal's name for an opaque
 *  id (#414), the text itself for anything else. */
export function ShownName({ id, actorOf }: { id: string; actorOf?: string }) {
  return isOpaqueId(id) ? <PrincipalName id={id} actorOf={actorOf} /> : <>{id}</>
}
