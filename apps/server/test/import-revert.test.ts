import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { planRevert } from '../src/actions/collection-import-revert'

// Spec 0005 (import revert) — the contract, rule, and invariant layers.
// RVT-R1: a run becomes addressable (run_id + touched rows in the log).
// RVT-R2: the revert boundary (:import-revert — dry_run, override,
//         validation, whole-run resolution across parts).
// RVT-R3: what a restore restores (version before-values; the named skip
//         classes: unchanged, no-version-trail, already-gone).
// RVT-R4: edited-after detection by stamp, and the override.
// RVT-R6: whole-request permission refusal (write for restores, delete
//         for removals).
// RVT-I1–I3: reconciliation, touches-only-the-run, second-revert no-op.
// Journey-tier proof lives in apps/web/e2e/import-revert-journey.spec.ts.

const DT = 'Revert Target'
const IMPORT = `/api/table/${encodeURIComponent(DT)}:import`
const REVERT = `/api/table/${encodeURIComponent(DT)}:import-revert`
const ROLE = 'Revert Tester Role'

async function setup(admin: TestClient, extra: Record<string, unknown> = {}) {
  await admin.post('/api/doctype', {
    name: DT,
    id_pattern: 'RVT-.###',
    columns: [
      { column_name: 'zone', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
      { column_name: 'note', column_type: 'Data' },
    ],
    ...extra,
  })
}

let seq = 0
const newRunId = () => `rvt-run-${++seq}-${process.pid}`

// Seed two rows OUTSIDE any addressed run, then upsert a corrected file as
// the run under test: Alpha updated, Charlie inserted, Bravo untouched.
async function seedAndRun(admin: TestClient) {
  await admin.post(IMPORT, {
    rows: [
      { zone: 'Alpha', pop: 12000, note: 'original' },
      { zone: 'Bravo', pop: 8400, note: 'left alone' },
    ],
  })
  const runId = newRunId()
  await admin.post(IMPORT, {
    key_column: 'zone',
    rows: [
      { zone: 'Alpha', pop: 13500 }, // update: pop changes, note untouched
      { zone: 'Charlie', pop: 100 }, // insert
    ],
    context: { run_id: runId },
  })
  return runId
}

async function rowsByZone(admin: TestClient) {
  const list = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      '["row_id","zone","pop","note","updated_at"]',
    )}&limit_page_length=100`,
  )
  return Object.fromEntries(list.data.map((r) => [String(r.zone), r]))
}

interface RevertRes {
  restored: number
  deleted: number
  skipped: { row_id: string; reason: string }[]
  failed: { row_id: string; message: string }[]
  dry_run?: boolean
}

describe('RVT-R1: a run becomes addressable', () => {
  test('RVT-R1: the log row carries run_id and every written row with action + stamp', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    const logs = await admin.get<{ data: { touched: unknown; run_id: unknown }[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["run_id","touched"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['run_id', '=', runId]]))}`,
    )
    expect(logs.data).toHaveLength(1)
    const touched = logs.data[0].touched as {
      row_id: string
      action: string
      stamp: string
      version?: string
    }[]
    expect(touched).toHaveLength(2)
    const byAction = Object.fromEntries(touched.map((t) => [t.action, t]))
    expect(byAction.updated.version).toBeTruthy() // the update changed pop
    expect(Date.parse(byAction.updated.stamp)).not.toBeNaN()
    expect(byAction.inserted.version).toBeUndefined()
  })

  test('RVT-R1 × IMP-I3: a dry run records nothing', async ({ admin }) => {
    await setup(admin)
    const runId = newRunId()
    await admin.post(IMPORT, {
      dry_run: true,
      rows: [{ zone: 'Ghost', pop: 1 }],
      context: { run_id: runId },
    })
    const logs = await admin.get<{ data: unknown[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?filters=${encodeURIComponent(
        JSON.stringify([['run_id', '=', runId]]),
      )}`,
    )
    expect(logs.data).toHaveLength(0)
  })
})

describe('RVT-R2/R3: the revert boundary restores and deletes', () => {
  test('RVT-R3 + RVT-I1/I2: updates restored from the version trail, inserts deleted, bystanders byte-identical', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    const before = await rowsByZone(admin)

    const res = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(res.restored).toBe(1)
    expect(res.deleted).toBe(1)
    expect(res.failed).toEqual([])
    // RVT-I1: |recorded| = restored + deleted + skipped + failed
    expect(res.restored + res.deleted + res.skipped.length + res.failed.length).toBe(2)

    const after = await rowsByZone(admin)
    expect(Number(after.Alpha.pop)).toBe(12000) // pre-import value is back
    expect(after.Alpha.note).toBe('original') // untouched column survived the round trip
    expect(after.Charlie).toBeUndefined() // the run's insert is gone
    // RVT-I2: the bystander is byte-identical, updated_at included.
    expect(after.Bravo).toEqual(before.Bravo)

    // J1.5: the run's log entry records the revert.
    const logs = await admin.get<{ data: { reverted_at: unknown }[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["reverted_at"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['run_id', '=', runId]]))}`,
    )
    expect(logs.data[0].reverted_at).toBeTruthy()
  })

  test('RVT-R2: dry_run reports the plan and writes nothing', async ({ admin }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    const before = await rowsByZone(admin)
    const res = await admin.post<RevertRes>(REVERT, { run_id: runId, dry_run: true })
    expect(res.dry_run).toBe(true)
    expect(res.restored).toBe(1)
    expect(res.deleted).toBe(1)
    expect(await rowsByZone(admin)).toEqual(before)
  })

  test('RVT-R2: an unknown run refuses whole', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(REVERT, {
      method: 'POST',
      body: JSON.stringify({ run_id: 'no-such-run' }),
    })
    expect(res.status).toBe(404)
  })

  test('RVT-R3: a no-op update has nothing to restore — skipped: unchanged', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post(IMPORT, { rows: [{ zone: 'Alpha', pop: 12000 }] })
    const runId = newRunId()
    // Same values again: the upsert updates (stamp moves) but records no
    // version — recordVersion skips no-ops.
    await admin.post(IMPORT, {
      key_column: 'zone',
      rows: [{ zone: 'Alpha', pop: 12000 }],
      context: { run_id: runId },
    })
    const res = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(res.restored).toBe(0)
    expect(res.skipped).toEqual([
      { row_id: expect.stringMatching(/^RVT-/), reason: 'unchanged' },
    ])
  })

  test('RVT-R3 (rule tier): a track_changes-off Table has no before-values — skipped: no-version-trail', () => {
    // The API offers no way to set track_changes: false today (the flag is
    // a DB default the create/update endpoints never read), so this state
    // is unreachable end-to-end — the rule is proven against the exported
    // pure decision instead. Evidence: rule-tier only, on purpose.
    const stamp = '2026-08-11T00:00:00.000Z'
    const plan = planRevert(
      [{ row_id: 'RVT-001', action: 'updated', stamp, version: 'v1' }],
      new Map([['RVT-001', { updated_at: new Date(stamp), created_by: 'x' }]]),
      new Set(),
      false, // track_changes off
    )
    expect(plan.restores).toEqual([])
    expect(plan.skipped).toEqual([{ row_id: 'RVT-001', reason: 'no-version-trail' }])
  })

  test('RVT-R3/R4: an updated row deleted since — skipped: row-deleted', async ({ admin }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    const { Alpha } = await rowsByZone(admin)
    await admin.fetch(
      `/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(String(Alpha.row_id))}`,
      { method: 'DELETE' },
    )
    const res = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(res.restored).toBe(0)
    expect(res.deleted).toBe(1) // Charlie still goes
    expect(res.skipped).toEqual([{ row_id: String(Alpha.row_id), reason: 'row-deleted' }])
  })

  test('RVT-R3: an inserted row already deleted — skipped: already-gone', async ({ admin }) => {
    await setup(admin)
    const runId = newRunId()
    await admin.post(IMPORT, { rows: [{ zone: 'Echo', pop: 5 }], context: { run_id: runId } })
    const { Echo } = await rowsByZone(admin)
    await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(String(Echo.row_id))}`, {
      method: 'DELETE',
    })
    const res = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(res.deleted).toBe(0)
    expect(res.skipped).toEqual([{ row_id: String(Echo.row_id), reason: 'already-gone' }])
  })
})

describe('RVT-R4: edited-after detection and the override', () => {
  test('RVT-R4: an edited row is skipped and NAMED; the rest revert; override wins on a second act', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    // Someone edits Alpha after the import.
    const { Alpha } = await rowsByZone(admin)
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { row_id: Alpha.row_id, updated_at: Alpha.updated_at, pop: 99999 },
    })

    const first = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(first.restored).toBe(0)
    expect(first.deleted).toBe(1) // Charlie still goes
    expect(first.skipped).toEqual([{ row_id: String(Alpha.row_id), reason: 'edited-after' }])

    // RVT-R5's escalation: override names exactly the skipped row.
    const second = await admin.post<RevertRes>(REVERT, {
      run_id: runId,
      override: [String(Alpha.row_id)],
    })
    expect(second.restored).toBe(1)
    const after = await rowsByZone(admin)
    expect(Number(after.Alpha.pop)).toBe(12000) // pre-import value; the 99999 edit lost — and versioned
  })

  test('RVT-R2: override naming a row the run never wrote is a validation error', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    const res = await admin.fetch(REVERT, {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, override: ['RVT-999'] }),
    })
    expect(res.status).toBe(417) // the repo's ValidationError mapping (errors.ts)
  })
})

describe('RVT-I3: a second identical revert is a no-op', () => {
  test('RVT-I3: the first revert moved every stamp; the second writes nothing and says so', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    await admin.post<RevertRes>(REVERT, { run_id: runId })
    const between = await rowsByZone(admin)

    const second = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(second.restored).toBe(0)
    expect(second.deleted).toBe(0)
    expect(second.failed).toEqual([])
    expect(second.skipped).toHaveLength(2) // edited-after (restored row) + already-gone (deleted row)
    expect(await rowsByZone(admin)).toEqual(between)
  })
})

describe('RVT-R6: whole-request permission refusal', () => {
  test('RVT-R6: a write-only caller cannot revert a run containing deletes — nothing written', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: ROLE, can_read: true, can_write: true }, // no delete
    })
    const user = await createUser({ roles: [ROLE] })
    const before = await rowsByZone(admin)
    const res = await user.fetch(REVERT, {
      method: 'POST',
      body: JSON.stringify({ run_id: runId }),
    })
    expect(res.status).toBe(403)
    expect(await rowsByZone(admin)).toEqual(before) // Alpha not restored either — refusal is whole
  })
})
