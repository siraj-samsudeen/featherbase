import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { ShownName } from './people'
import { displayEntry, type RecentAction } from './recents'

// Home cleanup: a referenced row reads as its title — the Table's title
// column, or a readable stand-in from its values (rowDisplayTitle in shared)
// — never its internal id. Titles are fetched in batches, like person names
// (people.tsx): every title asked for in the same tick goes in one POST.

type Ref = { table: string; row_id: string }
const keyOf = (r: Ref) => `${r.table}\u0000${r.row_id}`

let queued: Map<string, { ref: Ref; resolvers: ((title: string | null) => void)[] }> | null = null

function flush() {
  const batch = queued!
  queued = null
  const refs = [...batch.values()].map((b) => b.ref)
  api
    .post<{ titles: Array<Ref & { title: string }> }>('/api/row_titles', { rows: refs })
    .then(({ titles }) => {
      const found = new Map(titles.map((t) => [keyOf(t), t.title]))
      for (const [k, b] of batch) for (const r of b.resolvers) r(found.get(k) ?? null)
    })
    .catch(
      /* istanbul ignore next -- network failure only: the request itself rejected (no answer), which no suite can produce against the in-process server or the e2e stack without stubbing fetch; the batches pages send (a heading, a breadcrumb, up to three recents) are always within what the server accepts */
      () => {
        for (const b of batch.values()) for (const r of b.resolvers) r(null)
      },
    )
}

function loadTitle(ref: Ref): Promise<string | null> {
  return new Promise((resolve) => {
    if (!queued) {
      queued = new Map()
      setTimeout(flush, 0)
    }
    const k = keyOf(ref)
    const entry = queued.get(k) ?? { ref, resolvers: [] }
    entry.resolvers.push(resolve)
    queued.set(k, entry)
  })
}

/** The row's display title, or null while loading / when it cannot be read. */
function useRowTitle(table: string | undefined, rowId: string | undefined): string | null {
  const q = useQuery({
    queryKey: ['row-title', table, rowId],
    enabled: Boolean(table && rowId),
    staleTime: 5 * 60_000,
    queryFn: () => loadTitle({ table: table!, row_id: rowId! }),
  })
  return q.data ?? null
}

/** A row as a person reads it; until a title arrives (or if none can be
 *  read) the id, with a principal's name for an opaque person id. */
export function RowTitle({ table, rowId }: { table: string; rowId: string }) {
  const title = useRowTitle(table, rowId)
  return title ? <>{title}</> : <ShownName id={rowId} />
}

/** The label of any remembered destination: a row's title, a fixed page's
 *  catalog title, or the recorded label. */
export function EntryLabel({ entry }: { entry: Pick<RecentAction, 'key' | 'label' | 'path'> & { kind?: RecentAction['kind']; sub?: string } }) {
  const shown = displayEntry(entry)
  return shown.row ? <RowTitle table={shown.row.table} rowId={shown.row.rowId} /> : <ShownName id={shown.label} />
}
