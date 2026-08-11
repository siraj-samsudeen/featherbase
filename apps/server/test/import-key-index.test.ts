import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// #145 (ruled 2026-08-11): the match key gets an expression index on
// (key::text) — the exact cast resolveRows compares with — the first time
// a REAL keyed run uses it. Rehearsals create nothing: IMP-I3's "writes
// nothing" covers the catalog too.

const DT = 'Index Demand Target'
const PATH = `/api/table/${encodeURIComponent(DT)}:import`

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    id_pattern: 'IDX-.###',
    columns: [
      { column_name: 'zone', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
    ],
  })
}

async function keyIndexes(): Promise<string[]> {
  const rows = await sql`
    select indexname, indexdef from pg_indexes
    where tablename = ${'index_demand_target'} and indexname like '%ukidx'`
  return rows.map((r) => String(r.indexdef))
}

describe('#145: index-on-demand on the match key', () => {
  test('a dry run creates nothing; the first real keyed run creates the ::text expression index', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post(PATH, { rows: [{ zone: 'Alpha', pop: 1 }] })

    await admin.post(PATH, {
      dry_run: true,
      key_column: 'zone',
      rows: [{ zone: 'Alpha', pop: 2 }],
    })
    expect(await keyIndexes()).toEqual([]) // rehearsal touched no catalog

    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 2 }] })
    const defs = await keyIndexes()
    expect(defs).toHaveLength(1)
    expect(defs[0]).toContain('::text') // the cast resolveRows compares with

    // Second run: IF NOT EXISTS + the process cache — no error, still one.
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 3 }] })
    expect(await keyIndexes()).toHaveLength(1)
  })

  test('a Row ID key needs no index — the primary key serves it', async ({ admin }) => {
    await setup(admin)
    const res = await admin.post<{ inserted: number }>(PATH, {
      rows: [{ name: 'IDX-CUSTOM', zone: 'Alpha', pop: 1 }],
    })
    expect(res.inserted).toBe(1)
    await admin.post(PATH, { key_column: 'name', rows: [{ name: 'IDX-CUSTOM', pop: 2 }] })
    expect(await keyIndexes()).toEqual([])
  })
})
