import { randomUUID } from 'node:crypto'
import { sql } from './db'
import { enqueue, type JobTrigger } from './jobs'

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

export interface DatasetDefinition {
  name: string
  /** Bump when the SQL changes: it is part of snapshot identity, so a redefinition never silently reuses old rows. */
  version: string
  /** Pull the superset from the source. `sourceAsOf` is the warehouse's own as-of, never the build time. */
  fetch: () => Promise<{ rows: unknown[][]; sourceAsOf: string | null }>
  /** Write the fetched rows under this snapshot id. Returns the row count written. */
  load: (snapshotId: string, rows: unknown[][]) => Promise<number>
  /** Last gate before activation. Return a reason to refuse, or null to accept. */
  validate?: (rowCount: number, previous: SnapshotRecord | null) => string | null
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
}

const registry = new Map<string, DatasetDefinition>()

export function registerDataset(def: DatasetDefinition): void {
  registry.set(def.name, def)
}

export function getDataset(name: string): DatasetDefinition | undefined {
  return registry.get(name)
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
function isoDay(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** The one snapshot a reader may use, or null when the dataset has never built. */
export async function activeSnapshot(dataset: string): Promise<SnapshotRecord | null> {
  const [row] = await sql`
    select row_id, dataset, definition_version, source_as_of, built_at, activated_at, row_count, state,
           bytes, fetch_ms, load_ms, triggered_by
    from dataset_snapshot
    where dataset = ${dataset} and state = 'active'`
  if (!row) return null
  return {
    ...(row as unknown as SnapshotRecord),
    source_as_of: isoDay(row.source_as_of),
    row_count: row.row_count == null ? null : Number(row.row_count),
    bytes: row.bytes == null ? null : Number(row.bytes),
    fetch_ms: row.fetch_ms == null ? null : Number(row.fetch_ms),
    load_ms: row.load_ms == null ? null : Number(row.load_ms),
  }
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

export async function pendingMisses(): Promise<string[]> {
  const rows = await sql`select dataset from dataset_miss order by first_seen`
  return rows.map((r) => String(r.dataset))
}

export interface BuildOutcome {
  status: 'activated' | 'refused' | 'failed'
  snapshotId?: string
  rowCount?: number
  sourceAsOf?: string | null
  reason?: string
  fetchMs?: number
  loadMs?: number
  bytes?: number | null
}

export interface BuildOpts {
  /** What caused this build: the job's trigger, or 'script' for a build run by hand. */
  trigger?: JobTrigger | 'script'
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
 */
export async function buildSnapshot(dataset: string, opts: BuildOpts = {}): Promise<BuildOutcome> {
  const def = registry.get(dataset)
  if (!def) return { status: 'failed', reason: `no dataset registered as ${dataset}` }

  const previous = await activeSnapshot(dataset)
  const snapshotId = randomUUID()
  const triggeredBy = opts.trigger ?? null
  await sql`
    insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, triggered_by)
    values (${snapshotId}, ${dataset}, ${def.version}, 'building', now(), ${triggeredBy})`

  let rowCount: number
  let sourceAsOf: string | null
  let fetchMs = 0
  let loadMs = 0
  try {
    const t0 = Date.now()
    const fetched = await def.fetch()
    fetchMs = Date.now() - t0
    sourceAsOf = fetched.sourceAsOf
    const t1 = Date.now()
    rowCount = await def.load(snapshotId, fetched.rows)
    loadMs = Date.now() - t1
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    await sql`
      update dataset_snapshot
      set state = 'failed', error = ${reason}, fetch_ms = ${fetchMs}, load_ms = ${loadMs}, updated_at = now()
      where row_id = ${snapshotId}`
    return { status: 'failed', snapshotId, reason, fetchMs, loadMs }
  }

  const bytes = def.sizeOf ? await def.sizeOf(snapshotId) : null
  const refusal = def.validate?.(rowCount, previous) ?? null
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
  // leave a window with none.
  await sql.begin(async (tx) => {
    await tx`
      update dataset_snapshot set state = 'superseded', updated_at = now()
      where dataset = ${dataset} and state = 'active'`
    await tx`
      update dataset_snapshot
      set state = 'active', activated_at = now(), row_count = ${rowCount}, source_as_of = ${sourceAsOf},
          bytes = ${bytes}, fetch_ms = ${fetchMs}, load_ms = ${loadMs}, updated_at = now()
      where row_id = ${snapshotId}`
  })
  await sql`delete from dataset_miss where dataset = ${dataset}`

  return { status: 'activated', snapshotId, rowCount, sourceAsOf, fetchMs, loadMs, bytes }
}

/**
 * Drop superseded snapshots beyond the most recent one. Last-good is retained
 * deliberately: it is what a failed build falls back to, so "keep 1" is the
 * floor, not an arbitrary number.
 */
export async function pruneSnapshots(dataset: string, keep = 1): Promise<number> {
  const rows = await sql`
    select row_id from dataset_snapshot
    where dataset = ${dataset} and state = 'superseded'
    order by built_at desc
    offset ${keep}`
  if (!rows.length) return 0
  const ids = rows.map((r) => String(r.row_id))
  await sql`delete from dataset_snapshot where row_id in ${sql(ids)}`
  return ids.length
}
