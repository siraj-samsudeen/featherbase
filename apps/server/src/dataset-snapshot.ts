import { randomUUID } from 'node:crypto'
import { sql } from './db'
import { enqueue, type JobTrigger } from './jobs'
import { errorMessage } from './errors'
import { boundToStandIn } from './dataset-bindings'

// Query-grained analytical dataset snapshots — the read side of
// openspec/changes/query-grained-dataset-snapshots (data-warehouse), against the
// provider contract in siraj-samsudeen#281.
//
// A dataset is the published report query MINUS its personalisation predicate,
// materialised once and read by everyone. Each reader's slice stays a predicate
// evaluated at read time, so a role or assignment change takes effect on the
// next read with nothing rebuilt — and, unlike a pre-rendered artifact, there is
// a principal in context when the rows are selected.
//
// Lifecycle, per #281: build candidate -> validate -> atomically activate ->
// retain last good -> report freshness. `state` carries it. A build that dies
// halfway leaves its row in 'building', which `activeSnapshot` never resolves,
// so an interrupted refresh is quarantined by construction.
//
// The registry (`Dataset Snapshot`, `Dataset Miss`) is two system Tables since
// migration 0087 — visible in the Admin to System Managers, with Version
// history — while the per-dataset ROWS tables stay raw and app-internal, because
// they hold every store's figures and generic row scoping is fail-open (#246).

interface DatasetDefinition<Row = unknown[]> {
  name: string
  /** Bump when the SQL changes: it is part of snapshot identity, so a redefinition never silently reuses old rows. */
  version: string
  /** #1409 (D4): the identity of a stand-in for this dataset: its columns,
   *  keys and scope mapping, without the query, so a corrected query keeps the
   *  stand-in and a changed column retires it. */
  shapeVersion: string
  /** Pull the superset from the source. `sourceAsOf` is the warehouse's own as-of, never the build time. */
  fetch: () => Promise<{ rows: Row[]; sourceAsOf: string | null }>
  /** Write the fetched rows under this snapshot id. Returns the row count written. */
  load: (snapshotId: string, rows: Row[]) => Promise<number>
  /** Last gate before activation, once the candidate's rows are loaded under
   *  `snapshotId`. Return a reason to refuse, or null to accept. */
  validate?: (rowCount: number, previous: SnapshotRecord | null, snapshotId: string) => string | null | Promise<string | null>
  /** Bytes this snapshot's rows occupy, for the registry. Optional: a dataset that cannot say leaves it null. */
  sizeOf?: (snapshotId: string) => Promise<number>
}

export interface SnapshotRecord {
  row_id: string
  dataset: string
  definition_version: string
  source_as_of: string | null
  built_at: string
  /** When this snapshot became the one readers resolve. Null while building. */
  activated_at: string | null
  row_count: number | null
  state: string
  bytes: number | null
  fetch_ms: number | null
  load_ms: number | null
  triggered_by: string | null
  /** #1409: these rows were loaded from a file, not read from the source. */
  stand_in: boolean
  /** Who loaded a stand-in; the platform's own name on a refresh. */
  created_by: string
}

const registry = new Map<string, DatasetDefinition<never>>()

export function registerDataset<Row = unknown[]>(def: DatasetDefinition<Row>): void {
  registry.set(def.name, def as unknown as DatasetDefinition<never>)
}

/** #625: an app's dataset leaves with the app version that declared it. */
export function unregisterDataset(name: string): void {
  registry.delete(name)
}

export function registeredDatasets(): string[] {
  return [...registry.keys()]
}

/**
 * Normalise a DATE to its ISO day. The pg client hands DATE back as a Date, and
 * `String(new Date(...))` is "Thu Sep 17 2026 ..." — slicing that yields "Thu Sep 17",
 * which is neither ISO nor ADR 844's DD-Mon-YYYY. Normalising here means every
 * caller gets one shape from one place.
 */
function isoDay(v: Date | null): string | null {
  return v == null ? null : v.toISOString().slice(0, 10)
}

/**
 * The one snapshot a reader may use, or null when the dataset has never built
 * UNDER ITS CURRENT DEFINITION. `state = 'active'` alone is not enough:
 * deploying a new `DatasetDefinition.version` (a real shape change — new
 * columns, a different grain) with the old snapshot still 'active' must not
 * serve that old shape as a normal hit just because nothing has failed
 * (review, 19-Sep-2026). Falling through to null routes the caller to the
 * existing live-and-record-a-miss path (`reportFor`), which is exactly the
 * "dataset has never built" behaviour this reuses rather than inventing a
 * second code path for it.
 */
export async function activeSnapshot(dataset: string): Promise<SnapshotRecord | null> {
  // A dataset with no registered definition has no current version, so no
  // snapshot qualifies (`= null` matches nothing). #1409 (D4): a stand-in is
  // held to the dataset's shape, a refreshed copy to its whole definition.
  const def = registry.get(dataset)
  const [row] = await sql`
    select row_id, dataset, definition_version, source_as_of, built_at, activated_at, row_count, state,
           bytes, fetch_ms, load_ms, triggered_by, stand_in, created_by
    from dataset_snapshot
    where dataset = ${dataset} and state = 'active'
      and definition_version = case when stand_in then ${def?.shapeVersion ?? null} else ${def?.version ?? null} end`
  if (!row) return null
  return {
    ...(row as unknown as SnapshotRecord),
    source_as_of: isoDay(row.source_as_of as Date | null),
    row_count: row.row_count == null ? null : Number(row.row_count),
    bytes: row.bytes == null ? null : Number(row.bytes),
    fetch_ms: row.fetch_ms == null ? null : Number(row.fetch_ms),
    load_ms: row.load_ms == null ? null : Number(row.load_ms),
  }
}

/**
 * #1409: the copy a dataset last had from its source under `version`, kept
 * aside while a stand-in serves (pruneSnapshots), or null when it never had
 * one. It is what the first refresh after a stand-in is compared with.
 */
async function lastRealSnapshot(dataset: string, version: string): Promise<SnapshotRecord | null> {
  const [row] = await sql`
    select row_id, dataset, definition_version, source_as_of, built_at, activated_at, row_count, state,
           bytes, fetch_ms, load_ms, triggered_by, stand_in, created_by
    from dataset_snapshot
    where dataset = ${dataset} and state = 'superseded' and not stand_in and definition_version = ${version}
    order by activated_at desc limit 1`
  return (row as unknown as SnapshotRecord | undefined) ?? null
}

/**
 * Publish-before-cache: a report whose dataset has not built yet serves live and
 * records the ask here. The worker materialises what was actually asked for, so
 * nothing stands between authoring a report and serving it — no registry line,
 * no window, no cadence chosen by hand.
 */
export async function recordMiss(dataset: string): Promise<void> {
  await sql`
    insert into dataset_miss (row_id, dataset, first_seen, last_seen, hits)
    values (${randomUUID()}, ${dataset}, now(), now(), 1)
    on conflict (dataset) do update set last_seen = now(), hits = dataset_miss.hits + 1, updated_at = now()`

  // Wake the refresh worker NOW rather than waiting for its next interval.
  // Without this the promise that a published report "gets fast on its own" is
  // true only after up to a full refresh period: the boot run fires before any
  // reader has asked for anything, finds nothing due, and re-enqueues four hours
  // out — so the first reader of a new report keeps paying the live price all
  // afternoon. Observed on featherbase-dev, 18-Sep-2026.
  //
  // Guarded on a job already queued for this method, so a burst of misses
  // schedules one build rather than one per reader.
  const [pending] = await sql`
    select 1 from background_job
    where method = 'refresh_datasets' and job_status = 'running' limit 1`
  if (pending) return
  // statement_timestamp(), not now(): now() is the TRANSACTION timestamp, and
  // the test sandbox runs a whole file inside one transaction, so now() is
  // frozen before the row being looked for was written. statement_timestamp()
  // is the real clock in both worlds, which keeps this guard testable without
  // changing what it does in production.
  const [dueNow] = await sql`
    select 1 from background_job
    where method = 'refresh_datasets' and job_status = 'queued'
      and run_at <= statement_timestamp() limit 1`
  if (!dueNow) await enqueue('refresh_datasets')
}

/** #625: close a dataset's outstanding asks (it is retired, or its app is off). */
export async function forgetMisses(dataset: string): Promise<void> {
  await sql`delete from dataset_miss where dataset = ${dataset}`
}

export async function pendingMisses(): Promise<string[]> {
  const rows = await sql`select dataset from dataset_miss order by first_seen`
  return rows.map((r) => String(r.dataset))
}

interface BuildOutcome {
  /** #1409: `skipped` when a refresh found the dataset bound to a stand-in. */
  status: 'activated' | 'refused' | 'failed' | 'skipped'
  snapshotId?: string
  rowCount?: number
  sourceAsOf?: string | null
  reason?: string
  fetchMs?: number
  loadMs?: number
  bytes?: number | null
}

interface BuildOpts {
  /** What caused this build: the job's trigger, 'script' for a build run by
   *  hand, or (#1409) a stand-in being loaded or switched to the warehouse. */
  trigger?: JobTrigger | 'script' | 'stand-in' | 'switch'
  /** #1409 (D1): the candidate is these rows, already checked and shaped,
   *  loaded by this person, instead of what the source returns. */
  standIn?: { rows: unknown[]; by: string }
}

/**
 * Build a candidate and activate it only if it validates. Readers keep the
 * previous snapshot throughout — the candidate is written under its own id and
 * is invisible until the activation transaction commits.
 *
 * Every build, whichever way it ends, leaves a registry row saying what it cost
 * (fetch and load time, bytes) and what caused it. A failed build's timings are
 * as much a fact as a successful one's: "the source took 40 s to refuse us" is
 * something an operator wants to see.
 *
 * #1409: a stand-in goes through the same steps with its rows given (D1). It
 * is not validated here: its loader checked that it fits, and a guard written
 * for the real data would refuse a small sample (D3). Nor is it ever a
 * baseline: a refresh that replaces one is validated against nothing. A
 * dataset bound to a stand-in is never built from its source: such a build is
 * `skipped`.
 */
export async function buildSnapshot(dataset: string, opts: BuildOpts = {}): Promise<BuildOutcome> {
  const def = registry.get(dataset)
  if (!def) return { status: 'failed', reason: `no dataset registered as ${dataset}` }

  // Serialized per dataset: a schedule tick and a reader's miss can land at
  // once, and without this an older, slower fetch finishing after a newer,
  // faster one could publish stale rows over fresh ones (review, 19-Sep-2026)
  // — the unique-active-per-dataset index stops two rows being active at
  // once, not a stale one winning the race to be the one. The advisory lock
  // is held for the WHOLE build — fetch, load, validate, activate — via the
  // same idiom release.ts uses for "N instances racing": the transaction
  // exists only to hold the lock, hashed per dataset name rather than
  // globally, while the actual work below still runs its own statements on
  // the pool exactly as it did before this lock existed.
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('dataset-snapshot:' || ${dataset}))`
    // #1409 (review): decided here, inside the lock, not only when the job
    // listed what was due: a stand-in loaded while an earlier dataset was
    // being fetched must not be replaced by the refresh that was already queued.
    if (!opts.standIn && (await boundToStandIn(dataset)))
      return { status: 'skipped' as const, reason: 'the dataset is bound to a stand-in' }

    const previous = await activeSnapshot(dataset)
    const snapshotId = randomUUID()
    const triggeredBy = opts.trigger ?? null
    const { standIn } = opts
    await sql`
      insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, triggered_by, stand_in, created_by, updated_by)
      values (${snapshotId}, ${dataset}, ${standIn ? def.shapeVersion : def.version}, 'building', now(), ${triggeredBy},
        ${!!standIn}, ${standIn?.by ?? 'Administrator'}, ${standIn?.by ?? 'Administrator'})`

    let rowCount: number
    let sourceAsOf: string | null
    let fetchMs = 0
    let loadMs = 0
    try {
      const t0 = Date.now()
      const fetched = standIn ? { rows: standIn.rows as never[], sourceAsOf: null } : await def.fetch()
      fetchMs = Date.now() - t0
      sourceAsOf = fetched.sourceAsOf
      const t1 = Date.now()
      rowCount = await def.load(snapshotId, fetched.rows)
      loadMs = Date.now() - t1
    } catch (e) {
      const reason = errorMessage(e)
      await sql`
        update dataset_snapshot
        set state = 'failed', error = ${reason}, fetch_ms = ${fetchMs}, load_ms = ${loadMs}, updated_at = now()
        where row_id = ${snapshotId}`
      return { status: 'failed', snapshotId, reason, fetchMs, loadMs }
    }

    const bytes = def.sizeOf ? await def.sizeOf(snapshotId) : null
    // #1409 (D3): a stand-in is never the baseline. The last real copy is,
    // when the stand-in was loaded over one, so a guard is not blind for the
    // first refresh after it.
    const baseline = previous?.stand_in ? await lastRealSnapshot(dataset, def.version) : previous
    const refusal = standIn ? null : ((await def.validate?.(rowCount, baseline, snapshotId)) ?? null)
    if (refusal) {
      // A refused candidate is never activated and never deleted: the row is the
      // record of why the refresh did not take, which a silent no-op would lose.
      await sql`
        update dataset_snapshot
        set state = 'failed', error = ${refusal}, row_count = ${rowCount}, bytes = ${bytes},
            fetch_ms = ${fetchMs}, load_ms = ${loadMs}, updated_at = now()
        where row_id = ${snapshotId}`
      return { status: 'refused', snapshotId, rowCount, reason: refusal, fetchMs, loadMs, bytes }
    }

    // Demote and promote together. `dataset_snapshot_one_active` makes "exactly
    // one active per dataset" a database fact rather than something this function
    // has to remember; doing it in two statements outside a transaction would
    // leave a window with none. A separate transaction from the advisory-lock
    // one above (same reason release.ts's does), so it commits and is visible
    // to readers immediately rather than waiting on the outer one.
    await sql.begin(async (activation) => {
      await activation`
        update dataset_snapshot set state = 'superseded', updated_at = now()
        where dataset = ${dataset} and state = 'active'`
      await activation`
        update dataset_snapshot
        set state = 'active', activated_at = now(), row_count = ${rowCount}, source_as_of = ${sourceAsOf},
            bytes = ${bytes}, fetch_ms = ${fetchMs}, load_ms = ${loadMs}, updated_at = now()
        where row_id = ${snapshotId}`
    })
    await sql`delete from dataset_miss where dataset = ${dataset}`

    return { status: 'activated', snapshotId, rowCount, sourceAsOf, fetchMs, loadMs, bytes }
  })
}

/**
 * Drop superseded snapshots beyond the most recent one. Last-good is retained
 * deliberately: it is what a failed build falls back to, so "keep 1" is the
 * floor, not an arbitrary number.
 */
export async function pruneSnapshots(dataset: string, keep = 1): Promise<number> {
  // #1409: while a stand-in serves, the last real copy is kept as well, however
  // many stand-ins are loaded after it: it is the baseline for the first real
  // refresh (lastRealSnapshot).
  const rows = await sql`
    select row_id from dataset_snapshot s
    where dataset = ${dataset} and state = 'superseded'
      and not (not stand_in
        and exists (select 1 from dataset_snapshot a where a.dataset = s.dataset and a.state = 'active' and a.stand_in)
        and row_id = (select r.row_id from dataset_snapshot r where r.dataset = s.dataset and r.state = 'superseded' and not r.stand_in
          order by r.activated_at desc limit 1))
    order by built_at desc
    offset ${keep}`
  if (!rows.length) return 0
  const ids = rows.map((r) => String(r.row_id))
  await sql`delete from dataset_snapshot where row_id in ${sql(ids)}`
  return ids.length
}
