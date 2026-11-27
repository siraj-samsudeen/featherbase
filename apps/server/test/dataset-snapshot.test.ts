// Query-grained dataset snapshots (src/dataset-snapshot.ts): the lifecycle
// every dataset shares — build, validate, activate, supersede, prune — the
// miss that wakes the refresh worker, and the registry as Tables. The dataset
// here is a probe registered by this file, its source injected, so nothing
// touches MotherDuck; app datasets (app-datasets.test.ts) run on the same
// machinery.
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, enqueue, loadJobs } from '../src/jobs'
import {
  activeSnapshot,
  buildSnapshot,
  pendingMisses,
  pruneSnapshots,
  recordMiss,
  registerDataset,
} from '../src/dataset-snapshot'
import { expectStatus } from './fixtures'

const PROBE = 'snapshot_probe'

/** What the probe's source answers next: rows and the warehouse's own as-of, or a failure. */
let source: () => Promise<{ rows: unknown[][]; sourceAsOf: string | null }> = async () => ({ rows: [], sourceAsOf: null })
const stub = (rows: unknown[][], asOf = '2026-09-17') => { source = async () => ({ rows, sourceAsOf: asOf }) }
const failing = (message: string) => { source = async () => { throw new Error(message) } }

/** Eight rows with known content. */
const sampleRows = () => Array.from({ length: 8 }, (_, i) => [`row-${i}`, i])

registerDataset<unknown[]>({
  name: PROBE,
  version: '1',
  shapeVersion: 'shape-1',
  fetch: () => source(),
  async load(snapshotId, rows) {
    for (const row of rows)
      await sql`insert into app_dataset_row (snapshot_id, row) values (${snapshotId}, ${sql.json(row as never)})`
    return rows.length
  },
  async sizeOf(snapshotId) {
    const [size] = await sql`select coalesce(sum(pg_column_size(row)), 0) as bytes from app_dataset_row where snapshot_id = ${snapshotId}`
    return Number(size.bytes)
  },
  validate: (rowCount) => (rowCount === 0 ? 'candidate is empty' : null),
})

afterEach(() => stub([]))

describe('snapshot lifecycle', () => {
  test('a build activates and carries the source as-of', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(PROBE)
    expect(out.status).toBe('activated')
    expect(out.rowCount).toBe(8)
    const snap = await activeSnapshot(PROBE)
    expect(snap?.source_as_of).toBe('2026-09-17') // ISO day, not "Thu Sep 17"
    expect(snap?.row_count).toBe(8)
  })

  test('exactly one snapshot is active after a rebuild, and the old one is superseded', async () => {
    stub(sampleRows())
    const first = await buildSnapshot(PROBE)
    const second = await buildSnapshot(PROBE)
    expect(second.status).toBe('activated')
    const actives = await sql`select row_id from dataset_snapshot where dataset = ${PROBE} and state = 'active'`
    expect(actives).toHaveLength(1)
    expect(String(actives[0].row_id)).toBe(second.snapshotId)
    const [old] = await sql`select state from dataset_snapshot where row_id = ${first.snapshotId!}`
    expect(old.state).toBe('superseded')
  })

  test('a refused candidate is never activated and the previous snapshot keeps serving', async () => {
    stub(sampleRows())
    const good = await buildSnapshot(PROBE)
    stub([])
    const bad = await buildSnapshot(PROBE)
    expect(bad.status).toBe('refused')
    expect(bad.reason).toMatch(/empty/)
    // Last-good is still the one readers resolve — a failed refresh is never
    // more destructive than not running at all.
    expect((await activeSnapshot(PROBE))?.row_id).toBe(good.snapshotId)
  })

  test('a source failure leaves the build failed and the last good active', async () => {
    stub(sampleRows())
    const good = await buildSnapshot(PROBE)
    failing('upstream is down')
    const bad = await buildSnapshot(PROBE)
    expect(bad.status).toBe('failed')
    expect(bad.reason).toMatch(/upstream is down/)
    expect((await activeSnapshot(PROBE))?.row_id).toBe(good.snapshotId)
    const [r] = await sql`select state, error from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r.state).toBe('failed')
  })

  test('a dataset with no registered definition does not build', async () => {
    expect(await buildSnapshot('unregistered_probe')).toEqual({ status: 'failed', reason: 'no dataset registered as unregistered_probe' })
  })

  test('a dataset with no registered definition has no snapshot a reader may use', async () => {
    stub(sampleRows())
    const built = await buildSnapshot(PROBE)
    await sql`update dataset_snapshot set dataset = 'unregistered_probe' where row_id = ${built.snapshotId!}`
    expect(await activeSnapshot('unregistered_probe')).toBeNull()
  })

  test('an interrupted build is never resolved by a reader', async () => {
    stub(sampleRows())
    await buildSnapshot(PROBE)
    const active = await activeSnapshot(PROBE)
    // A process that dies mid-build leaves exactly this: a 'building' row.
    await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at)
              values ('half-built', ${PROBE}, '1', 'building', now())`
    expect((await activeSnapshot(PROBE))?.row_id).toBe(active?.row_id)
  })

  test('pruning keeps the last good superseded snapshot', async () => {
    stub(sampleRows())
    await buildSnapshot(PROBE)
    await buildSnapshot(PROBE)
    await buildSnapshot(PROBE)
    await pruneSnapshots(PROBE)
    const kept = await sql`select state from dataset_snapshot where dataset = ${PROBE} and state = 'superseded'`
    expect(kept).toHaveLength(1)
  })
})

describe('a miss asks for a build', () => {
  test('building clears the miss', async () => {
    stub(sampleRows())
    await recordMiss(PROBE)
    expect(await pendingMisses()).toContain(PROBE)
    await buildSnapshot(PROBE)
    expect(await pendingMisses()).not.toContain(PROBE)
  })

  test('a miss wakes the refresh worker immediately', async () => {
    await recordMiss(PROBE)
    // Otherwise the first reader of a newly published dataset pays the live price
    // until the next scheduled interval — up to four hours (observed on
    // featherbase-dev, 18-Sep-2026: the boot run fires before anyone has asked
    // for anything, finds nothing due, and re-enqueues four hours out).
    const jobs = await sql`
      select row_id from background_job
      where method = 'refresh_datasets' and job_status = 'queued'
        and run_at <= statement_timestamp()`
    expect(jobs).toHaveLength(1)
  })

  test('a burst of misses schedules one build, not one per reader', async () => {
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    const jobs = await sql`
      select row_id from background_job
      where method = 'refresh_datasets' and job_status = 'queued'
        and run_at <= statement_timestamp()`
    expect(jobs).toHaveLength(1)
  })

  test('a miss while a refresh is already running schedules nothing more', async () => {
    const running = await enqueue('refresh_datasets')
    await sql`update background_job set job_status = 'running' where row_id = ${running}`
    await recordMiss(PROBE)
    const queued = await sql`select row_id from background_job where method = 'refresh_datasets' and job_status = 'queued'`
    expect(queued).toHaveLength(0)
    expect(await pendingMisses()).toContain(PROBE) // still recorded, so the running build's successor sees it
  })

  test('repeated misses count rather than duplicate', async () => {
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    const rows = await sql`select hits from dataset_miss where dataset = ${PROBE}`
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].hits)).toBe(3)
  })
})

describe('registry as Tables (migration 0087)', () => {
  // Review, 19-Sep-2026: activeSnapshot() resolved by dataset + state='active'
  // only, so a deployed DatasetDefinition.version bump with the OLD row still
  // 'active' (the refresh job hasn't run since deploy) was served as a normal
  // hit — an incompatible shape passed off as current.
  test('an active snapshot built under a retired definition_version is not a hit', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(PROBE, { trigger: 'schedule' })
    expect(out.status).toBe('activated')
    expect(await activeSnapshot(PROBE)).toBeTruthy()

    // Simulate a deploy that bumped the dataset's version without a rebuild
    // yet: the row on disk still says the old one.
    await sql`update dataset_snapshot set definition_version = 'retired' where row_id = ${out.snapshotId!}`
    expect(await activeSnapshot(PROBE)).toBeNull()
  })

  test('a build records what it cost and what caused it', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(PROBE, { trigger: 'demand' })
    expect(out.status).toBe('activated')
    const snap = await activeSnapshot(PROBE)
    expect(snap?.triggered_by).toBe('demand')
    expect(snap?.fetch_ms).toBeGreaterThanOrEqual(0)
    expect(snap?.load_ms).toBeGreaterThanOrEqual(0)
    // Eight rows on disk are more than zero bytes; the exact figure is Postgres's.
    expect(snap?.bytes).toBeGreaterThan(0)
  })

  test('a failed build still records its timings — the cost of a refusal is a fact too', async () => {
    failing('upstream is down')
    const bad = await buildSnapshot(PROBE, { trigger: 'schedule' })
    const [r] = await sql`
      select state, triggered_by, fetch_ms from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r).toMatchObject({ state: 'failed', triggered_by: 'schedule' })
    expect(Number(r.fetch_ms)).toBeGreaterThanOrEqual(0)
  })

  test('the registry is a Table a System Manager reads through the generic API; the rows table is not', async ({ admin }) => {
    stub(sampleRows())
    const out = await buildSnapshot(PROBE)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Snapshot')}?fields=${encodeURIComponent(JSON.stringify(['row_id', 'dataset', 'state', 'row_count', 'triggered_by']))}`,
    )
    const mine = list.data.find((r) => r.row_id === out.snapshotId)
    expect(mine).toMatchObject({ dataset: PROBE, state: 'active' })
    expect(Number(mine?.row_count)).toBe(8)
    // The rows table holds every reader's rows and has no Table: unreachable generically.
    const rows = await admin.fetch(`/api/table/${encodeURIComponent('App Dataset Row')}`)
    await expectStatus(rows, 404)
  })

  test('a miss is a Dataset Miss row the Admin can see', async ({ admin }) => {
    await recordMiss(PROBE)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Miss')}?fields=${encodeURIComponent(JSON.stringify(['dataset', 'hits']))}`,
    )
    expect(list.data.find((r) => r.dataset === PROBE)).toBeTruthy()
  })
})

// The sandbox transaction's now() is frozen at BEGIN while the worker stamps
// run_at from the wall clock — the same shim scheduled-jobs.test.ts uses.
async function nudgeDueJobs() {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

// Review, 19-Sep-2026: refresh_datasets logged a failed/refused build and
// returned normally, so the job queue recorded every refresh as a successful
// Job Execution — no matter how many datasets actually failed to activate —
// and nothing was ever retried.
describe('refresh_datasets job: a build that does not activate is a failed run', () => {
  test('a fetch failure is a failed Job Execution, not success — and the previous snapshot keeps serving', async () => {
    await loadJobs()
    await sql`delete from background_job where method = 'refresh_datasets'`
    await sql`delete from job_execution where method = 'refresh_datasets'`
    await sql`delete from dataset_miss where dataset = ${PROBE}`

    // A good snapshot first, so there is a "last good" to preserve.
    stub(sampleRows())
    const first = await buildSnapshot(PROBE, { trigger: 'script' })
    expect(first.status).toBe('activated')

    // Now the source breaks, and a reader's miss asks for a refresh — the
    // same path recordMiss uses to wake the worker between scheduled runs.
    failing('warehouse unreachable')
    await recordMiss(PROBE)
    await nudgeDueJobs()
    expect(await drainJobs()).toBeGreaterThanOrEqual(1)

    const [exec] = await sql`
      select outcome, error from job_execution
      where method = 'refresh_datasets' order by started_at desc limit 1`
    expect(exec.outcome).toBe('error')
    expect(String(exec.error)).toContain(PROBE)

    const stillActive = await activeSnapshot(PROBE)
    expect(stillActive?.row_id).toBe(first.snapshotId) // untouched — last-good is still serving
  })
})

// Not sandboxed: the sandbox delegates the app's global `sql` to ONE real
// transaction for the test's duration (feather-testing-postgres), so two
// "concurrent" buildSnapshot() calls inside a sandboxed test would share one
// Postgres session — the same session re-acquiring its own advisory lock
// never blocks itself, so the fencing this proves cannot be observed there.
// Outside the sandbox `sql` is the real pool, and `sql.begin()` genuinely
// reserves a separate connection (a separate Postgres session) per call, the
// same as production — so this is the one place that can actually exercise
// the review's "real multi-session overlap" (19-Sep-2026). Own dataset name,
// manual cleanup in `finally`.
it('#8 buildSnapshot serializes overlapping refreshes of one dataset: the second cannot even start fetching until the first has fully activated', async () => {
  const dataset = `lock_probe_${randomUUID().replaceAll('-', '')}`
  const events: string[] = []
  let releaseFirst: () => void = () => {}
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let signalStarted: () => void = () => {}
  const firstStarted = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const builds: ReturnType<typeof buildSnapshot>[] = []
  let calls = 0

  registerDataset({
    name: dataset,
    version: '1',
    shapeVersion: 'shape-1',
    fetch: async () => {
      calls += 1
      const n = calls
      events.push(`fetch:${n}:start`)
      if (n === 1) {
        signalStarted()
        await firstGate
      }
      events.push(`fetch:${n}:end`)
      return { rows: [[n]], sourceAsOf: n === 1 ? '2026-01-01' : '2026-01-02' }
    },
    load: async (_id, rows) => rows.length,
  })

  try {
    const first = buildSnapshot(dataset, { trigger: 'script' })
    builds.push(first)
    // Observe fetch entry rather than assuming the database answered in 100ms.
    await firstStarted
    expect(events).toEqual(['fetch:1:start'])

    const second = buildSnapshot(dataset, { trigger: 'script' })
    builds.push(second)
    // The second call must be stuck waiting on the lock, not fetching.
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual(['fetch:1:start']) // fetch:2:start has NOT happened yet

    releaseFirst()
    const [out1, out2] = await Promise.all([first, second])

    expect(out1.status).toBe('activated')
    expect(out2.status).toBe('activated')
    // The second call's fetch only started after the first's had fully ended
    // (which, for the first, is after its own activation commits).
    expect(events).toEqual(['fetch:1:start', 'fetch:1:end', 'fetch:2:start', 'fetch:2:end'])

    const active = await activeSnapshot(dataset)
    expect(active?.row_id).toBe(out2.snapshotId) // the later request is the one left serving
  } finally {
    releaseFirst()
    await Promise.allSettled(builds)
    await sql`delete from dataset_snapshot where dataset = ${dataset}`
  }
})
