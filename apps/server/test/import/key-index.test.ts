import { describe, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { test } from '../pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../../src/db'
import { KEY_PADDING } from '../../src/actions/collection-import'
import { applyMigrationFile } from '../../src/migrate'

// #145 (ruled 2026-08-11): the match key gets an expression index on the
// key's trimmed text (#517) — the exact expression resolveRows compares
// with — the first time
// a REAL keyed run uses it. Rehearsals create nothing: IMP-I3's "writes
// nothing" covers the catalog too.

const DT = 'Index Demand Target'
const PATH = `/api/table/${encodeURIComponent(DT)}:import`

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
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
    expect(defs[0]).toContain('btrim') // the trimmed text resolveRows compares with (#517)
    expect(defs[0]).toContain('::text')

    // Second run: IF NOT EXISTS + the process cache — no error, still one.
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 3 }] })
    expect(await keyIndexes()).toHaveLength(1)
  })

  test('migration 0130 drops a key index built on the untrimmed cast, and the next keyed run builds the trimmed one', async ({ admin }) => {
    const MIGRATION = '0130_import_key_index_trimmed.sql'
    // The pop key: an earlier test already ensured zone's index in this
    // process, and the process cache would skip it.
    await setup(admin)
    await admin.post(PATH, { rows: [{ zone: 'Alpha', pop: 1 }] })
    const name = `featherbase.index_demand_target_pop_${createHash('sha256').update(`${DT}:pop`).digest('hex').slice(0, 8)}_ukidx`
    await sql.unsafe(`create index "${name}" on featherbase.index_demand_target (((pop)::text))`)
    await sql`delete from migration where name = ${MIGRATION}`
    await sql.begin(() => applyMigrationFile(MIGRATION))
    expect(await keyIndexes()).toEqual([])

    await admin.post(PATH, { key_column: 'pop', rows: [{ pop: 1, zone: 'Beta' }] })
    const defs = await keyIndexes()
    expect(defs).toHaveLength(1)
    expect(defs[0]).toContain('btrim')

    // Applying it again keeps the trimmed index.
    await sql`delete from migration where name = ${MIGRATION}`
    await sql.begin(() => applyMigrationFile(MIGRATION))
    expect(await keyIndexes()).toHaveLength(1)

    // The query resolveRows runs is served by it.
    await sql`set local enable_seqscan = off`
    const plan = await sql.unsafe(
      `explain select row_id from featherbase.index_demand_target where btrim((pop)::text, '${KEY_PADDING}') = any($1)`,
      [['1']],
    )
    expect(plan.map((r) => String(r['QUERY PLAN'])).join('\n')).toContain('_ukidx')
  })

  test('a Row ID key needs no index — the primary key serves it', async ({ admin }) => {
    await setup(admin)
    const res = await admin.post<{ inserted: number }>(PATH, {
      rows: [{ row_id: 'IDX-CUSTOM', zone: 'Alpha', pop: 1 }],
    })
    expect(res.inserted).toBe(1)
    await admin.post(PATH, { key_column: 'row_id', rows: [{ row_id: 'IDX-CUSTOM', pop: 2 }] })
    expect(await keyIndexes()).toEqual([])
  })
})

describe('#517: the stored key is trimmed of exactly what the file key is', () => {
  test('KEY_PADDING is the whitespace JavaScript’s trim() removes, character for character', () => {
    const trimmed: string[] = []
    for (let c = 0; c <= 0xffff; c++) if (String.fromCharCode(c).trim() === '') trimmed.push(String.fromCharCode(c))
    expect([...KEY_PADDING].sort()).toEqual(trimmed.sort())
  })

  test('Postgres trims every one of them from a stored key', async () => {
    const [{ k }] = await sql.unsafe(`select btrim($1::text, '${KEY_PADDING}') as k`, [`${KEY_PADDING}A1${KEY_PADDING}`])
    expect(k).toBe('A1')
  })
})
