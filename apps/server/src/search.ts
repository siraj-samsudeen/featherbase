import { sql } from './db'
import { AppError } from './errors'
import { hasPermission } from './permissions'
import { scopedWhere } from './query'
import { tableLabel } from './access-explanation'
import { getMeta } from './meta'
import { readableTitles, recordKey } from './record-titles'
import { personLabels, type PersonLabel } from './person-labels'
import { isSensitiveColumn } from './sensitive-columns'

// UI-014: awesomebar global search. Matches row names (and the
// Table's title_column) across every regular Table the user can read.
// Results are capped small — this powers a typeahead, not a report.

export interface SearchHit {
  table: string
  row_id: string
  title: string
  /** Set only for system-registry rows: what the row IS, not where it lives. */
  kind_label?: string
  /** #1345: a Person's label (code · role · place), as the viewer may see it. */
  person?: PersonLabel
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
/** #1311: how many rows containing the text each Table ranks for its best three. */
const CANDIDATES = 500
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
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
  // As typed, starting with it, containing it: see searchOne.
  const pattern = { exact: q, prefix: escaped + '%', like: '%' + escaped + '%' }

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
  // #1345: Person and the Tables whose rows are a person's record search as one: such a row's hit
  // folds into its Person, so one human is listed once, and each Person reads its label.
  const people = readable.find((t) => t.name === 'Person')
  // The effective setting, a Metadata Override included (Codex standard round 1).
  const records: Record<string, unknown>[] = []
  if (people)
    for (const t of readable) {
      // A Table whose metadata is not available now (an app turned off) folds nothing; searchOne skips it.
      const column = t.name === 'Person' ? null : (await getMeta(String(t.name)).catch(() => null))?.person_column
      if (column) records.push({ ...t, person_column: column })
    }
  const folded = new Set(records.map((t) => t.name))
  const queue: (Record<string, unknown> | 'people')[] = [...readable.filter((t) => t !== people && !folded.has(t.name))]
  if (people) queue.unshift('people')
  // The groups go out once the plan is made, so the searches start as soon as the next line is asked for.
  yield { groups: readable.map((t) => ({ table: String(t.name), label: registryLabel(String(t.name)) ?? tableLabel(String(t.name), t.label) })) }

  // Each Table answers on its own, a few at a time, in the order they finish.
  // Each keeps at most PER_TABLE hits; the bar shows the first ones in group
  // order, so a slow Table is never crowded out by faster ones (Codex review).
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
      const work: Promise<SearchEvent[]> = t === 'people'
        ? searchPeople(people!, records, user, pattern)
        : searchOne(t, user, pattern).then((hits) => [{ table: String(t.name), hits }])
      const one: Promise<void> = work
        .then((events) => { finished.push(...events) })
        .catch((error: unknown) => { failure ??= error })
        .finally(() => { running--; started.delete(one); launch(); wake?.() })
      started.add(one)
    }
  }
  try {
    launch()
    while (running || finished.length) {
      // Every search started, failed or done, wakes this; so does an abort.
      if (!finished.length) await new Promise<void>((resolve) => { wake = resolve })
      wake = null
      if (failure) throw failure
      if (signal?.aborted) return
      while (finished.length) yield finished.shift()!
    }
    // The last Table can fail while the caller holds a yielded line: that is
    // no completed search (Codex round 5).
    if (failure) throw failure
    if (!signal?.aborted) yield { done: true }
  } finally {
    stopped = true
    signal?.removeEventListener('abort', onAbort)
    // An abandoned or failed search still waits for what it started (Codex review).
    await Promise.allSettled([...started])
  }
}

/** How many people the Person group shows: its own best three, and as many folded in. */
const PEOPLE = PER_TABLE * 2

/** #1345: Person's hits and the person-record Tables' hits, folded. A record whose person the viewer
 *  may read becomes that Person; the rest stay hits of their own Table. Each Person reads its label. */
async function searchPeople(people: Record<string, unknown>, records: Record<string, unknown>[], user: string,
  pattern: { exact: string; prefix: string; like: string }): Promise<SearchEvent[]> {
  const [own, ...found] = await Promise.all([searchOne(people, user, pattern), ...records.map((t) => searchOne(t, user, pattern))])
  const owners = await Promise.all(records.map((t, i) => personsOf(String(t.name), String(t.person_column), found[i]!.map((h) => h.row_id), user)))
  const titles = await personTitles([...new Set(owners.flatMap((m) => [...m.values()]))], user)
  const hits = new Map(own.map((h) => [h.row_id, h]))
  const events: SearchEvent[] = []
  records.forEach((t, i) => {
    const kept: SearchHit[] = []
    for (const h of found[i]!) {
      const person = owners[i]!.get(h.row_id)
      const title = person ? titles.get(person) : undefined
      if (person && title !== undefined) { if (!hits.has(person)) hits.set(person, { table: 'Person', row_id: person, title }) }
      else kept.push(h)
    }
    events.push({ table: String(t.name), hits: kept })
  })
  const listed = [...hits.values()].slice(0, PEOPLE)
  const labels = await personLabels(listed.map((h) => h.row_id), user)
  return [{ table: 'Person', hits: listed.map((h) => (labels.has(h.row_id) ? { ...h, person: labels.get(h.row_id) } : h)) }, ...events]
}

/** The person each of `rowIds` is the record of, through `column`, where the viewer may read that column. */
async function personsOf(table: string, column: string, rowIds: string[], user: string): Promise<Map<string, string>> {
  if (!rowIds.length) return new Map()
  // Only Tables the viewer may read come here (streamSearch's readable list).
  const { meta, table: physical, where, cols, readExpression } = await scopedWhere(table, user, [])
  if (!cols.has(column)) return new Map()
  const key = sql(meta.row_key)
  const rows = await sql`select ${key}::text as id, ${readExpression(column)}::text as person from ${sql(physical)}
    where ${where} and ${key}::text = any(${rowIds})`
  return new Map(rows.filter((r) => r.person).map((r) => [String(r.id), String(r.person)]))
}

/** Each person's title (their name), for the people the viewer may read and see named: their title as
 *  record-titles reads it for the viewer (none where they may not read it). An opaque id names no one
 *  (#1265), so a person named only by their id is not folded in. */
async function personTitles(ids: string[], user: string): Promise<Map<string, string>> {
  const titles = await readableTitles(ids.map((row_id) => ({ table: 'Person', row_id })), user)
  return new Map(ids.flatMap((id) => {
    const title = titles.get(recordKey({ table: 'Person', row_id: id }))
    return title && title !== id ? [[id, title] as const] : []
  }))
}

async function searchOne(t: Record<string, unknown>, user: string, { exact, prefix, like }: { exact: string; prefix: string; like: string }): Promise<SearchHit[]> {
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
  const machine = machineKeys(meta.id_pattern)
  if (!title && machine) return []
  const shown = title ? readExpression(title) : key
  // A row of machine-made keys with no title of its own (empty, or hidden from
  // this viewer) would read as its key: it is no hit either (Codex round 4).
  const named = machine ? sql`and nullif(trim(${shown}::text), '') is not null` : sql``
  // #1311: each Table answers its best three: named or coded exactly as typed,
  // then starting with it, then the shortest. Ranking runs over a bounded set of
  // candidates, the first CANDIDATES rows containing the text plus the row whose
  // code is exactly the text (a primary-key lookup), so the database still stops
  // early on a common query and an exact code is never crowded out. (Codex:
  // round 1 flagged sorting every match, round 2 sequential scans and limiting
  // before ranking; round 3: the exact code comes before exact names.)
  // #1346: and the Table's own searched columns, each only where this viewer
  // may read it (readExpression hides a creator-only value), so a hit never
  // tells a viewer about a value they cannot see.
  const searched = (meta.search_columns ?? []).filter((c) => c !== meta.title_column && cols.has(c) && !isSensitiveColumn(c))
  const match = (pattern: string) => sql`(${key} ilike ${pattern}${title ? sql` or ${readExpression(title)} ilike ${pattern}` : sql``}${searched.reduce((more, c) => sql`${more} or ${readExpression(c)}::text ilike ${pattern}`, sql``)})`
  const found = sql`${where} ${live} and coalesce(${shown}::text, ${key}::text) !~ ${OPAQUE_ID} ${named}`
  const rows = await sql<{ row_id: unknown; title: unknown }[]>`
    select row_id, title from (
      (select ${key} as row_id, ${shown} as title from ${sql(table)} where ${found} and ${match(like)} limit ${CANDIDATES})
      union
      (select ${key} as row_id, ${shown} as title from ${sql(table)} where ${found} and ${key} = ${exact})
    ) candidate
    order by
      case when row_id::text = ${exact} then 0
           when lower(row_id::text) = lower(${exact}) or lower(title::text) = lower(${exact}) then 1
           when row_id::text ilike ${prefix} or title::text ilike ${prefix} then 2 else 3 end,
      length(coalesce(title::text, row_id::text)), coalesce(title::text, row_id::text), row_id::text
    limit ${PER_TABLE}`
  return rows
    .map((row) => ({
      table: meta.name,
      row_id: String(row.row_id),
      title: String(row.title ?? row.row_id),
      ...(registryLabel(meta.name) ? { kind_label: registryLabel(meta.name) } : {}),
    }))
}
