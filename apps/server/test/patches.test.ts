// NOT sandbox-migrated: this tests the patch RUNNER itself — real commit,
// rollback-on-failure, and patch_log persistence semantics need real commits.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { appliedPatches, ensurePatchLog, runPatches, type Patch } from '../src/patches'

// PLAT-003: patches run exactly once per database, in order, each in a
// transaction; a failing patch rolls back cleanly and aborts the run.

const NAMES = ['t_patch_a', 't_patch_b', 't_patch_c']

async function reset() {
  await ensurePatchLog()
  await sql`delete from patch_log where patch in ${sql(NAMES)}`
  await sql.unsafe('drop table if exists patch_probe')
}

beforeEach(reset)
afterAll(async () => {
  await reset()
  await sql.end()
})

describe('PLAT-003: patch runner', () => {
  it('applies each patch exactly once across repeated runs, in order', async () => {
    const order: string[] = []
    const patches: Patch[] = NAMES.map((name) => ({
      name,
      up: async (tx) => {
        await tx.unsafe('create table if not exists patch_probe (n text)')
        await tx`insert into patch_probe (n) values (${name})`
        order.push(name)
      },
    }))

    const first = await runPatches(patches)
    expect(first).toEqual(NAMES) // all newly applied, in order
    expect(order).toEqual(NAMES)

    // A second run is a no-op — nothing re-applied.
    const second = await runPatches(patches)
    expect(second).toEqual([])

    // Each patch's effect happened exactly once.
    const rows = await sql`select n from patch_probe order by n`
    expect(rows.map((r) => r.n)).toEqual(NAMES)
    const logged = await appliedPatches()
    for (const n of NAMES) expect(logged.has(n)).toBe(true)
  })

  it('a failing patch aborts cleanly: it and later patches are not recorded or applied', async () => {
    const patches: Patch[] = [
      {
        name: 't_patch_a',
        up: async (tx) => {
          await tx.unsafe('create table if not exists patch_probe (n text)')
          await tx`insert into patch_probe (n) values ('a')`
        },
      },
      {
        name: 't_patch_b',
        up: async (tx) => {
          // Partial work, then a failure — the transaction must roll ALL of it back.
          await tx`insert into patch_probe (n) values ('b-partial')`
          throw new Error('boom')
        },
      },
      {
        name: 't_patch_c',
        up: async (tx) => {
          await tx`insert into patch_probe (n) values ('c')`
        },
      },
    ]

    await expect(runPatches(patches)).rejects.toThrow('boom')

    // Patch A committed and is recorded; B rolled back (no 'b-partial' row) and
    // is NOT recorded; C never ran.
    const rows = await sql`select n from patch_probe order by n`
    expect(rows.map((r) => r.n)).toEqual(['a'])
    const logged = await appliedPatches()
    expect(logged.has('t_patch_a')).toBe(true)
    expect(logged.has('t_patch_b')).toBe(false)
    expect(logged.has('t_patch_c')).toBe(false)

    // Re-running now that B is fixed applies exactly B and C, once.
    patches[1].up = async (tx) => {
      await tx`insert into patch_probe (n) values ('b')`
    }
    const retry = await runPatches(patches)
    expect(retry).toEqual(['t_patch_b', 't_patch_c'])
    const after = await sql`select n from patch_probe order by n`
    expect(after.map((r) => r.n)).toEqual(['a', 'b', 'c'])
  })
})
