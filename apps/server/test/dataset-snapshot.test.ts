// The dataset snapshot lifecycle (src/dataset-snapshot.ts): build a candidate,
// validate it, activate it atomically, keep the last good one, and count the
// readers who asked before it built. App datasets (app-datasets.test.ts) build
// on this; here a probe dataset of the test's own drives it directly.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  unregisterDataset,
} from '../src/dataset-snapshot'

const PROBE = 'snapshot_probe'

/** What the probe's source answers next: rows, or a failure. */
let source: () => Promise<unknown[][]> = async () => []
const answer = (rows: unknown[][]) => { source = async () => rows }
const rows = (n: number) => Array.from({ length: n }, (_, i) => [`r${i}`])

beforeAll(() => {
  registerDataset({
    name: PROBE,
    version: '1',
    fetch: async () => ({ rows: await source(), sourceAsOf: '2026-09-17' }),
    load: async (_id, fetched) => fetched.length,
    // The same two gates a real dataset carries: never activate nothing, never a collapse.
    validate: (count, previous) => {
      if (count === 0) return 'the candidate is empty'
      if (previous?.row_count && count < previous.row_count / 2) return `${count} rows against ${previous.row_count}: a >50% drop`
      return null
    },
    sizeOf: async () => 8192,
  })
})
afterAll(() => unregisterDataset(PROBE))
beforeEach(() => answer(rows(8)))

describe('snapshot lifecycle', () => {
  test('a build activates and carries the source as-of', async () => {
    const out = await buildSnapshot(PROBE)
    expect(out.status).toBe('activated')
    expect(out.rowCount).toBe(8)
    const snap = await activeSnapshot(PROBE)
    expect(snap?.source_as_of).toBe('2026-09-17') // ISO day, not "Thu Sep 17"
    expect(snap?.row_count).toBe(8)
  })

  test('exactly one snapshot is active after a rebuild, and the old one is superseded', async () => {
    const first = await buildSnapshot(PROBE)
    const second = await buildSnapshot(PROBE)
    expect(second.status).toBe('activated')
    const actives = await sql`select row_id from dataset_snapshot where dataset = ${PROBE} and state = 'active'`
    expect(actives).toHaveLength(1)
    expect(String(actives[0].row_id)).toBe(second.snapshotId)
    const [old] = await sql`select state from dataset_snapshot where row_id = ${first.snapshotId!}`
    expect(old.state).toBe('superseded')
  })

  test('a refused candidate leaves the previous snapshot serving, and says why', async () => {
    const good = await buildSnapshot(PROBE)
    answer([])
    const empty = await buildSnapshot(PROBE)
    expect(empty).toMatchObject({ status: 'refused', reason: 'the candidate is empty' })
    answer(rows(1))
    const collapsed = await buildSnapshot(PROBE)
    expect(collapsed.status).toBe('refused')
    expect(collapsed.reason).toMatch(/>50% drop/)
    // A failed refresh is never more destructive than not running at all.
    expect((await activeSnapshot(PROBE))?.row_id).toBe(good.snapshotId)
  })

  test('a source failure leaves the build failed and the last good active', async () => {
    const good = await buildSnapshot(PROBE)
    source = async () => { throw new Error('upstream is down') }
    const bad = await buildSnapshot(PROBE)
    expect(bad.status).toBe('failed')
    expect(bad.reason).toMatch(/upstream is down/)
    expect((await activeSnapshot(PROBE))?.row_id).toBe(good.snapshotId)
    const [r] = await sql`select state, error from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r.state).toBe('failed')
  })

  test('a dataset with no registered definition builds nothing and has no snapshot a reader may use', async () => {
    expect(await buildSnapshot('unregistered_probe')).toEqual({ status: 'failed', reason: 'no dataset registered as unregistered_probe' })
    const built = await buildSnapshot(PROBE)
    await sql`update dataset_snapshot set dataset = 'unregistered_probe' where row_id = ${built.snapshotId!}`
    expect(await activeSnapshot('unregistered_probe')).toBeNull()
  })

  test('an interrupted build is never resolved by a reader', async () => {
    await buildSnapshot(PROBE)
    const active = await activeSnapshot(PROBE)
    // A process that dies mid-build leaves exactly this: a 'building' row.
    await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at)
              values ('half-built', ${PROBE}, '1', 'building', now())`
    expect((await activeSnapshot(PROBE))?.row_id).toBe(active?.row_id)
  })

  // Review, 19-Sep-2026: a deployed definition with the old row still active
  // was served as a hit, an incompatible shape passed off as current.
  test('an active snapshot built under a retired definition version is not a hit', async () => {
    const out = await buildSnapshot(PROBE)
    await sql`update dataset_snapshot set definition_version = 'retired' where row_id = ${out.snapshotId!}`
    expect(await activeSnapshot(PROBE)).toBeNull()
  })

  test('pruning keeps the last good superseded snapshot', async () => {
    await buildSnapshot(PROBE)
    await buildSnapshot(PROBE)
    await buildSnapshot(PROBE)
    await pruneSnapshots(PROBE)
    const kept = await sql`select state from dataset_snapshot where dataset = ${PROBE} and state = 'superseded'`
    expect(kept).toHaveLength(1)
  })
})

describe('publish before cache', () => {
  const dueRefreshes = () => sql`
    select row_id from background_job
    where method = 'refresh_datasets' and job_status = 'queued' and run_at <= statement_timestamp()`

  test('building clears the miss', async () => {
    await recordMiss(PROBE)
    expect(await pendingMisses()).toContain(PROBE)
    await buildSnapshot(PROBE)
    expect(await pendingMisses()).not.toContain(PROBE)
  })

  test('a miss wakes the refresh worker immediately, and a burst of misses schedules one build', async () => {
    // Otherwise the first reader of a newly published report pays the live
    // price until the next scheduled interval (featherbase-dev, 18-Sep-2026).
    await sql`delete from background_job where method = 'refresh_datasets'`
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    await recordMiss(PROBE)
    expect(await dueRefreshes()).toHaveLength(1)
  })

  test('a miss while a refresh is already running schedules nothing more', async () => {
    await sql`delete from background_job where method = 'refresh_datasets'`
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
    const misses = await sql`select hits from dataset_miss where dataset = ${PROBE}`
    expect(misses).toHaveLength(1)
    expect(Number(misses[0].hits)).toBe(3)
  })
})

describe('registry as Tables (migration 0087)', () => {
  test('a build records what it cost and what caused it', async () => {
    const out = await buildSnapshot(PROBE, { trigger: 'demand' })
    expect(out.status).toBe('activated')
    const snap = await activeSnapshot(PROBE)
    expect(snap?.triggered_by).toBe('demand')
    expect(snap?.fetch_ms).toBeGreaterThanOrEqual(0)
    expect(snap?.load_ms).toBeGreaterThanOrEqual(0)
    expect(snap?.bytes).toBe(8192)
  })

  test('a failed build still records its timings — the cost of a refusal is a fact too', async () => {
    source = async () => { throw new Error('upstream is down') }
    const bad = await buildSnapshot(PROBE, { trigger: 'schedule' })
    const [r] = await sql`
      select state, triggered_by, fetch_ms from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r).toMatchObject({ state: 'failed', triggered_by: 'schedule' })
    expect(Number(r.fetch_ms)).toBeGreaterThanOrEqual(0)
  })

  test('the registry and the misses are Tables a System Manager reads through the generic API', async ({ admin }) => {
    const out = await buildSnapshot(PROBE)
    await recordMiss(PROBE)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Snapshot')}?fields=${encodeURIComponent(JSON.stringify(['row_id', 'dataset', 'state', 'row_count', 'triggered_by']))}`,
    )
    const mine = list.data.find((r) => r.row_id === out.snapshotId)
    expect(mine).toMatchObject({ dataset: PROBE, state: 'active' })
    expect(Number(mine?.row_count)).toBe(8)
    const misses = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Miss')}?fields=${encodeURIComponent(JSON.stringify(['dataset', 'hits']))}`,
    )
    expect(misses.data.find((r) => r.dataset === PROBE)).toBeTruthy()
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
    const first = await buildSnapshot(PROBE, { trigger: 'script' })
    expect(first.status).toBe('activated')

    // Now the source breaks, and a reader's miss asks for a refresh — the
    // same path recordMiss uses to wake the worker between scheduled runs.
    source = async () => { throw new Error('warehouse unreachable') }
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
