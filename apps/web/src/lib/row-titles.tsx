import { useQueries, useQuery } from '@tanstack/react-query'
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

// The server takes at most this many rows per request; a full Explore pane
// asks for more than that in one tick.
const MAX_PER_REQUEST = 100

function flush() {
  const entries = [...queued!.entries()]
  queued = null
  for (let i = 0; i < entries.length; i += MAX_PER_REQUEST) {
    const batch = entries.slice(i, i + MAX_PER_REQUEST)
    api
      .post<{ titles: Array<Ref & { title: string }> }>('/api/row_titles', { rows: batch.map(([, b]) => b.ref) })
      .then(({ titles }) => {
        const found = new Map(titles.map((t) => [keyOf(t), t.title]))
        for (const [k, b] of batch) for (const r of b.resolvers) r(found.get(k) ?? null)
      })
      .catch(() => {
        for (const [, b] of batch) for (const r of b.resolvers) r(null)
      })
  }
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

const TITLE_STALE = 5 * 60_000

/** The one query for a row's title: null when the viewer cannot read it. */
export function rowTitleQuery(table: string, rowId: string) {
  return {
    queryKey: ['row-title', table, rowId],
    staleTime: TITLE_STALE,
    queryFn: () => loadTitle({ table, row_id: rowId }),
  }
}

/** The row's display title, or null while loading / when it cannot be read. */
export function useRowTitle(table: string | undefined, rowId: string | undefined): string | null {
  const q = useQuery({ ...rowTitleQuery(table ?? '', rowId ?? ''), enabled: Boolean(table && rowId) })
  return q.data ?? null
}

type Destination = Pick<RecentAction, 'key' | 'label' | 'path'> & { kind?: RecentAction['kind']; sub?: string }

/**
 * #898: history outlives rows. Of these remembered destinations, the keys
 * still worth offering: every one that is not a row, and each row the server
 * still has a title for, for this reader (row_titles answers for those alone).
 * Null until the server has answered for every row, so a deleted row never
 * flashes. It shares the title cache, so the label costs no second request.
 */
export function useLiveDestinations(entries: Destination[]): Set<string> | null {
  const rows = [...new Map(entries.flatMap((e) => {
    const row = displayEntry(e).row
    return row ? [[e.key, { key: e.key, ...row }] as const] : []
  })).values()]
  const titles = useQueries({
    queries: rows.map((r) => rowTitleQuery(r.table, r.rowId)),
  })
  if (titles.some((q) => q.data === undefined)) return null
  const gone = new Set(rows.filter((_, i) => titles[i].data === null).map((r) => r.key))
  return new Set(entries.map((e) => e.key).filter((key) => !gone.has(key)))
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
