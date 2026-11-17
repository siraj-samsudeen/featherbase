import { sql } from './db'
import { AppError } from './errors'
import { hasPermission } from './permissions'
import { scopedWhere } from './query'
import { tableLabel } from './access-explanation'

// UI-014: awesomebar global search. Matches row names (and the
// Table's title_column) across every regular Table the user can read.
// Results are capped small — this powers a typeahead, not a report.

export interface SearchHit {
  table: string
  row_id: string
  title: string
  /** Set only for system-registry rows: what the row IS, not where it lives. */
  kind_label?: string
}

// #431: rows of these engine registries describe structure, not business data.
// Without a label, "Activity Log · row in Table" read like a duplicate of the
// Tables entry for Activity Log. They also rank after ordinary records.
const REGISTRY_LABELS: Record<string, string> = {
  Table: 'Table definition',
  Column: 'Column definition',
  'Custom Field': 'Custom field definition',
  Permission: 'Permission rule',
  'Data Scope': 'Data scope rule',
  'Metadata Override': 'Metadata override',
}

// Own keys only: a user Table named `constructor` is not a registry.
export const registryLabel = (name: string): string | undefined =>
  Object.hasOwn(REGISTRY_LABELS, name) ? REGISTRY_LABELS[name] : undefined

const PER_TABLE = 3
/** How many Tables are searched at once (#1265). */
const AT_ONCE = 6
/** #1265: a person's or service account's opaque id names no one (Postgres pattern). */
const OPAQUE_ID = '^(psn|svc)_[a-z2-7]{20}$'

/** #1265: a Table whose keys the machine makes (a hash like an Activity Log
 *  row's "c1aad020aa9b533c", a counter, an opaque id) names nothing by them.
 *  A code people give (prompt, a field, a series like TASK-00012) is a name. */
const machineKeys = (idPattern: unknown) => {
  const p = String(idPattern ?? '')
  return p === 'hash' || p === 'integer' || p.startsWith('opaque:')
}

/** #1265: what the search sends, one line at a time. First the groups it will
 *  search, by label, in the order they show; then each group as its Table
 *  answers (hits, or none); then done. */
export type SearchEvent =
  | { groups: { table: string; label: string }[] }
  | { table: string; hits: SearchHit[] }
  | { done: true }

export async function* streamSearch(query: string, user: string, signal?: AbortSignal): AsyncGenerator<SearchEvent> {
  const q = query.trim()
  if (!q) {
    yield { groups: [] }
    yield { done: true }
    return
  }
  const like = '%' + q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'

  // Source-bound Tables are excluded: they have no physical table here (the
  // old query 500'd the whole search the moment one existed), and fanning a
  // per-keystroke ilike out to every foreign store is not a typeahead's job.
  // #1041: an archived Table is out of everyday use, so out of search too.
  const tables = await sql`
    select name, owner_app, label from table_def where kind = 'table' and data_source is null and archived_at is null
    order by name`
  // Stable sort: ordinary Tables first, registries last (#431).
  const isRegistry = (n: unknown) => (registryLabel(String(n)) ? 1 : 0)
  tables.sort((a, b) => isRegistry(a.name) - isRegistry(b.name))
  const readable = []
  for (const t of tables) if (await hasPermission(user, t.name as string, 'read')) readable.push(t)
  yield { groups: readable.map((t) => ({ table: String(t.name), label: registryLabel(String(t.name)) ?? tableLabel(String(t.name), t.label) })) }

  // Each Table answers on its own, a few at a time, in the order they finish.
  // Each keeps at most PER_TABLE hits; the bar shows the first ones in group
  // order, so a slow Table is never crowded out by faster ones (Codex review).
  const queue = [...readable]
  const finished: SearchEvent[] = []
  // Every search started, so none outlives the lifecycle lock the caller holds.
  const started = new Set<Promise<unknown>>()
  let wake: (() => void) | null = null
  let running = 0
  let failure: unknown = null
  // A client that went away, or a Table that failed, launches nothing more.
  let stopped = false
  const halted = () => stopped || failure !== null || Boolean(signal?.aborted)
  const onAbort = () => wake?.()
  signal?.addEventListener('abort', onAbort)
  const launch = () => {
    while (!halted() && running < AT_ONCE && queue.length) {
      const t = queue.shift()!
      running++
      const one: Promise<void> = searchOne(t, user, like)
        .then((hits) => { finished.push({ table: String(t.name), hits }) })
        .catch((error: unknown) => { failure ??= error })
        .finally(() => { running--; started.delete(one); launch(); wake?.() })
      started.add(one)
    }
  }
  try {
    launch()
    while (running || finished.length) {
      if (failure) throw failure
      if (signal?.aborted || stopped) return
      if (!finished.length) await new Promise<void>((resolve) => { wake = resolve })
      wake = null
      if (failure) throw failure
      if (signal?.aborted) return
      while (finished.length) yield finished.shift()!
    }
    if (failure) throw failure
    if (!signal?.aborted) yield { done: true }
  } finally {
    stopped = true
    signal?.removeEventListener('abort', onAbort)
    // An abandoned or failed search still waits for what it started (Codex review).
    await Promise.allSettled([...started])
  }
}

async function searchOne(t: Record<string, unknown>, user: string, like: string): Promise<SearchHit[]> {
  // #648: an app's Tables answer only while it is available to this
  // request: switched on, not awaiting activation, and the version the
  // client last loaded. When one refuses, search skips that Table instead
  // of failing for everyone; assertAppAvailable stays the one judge.
  const scoped = await scopedWhere(t.name as string, user, []).catch((error: unknown) => {
    if (t.owner_app != null && error instanceof AppError &&
        (error.type === 'PermissionError' || error.type === 'ConflictError')) return null
    throw error
  })
  if (!scoped) return []
  const { meta, table, where, cols, readExpression } = scoped
  const title = meta.title_column && cols.has(meta.title_column) ? meta.title_column : null
  // The wire key is always `row_id`; `Table` alone stores it as `name`.
  const key = sql(meta.row_key)
  // #1041: an archived Table's own definition is out of search with its rows.
  const live = meta.name === 'Table' ? sql`and archived_at is null` : sql``
  // An untitled Table names its rows by their keys; machine-made keys name
  // nothing, so such a Table gives no hits (decided before any LIMIT).
  if (!title && machineKeys(meta.id_pattern)) return []
  const shown = title ? readExpression(title) : key
  const rows = await sql`
    select ${key} as row_id, ${shown} as title from ${sql(table)}
    where ${where} ${live} and (${key} ilike ${like}${title ? sql` or ${readExpression(title)} ilike ${like}` : sql``})
      and coalesce(${shown}::text, ${key}::text) !~ ${OPAQUE_ID}
    limit ${PER_TABLE}`
  return rows
    .map((row) => ({
      table: meta.name,
      row_id: String(row.row_id),
      title: String(row.title ?? row.row_id),
      ...(registryLabel(meta.name) ? { kind_label: registryLabel(meta.name) } : {}),
    }))
}
