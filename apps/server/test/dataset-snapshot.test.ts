// Query-grained dataset snapshots (src/dataset-snapshot.ts, src/datasets/sales-target-mtd.ts,
// src/sales-target-report.ts) — the contract in
// data-warehouse openspec/changes/query-grained-dataset-snapshots and siraj-samsudeen#281.
//
// The source is injected, so nothing here touches MotherDuck; what is being
// pinned is the lifecycle, the grain and the read-time personalisation, not the
// warehouse's arithmetic (baseline agreement is measured separately by
// scripts/measure-sales-target-snapshot.ts against real data).
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import {
  activeSnapshot,
  buildSnapshot,
  pendingMisses,
  pruneSnapshots,
  recordMiss,
  registerDataset,
} from '../src/dataset-snapshot'
import { SALES_TARGET_DATASET, _setSourceReader, definitionSql } from '../src/datasets/sales-target-mtd'
import { reportFor } from '../src/sales-target-report'
import type { Assignment } from '../src/sales-target'

const EMP1: Assignment = { plant_code: '1501', store_label: 'ATK', material_groups: ['010101001', '010101003'], sections: [] }
const EMP3: Assignment = { plant_code: '1515', store_label: 'Kattakada', material_groups: ['010101001', '010101003'], sections: [] }

/** One snapshot row in the dataset's 8-column shape. */
const row = (plant: string, code: string, date: string, target: number | null, actual: number | null) =>
  [plant, plant === '1501' ? 'Attakulangara' : 'Kattakada', plant === '1501' ? 'ATK' : 'KTK', code, `Sub ${code}`, date, target, actual]

/** Two stores x two codes x two days, with known sums. */
function sampleRows() {
  const out: unknown[][] = []
  for (const plant of ['1501', '1515'])
    for (const code of ['010101001', '010101003'])
      for (const date of ['2026-09-01', '2026-09-02'])
        out.push(row(plant, code, date, 100, plant === '1501' ? 60 : 40))
  return out
}

function stub(rows: unknown[][], asOf = '2026-09-17') {
  _setSourceReader(async (text: string) => (/max\(actuals_as_of_date\)/.test(text) && !/with cutoff/.test(text) ? [[asOf]] : rows))
}

afterEach(() => _setSourceReader(null))

describe('dataset definition', () => {
  test('the definition carries no personalisation predicate', () => {
    const s = definitionSql('2026-09-01', '2026-09-17')
    // The property the whole design rests on: strip the per-reader scope and one
    // snapshot serves every reader. A comment cannot enforce this; this can.
    expect(s).not.toMatch(/plant_code\s*=\s*'/)
    expect(s).not.toMatch(/hierarchy_code\s+in\s*\(/)
    // ...while the non-personal scope it MUST keep is still there.
    expect(s).toMatch(/hierarchy_level\s*=\s*'material_group'/)
    expect(s).toMatch(/business_date between/)
  })
})

describe('snapshot lifecycle', () => {
  test('a build activates and carries the source as-of', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(SALES_TARGET_DATASET)
    expect(out.status).toBe('activated')
    expect(out.rowCount).toBe(8)
    const snap = await activeSnapshot(SALES_TARGET_DATASET)
    expect(snap?.source_as_of).toBe('2026-09-17') // ISO day, not "Thu Sep 17"
    expect(snap?.row_count).toBe(8)
  })

  test('exactly one snapshot is active after a rebuild, and the old one is superseded', async () => {
    stub(sampleRows())
    const first = await buildSnapshot(SALES_TARGET_DATASET)
    const second = await buildSnapshot(SALES_TARGET_DATASET)
    expect(second.status).toBe('activated')
    const actives = await sql`select row_id from dataset_snapshot where dataset = ${SALES_TARGET_DATASET} and state = 'active'`
    expect(actives).toHaveLength(1)
    expect(String(actives[0].row_id)).toBe(second.snapshotId)
    const [old] = await sql`select state from dataset_snapshot where row_id = ${first.snapshotId!}`
    expect(old.state).toBe('superseded')
  })

  test('an empty candidate is refused and the previous snapshot keeps serving', async () => {
    stub(sampleRows())
    const good = await buildSnapshot(SALES_TARGET_DATASET)
    stub([])
    const bad = await buildSnapshot(SALES_TARGET_DATASET)
    expect(bad.status).toBe('refused')
    expect(bad.reason).toMatch(/empty/)
    // Last-good is still the one readers resolve — a failed refresh is never
    // more destructive than not running at all.
    expect((await activeSnapshot(SALES_TARGET_DATASET))?.row_id).toBe(good.snapshotId)
  })

  test('a collapsed candidate is refused rather than activated', async () => {
    stub(sampleRows())
    await buildSnapshot(SALES_TARGET_DATASET)
    stub([row('1501', '010101001', '2026-09-01', 100, 60)]) // 1 row against 8
    const bad = await buildSnapshot(SALES_TARGET_DATASET)
    expect(bad.status).toBe('refused')
    expect(bad.reason).toMatch(/>50% drop/)
  })

  test('a source failure leaves the build failed and the last good active', async () => {
    stub(sampleRows())
    const good = await buildSnapshot(SALES_TARGET_DATASET)
    _setSourceReader(async () => { throw new Error('upstream is down') })
    const bad = await buildSnapshot(SALES_TARGET_DATASET)
    expect(bad.status).toBe('failed')
    expect(bad.reason).toMatch(/upstream is down/)
    expect((await activeSnapshot(SALES_TARGET_DATASET))?.row_id).toBe(good.snapshotId)
    const [r] = await sql`select state, error from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r.state).toBe('failed')
  })

  test('an interrupted build is never resolved by a reader', async () => {
    stub(sampleRows())
    await buildSnapshot(SALES_TARGET_DATASET)
    const active = await activeSnapshot(SALES_TARGET_DATASET)
    // A process that dies mid-build leaves exactly this: a 'building' row.
    await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at)
              values ('half-built', ${SALES_TARGET_DATASET}, '1', 'building', now())`
    expect((await activeSnapshot(SALES_TARGET_DATASET))?.row_id).toBe(active?.row_id)
  })

  test('pruning keeps the last good superseded snapshot', async () => {
    stub(sampleRows())
    await buildSnapshot(SALES_TARGET_DATASET)
    await buildSnapshot(SALES_TARGET_DATASET)
    await buildSnapshot(SALES_TARGET_DATASET)
    await pruneSnapshots(SALES_TARGET_DATASET)
    const kept = await sql`select state from dataset_snapshot where dataset = ${SALES_TARGET_DATASET} and state = 'superseded'`
    expect(kept).toHaveLength(1)
  })
})

describe('personalisation is applied at read time', () => {
  test('two readers share one snapshot and each sees only their own store', async () => {
    stub(sampleRows())
    const built = await buildSnapshot(SALES_TARGET_DATASET)

    const r1 = await reportFor(EMP1)
    const r3 = await reportFor(EMP3)

    expect(r1.snapshot_id).toBe(built.snapshotId)
    expect(r3.snapshot_id).toBe(built.snapshotId) // one snapshot, both readers
    expect(r1.store_name).toBe('Attakulangara')
    expect(r3.store_name).toBe('Kattakada')
    // 2 codes x 2 days x 60 (1501) vs 40 (1515)
    expect(r1.total.actual).toBe(240)
    expect(r3.total.actual).toBe(160)
    expect(r1.total.target).toBe(400)
  })

  test('a changed assignment takes effect with nothing rebuilt', async () => {
    stub(sampleRows())
    const built = await buildSnapshot(SALES_TARGET_DATASET)
    const before = await reportFor(EMP1)
    expect(before.rows).toHaveLength(2)

    const narrowed: Assignment = { ...EMP1, material_groups: ['010101001'] }
    const after = await reportFor(narrowed)

    expect(after.rows).toHaveLength(1)
    expect(after.total.actual).toBe(120)
    expect(after.snapshot_id).toBe(built.snapshotId) // same snapshot, no rebuild
  })

  test('a selected code with no rows still appears, as missing rather than zero', async () => {
    stub(sampleRows())
    await buildSnapshot(SALES_TARGET_DATASET)
    const withUnknown: Assignment = { ...EMP1, material_groups: ['010101001', '019999999'] }
    const r = await reportFor(withUnknown)
    expect(r.rows).toHaveLength(2)
    const missing = r.rows.find((x) => x.code === '019999999')!
    expect(missing.actual).toBeNull()      // never ₹0
    expect(missing.missingActual).toBe(true)
    expect(r.total.missing).toBe(1)
  })
})

describe('publish before cache', () => {
  test('with no snapshot the report serves live and records the miss', async () => {
    stub(sampleRows())
    expect(await activeSnapshot(SALES_TARGET_DATASET)).toBeNull()

    const r = await reportFor(EMP1)

    expect(r.source).toBe('live')
    expect(r.snapshot_id).toBeNull()
    expect(r.source_as_of).toBe('2026-09-17')
    expect(await pendingMisses()).toContain(SALES_TARGET_DATASET)
  })

  test('building clears the miss and the next read is served from the snapshot', async () => {
    stub(sampleRows())
    await reportFor(EMP1)
    expect(await pendingMisses()).toHaveLength(1)

    await buildSnapshot(SALES_TARGET_DATASET)

    expect(await pendingMisses()).toHaveLength(0)
    expect((await reportFor(EMP1)).source).toBe('snapshot')
  })

  test('a miss wakes the refresh worker immediately', async () => {
    stub(sampleRows())
    await reportFor(EMP1)
    // Otherwise the first reader of a newly published report pays the live price
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
    stub(sampleRows())
    await reportFor(EMP1)
    await reportFor(EMP3)
    await reportFor(EMP1)
    const jobs = await sql`
      select row_id from background_job
      where method = 'refresh_datasets' and job_status = 'queued'
        and run_at <= statement_timestamp()`
    expect(jobs).toHaveLength(1)
  })

  test('repeated misses count rather than duplicate', async () => {
    stub(sampleRows())
    await reportFor(EMP1)
    await reportFor(EMP3)
    await recordMiss(SALES_TARGET_DATASET)
    const rows = await sql`select hits from dataset_miss where dataset = ${SALES_TARGET_DATASET}`
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].hits)).toBe(3)
  })
})

describe('freshness', () => {
  test('a snapshot read carries the refresh instant as well as the source as-of', async () => {
    stub(sampleRows(), '2026-09-15')
    const before = Date.now()
    await buildSnapshot(SALES_TARGET_DATASET)
    const r = await reportFor(EMP1)
    // Both facts, never one standing in for the other: a snapshot refreshed a
    // moment ago from 15-Sep data is fresh by one measure and stale by the other.
    expect(r.source_as_of).toBe('2026-09-15')
    expect(r.generated_at).not.toBeNull()
    const refreshed = new Date(r.generated_at as string).getTime()
    expect(refreshed).toBeGreaterThanOrEqual(before - 1000)
    expect(refreshed).toBeLessThanOrEqual(Date.now() + 1000)
  })

  test('a live read has no refresh instant, because there is nothing to be stale', async () => {
    stub(sampleRows())
    const r = await reportFor(EMP1)
    expect(r.source).toBe('live')
    expect(r.generated_at).toBeNull()
    expect(r.source_as_of).toBe('2026-09-17')
  })

  test('a snapshot read states the source as-of, not the build time', async () => {
    stub(sampleRows(), '2026-09-15')
    await buildSnapshot(SALES_TARGET_DATASET)
    const r = await reportFor(EMP1)
    expect(r.source).toBe('snapshot')
    expect(r.source_as_of).toBe('2026-09-15')
    // The cutoff actually applied to both sides, and the report says it is early.
    expect(r.data_through).toBe('2026-09-15')
    expect(r.cutoff_early).toBe(true)
  })
})

describe('registry as Tables (migration 0087)', () => {
  // Review, 19-Sep-2026: activeSnapshot() resolved by dataset + state='active'
  // only, so a deployed DatasetDefinition.version bump with the OLD row still
  // 'active' (the refresh job hasn't run since deploy) was served as a normal
  // hit — an incompatible shape passed off as current.
  test('an active snapshot built under a retired definition_version is not a hit — the reader falls back to live', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(SALES_TARGET_DATASET, { trigger: 'schedule' })
    expect(out.status).toBe('activated')
    expect(await activeSnapshot(SALES_TARGET_DATASET)).toBeTruthy()

    // Simulate a deploy that bumped the dataset's version without a rebuild
    // yet: the row on disk still says the old one.
    await sql`update dataset_snapshot set definition_version = 'retired' where row_id = ${out.snapshotId!}`
    expect(await activeSnapshot(SALES_TARGET_DATASET)).toBeNull()

    // reportFor already has a path for "never built": live, with a miss
    // recorded so the worker rebuilds under the current definition. Reused,
    // not reinvented, for the version-mismatch case.
    await sql`delete from dataset_miss where dataset = ${SALES_TARGET_DATASET}`
    const r = await reportFor(EMP1)
    expect(r.source).toBe('live')
    expect(await pendingMisses()).toContain(SALES_TARGET_DATASET)
  })

  test('a build records what it cost and what caused it', async () => {
    stub(sampleRows())
    const out = await buildSnapshot(SALES_TARGET_DATASET, { trigger: 'demand' })
    expect(out.status).toBe('activated')
    const snap = await activeSnapshot(SALES_TARGET_DATASET)
    expect(snap?.triggered_by).toBe('demand')
    expect(snap?.fetch_ms).toBeGreaterThanOrEqual(0)
    expect(snap?.load_ms).toBeGreaterThanOrEqual(0)
    // Eight rows on disk are more than zero bytes; the exact figure is Postgres's.
    expect(snap?.bytes).toBeGreaterThan(0)
  })

  test('a failed build still records its timings — the cost of a refusal is a fact too', async () => {
    _setSourceReader(async () => { throw new Error('upstream is down') })
    const bad = await buildSnapshot(SALES_TARGET_DATASET, { trigger: 'schedule' })
    const [r] = await sql`
      select state, triggered_by, fetch_ms from dataset_snapshot where row_id = ${bad.snapshotId!}`
    expect(r).toMatchObject({ state: 'failed', triggered_by: 'schedule' })
    expect(Number(r.fetch_ms)).toBeGreaterThanOrEqual(0)
  })

  test('the registry is a Table a System Manager reads through the generic API; the rows table is not', async ({ admin }) => {
    stub(sampleRows())
    const out = await buildSnapshot(SALES_TARGET_DATASET)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Snapshot')}?fields=${encodeURIComponent(JSON.stringify(['row_id', 'dataset', 'state', 'row_count', 'triggered_by']))}`,
    )
    const mine = list.data.find((r) => r.row_id === out.snapshotId)
    expect(mine).toMatchObject({ dataset: SALES_TARGET_DATASET, state: 'active' })
    expect(Number(mine?.row_count)).toBe(8)
    // The rows table holds every store's figures and has no Table: unreachable generically.
    const rows = await admin.fetch(`/api/table/${encodeURIComponent('Sales Target Snapshot Row')}`)
    expect(rows.status).toBe(404)
  })

  test('a miss is a Dataset Miss row the Admin can see', async ({ admin }) => {
    stub(sampleRows())
    await reportFor(EMP1)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Dataset Miss')}?fields=${encodeURIComponent(JSON.stringify(['dataset', 'hits']))}`,
    )
    expect(list.data.find((r) => r.dataset === SALES_TARGET_DATASET)).toBeTruthy()
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
    await sql`delete from dataset_miss where dataset = ${SALES_TARGET_DATASET}`

    // A good snapshot first, so there is a "last good" to preserve.
    stub(sampleRows())
    const first = await buildSnapshot(SALES_TARGET_DATASET, { trigger: 'script' })
    expect(first.status).toBe('activated')

    // Now the source breaks, and a reader's miss asks for a refresh — the
    // same path recordMiss uses to wake the worker between scheduled runs.
    _setSourceReader(async () => {
      throw new Error('warehouse unreachable')
    })
    await recordMiss(SALES_TARGET_DATASET)
    await nudgeDueJobs()
    expect(await drainJobs()).toBeGreaterThanOrEqual(1)

    const [exec] = await sql`
      select outcome, error from job_execution
      where method = 'refresh_datasets' order by started_at desc limit 1`
    expect(exec.outcome).toBe('error')
    expect(String(exec.error)).toContain(SALES_TARGET_DATASET)

    const stillActive = await activeSnapshot(SALES_TARGET_DATASET)
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
  let calls = 0

  registerDataset({
    name: dataset,
    version: '1',
    fetch: async () => {
      calls += 1
      const n = calls
      events.push(`fetch:${n}:start`)
      if (n === 1) await firstGate
      events.push(`fetch:${n}:end`)
      return { rows: [[n]], sourceAsOf: n === 1 ? '2026-01-01' : '2026-01-02' }
    },
    load: async (_id, rows) => rows.length,
  })

  try {
    const first = buildSnapshot(dataset, { trigger: 'script' })
    // Give the first call time to acquire the lock and enter its (blocked) fetch.
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual(['fetch:1:start'])

    const second = buildSnapshot(dataset, { trigger: 'script' })
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
    await sql`delete from dataset_snapshot where dataset = ${dataset}`
  }
})
