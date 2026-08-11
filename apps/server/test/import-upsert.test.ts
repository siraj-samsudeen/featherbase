import { describe, expect } from 'vitest'
import fc from 'fast-check'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// Spec 0004 (import upsert) — the contract, rule, and invariant layers.
// UPS-R1: the import boundary learns update (key_column, permissions,
//         separate counts, action-aware dry run).
// UPS-R2: match resolution — examples AND a property (dry_run keeps the
//         database static, so the property generates hostile files freely).
// UPS-R3: what an update touches — examples AND a model-based property.
// UPS-R4: the file's own codes as ids (engine accepts supplied ids;
//         series untouched; mixing allowed).
// UPS-R5: the key is remembered per Table (Import Log carries it).
// UPS-I1–I3: reconciliation, never-deletes, idempotence.
// Journey-tier proof lives in apps/web/e2e/import-upsert-journey.spec.ts.

const DT = 'Upsert Target'
const PATH = `/api/table/${encodeURIComponent(DT)}:import`
const ROLE = 'Upsert Tester Role'

async function setup(admin: TestClient, extra: Record<string, unknown> = {}) {
  await admin.post('/api/doctype', {
    name: DT,
    id_pattern: 'UPST-.###',
    columns: [
      { column_name: 'zone', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
      { column_name: 'note', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'New\nDone' },
    ],
    ...extra,
  })
}

async function seed(admin: TestClient) {
  await admin.post(PATH, {
    rows: [
      { zone: 'Alpha', pop: 12000, note: 'a', stage: 'New' },
      { zone: 'Bravo', pop: 8400, note: 'b', stage: 'New' },
    ],
  })
}

async function rowsByZone(admin: TestClient) {
  const list = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      '["name","zone","pop","note","stage","updated_by","updated_at"]',
    )}&order_by=${encodeURIComponent('zone asc')}&limit_page_length=100`,
  )
  return Object.fromEntries(list.data.map((r) => [String(r.zone), r]))
}

describe('UPS-R1: the import boundary learns update', () => {
  test('UPS-R1: absent key_column keeps insert-only semantics byte-for-byte', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await admin.post<Record<string, unknown>>(PATH, {
      rows: [{ zone: 'Alpha' }, { zone: 'Alpha' }],
    })
    // Two same-zone rows both INSERT — no matching without a key — and the
    // response shape carries no `updated`.
    expect(res).toEqual({ inserted: 2, failed: [] })
    expect('updated' in res).toBe(false)
  })

  test('UPS-R1: a keyed run updates matches, inserts the rest, counts separately', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    const res = await admin.post<{
      updated: number
      inserted: number
      failed: unknown[]
    }>(PATH, {
      key_column: 'zone',
      rows: [
        { zone: 'Alpha', pop: 13500 },
        { zone: 'Charlie', pop: 23100 },
      ],
      context: { file_name: 'zones-v2.csv', sheet_name: 'zones', part: 1, parts: 1 },
    })
    expect(res.updated).toBe(1)
    expect(res.inserted).toBe(1)
    expect(res.failed).toEqual([])

    const byZone = await rowsByZone(admin)
    expect(Number(byZone.Alpha.pop)).toBe(13500)
    expect(byZone.Alpha.note).toBe('a') // unmapped-in-this-run column untouched
    expect(Number(byZone.Charlie.pop)).toBe(23100)

    // The Import Log carries the three counts separately (log schema gains
    // `updated`) plus UPS-R5's remembered choices.
    const logs = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["inserted","updated","failed","key_column","empty_cells","file_name"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['file_name', '=', 'zones-v2.csv']]))}`,
    )
    expect(logs.data).toHaveLength(1)
    expect(Number(logs.data[0].updated)).toBe(1)
    expect(Number(logs.data[0].inserted)).toBe(1)
    expect(Number(logs.data[0].failed)).toBe(0)
    expect(logs.data[0].key_column).toBe('zone')
    expect(logs.data[0].empty_cells).toBe('keep')
  })

  test('UPS-R1: updates run the full save lifecycle — versioned, stamped, never raw SQL', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    const before = await rowsByZone(admin)
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 99 }] })
    const versions = await admin.get<{ data: { data: { changed: unknown[] } }[] }>(
      `/api/table/Version?fields=${encodeURIComponent('["data"]')}&filters=${encodeURIComponent(
        JSON.stringify([
          ['ref_table', '=', DT],
          ['ref_name', '=', String(before.Alpha.name)],
        ]),
      )}`,
    )
    // The version trail records the prior value — UPS-H1's recovery path.
    expect(versions.data.length).toBe(1)
    const changed = versions.data[0].data.changed as [string, unknown, unknown][]
    expect(changed.find(([col]) => col === 'pop')).toBeTruthy()
  })

  test('UPS-R1: create-only caller mixing updates in is refused whole — nothing written', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await seed(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: ROLE, can_read: true, can_create: true },
    })
    const user = await createUser({ roles: [ROLE] })
    const before = await rowsByZone(admin)
    const res = await user.fetch(PATH, {
      method: 'POST',
      body: JSON.stringify({
        key_column: 'zone',
        rows: [
          { zone: 'Alpha', pop: 1 }, // update — needs write the caller lacks
          { zone: 'Newton', pop: 2 }, // insert — allowed alone
        ],
      }),
    })
    expect(res.status).toBe(403)
    const after = await rowsByZone(admin)
    expect(after).toEqual(before) // the permitted insert did NOT land
    const logs = await admin.get<{ data: unknown[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?filters=${encodeURIComponent(
        JSON.stringify([['ref_table', '=', DT]]),
      )}`,
    )
    expect(logs.data).toHaveLength(1) // the seed's — the refused run logged nothing
  })

  test('UPS-R1: write-only caller mixing inserts in is refused whole', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await seed(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: ROLE, can_read: true, can_write: true },
    })
    const user = await createUser({ roles: [ROLE] })
    const res = await user.fetch(PATH, {
      method: 'POST',
      body: JSON.stringify({
        key_column: 'zone',
        rows: [
          { zone: 'Alpha', pop: 1 },
          { zone: 'Newton', pop: 2 },
        ],
      }),
    })
    expect(res.status).toBe(403)
    const byZone = await rowsByZone(admin)
    expect(Number(byZone.Alpha.pop)).toBe(12000)
    expect(byZone.Newton).toBeUndefined()
  })

  test('UPS-R1: own-rows write scoping applies per matched row', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: {
        ref_table: DT,
        role: ROLE,
        can_read: true,
        can_create: true,
        can_write: true,
        own_rows_only: true,
      },
    })
    const user = await createUser({ roles: [ROLE] })
    // One row the caller owns, one the admin owns.
    await user.fetch(PATH, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ zone: 'Mine', pop: 1 }] }),
    })
    await admin.post(PATH, { rows: [{ zone: 'Theirs', pop: 2 }] })

    // Updating the owned row alone works…
    const ok = await user.fetch(PATH, {
      method: 'POST',
      body: JSON.stringify({ key_column: 'zone', rows: [{ zone: 'Mine', pop: 11 }] }),
    })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as { updated: number }).updated).toBe(1)

    // …but a run touching the other user's row is refused whole.
    const refused = await user.fetch(PATH, {
      method: 'POST',
      body: JSON.stringify({
        key_column: 'zone',
        rows: [
          { zone: 'Mine', pop: 111 },
          { zone: 'Theirs', pop: 222 },
        ],
      }),
    })
    expect(refused.status).toBe(403)
    const byZone = await rowsByZone(admin)
    expect(Number(byZone.Mine.pop)).toBe(11) // the permitted half did not land either
    expect(Number(byZone.Theirs.pop)).toBe(2)
  })

  test('UPS-R1: dry_run reports per-row actions and writes nothing', async ({ admin }) => {
    await setup(admin)
    await seed(admin)
    const res = await admin.post<{
      dry_run: boolean
      valid: number
      updated: number
      inserted: number
      failed: { index: number; message: string }[]
      actions: string[]
    }>(PATH, {
      dry_run: true,
      key_column: 'zone',
      rows: [
        { zone: 'Alpha', pop: 1 }, //   update
        { zone: 'Charlie', pop: 2 }, // insert
        { pop: 3 }, //                  fail — no key value
        { zone: 'Alpha', stage: 'Nope' }, // fail — duplicate key in file
      ],
    })
    expect(res.dry_run).toBe(true)
    expect(res.actions).toEqual(['fail', 'insert', 'fail', 'fail'])
    // Alpha appears twice, so BOTH its rows fail (UPS-R2) — leaving Charlie
    // as the one valid insert.
    expect(res.updated).toBe(0)
    expect(res.inserted).toBe(1)
    expect(res.valid).toBe(1)

    const count = await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(DT)}:count`)
    expect(count.count).toBe(2) // the seed rows only — nothing written
    const logs = await admin.get<{ data: unknown[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?filters=${encodeURIComponent(
        JSON.stringify([['ref_table', '=', DT]]),
      )}`,
    )
    expect(logs.data).toHaveLength(1) // the seed's — the dry run logged nothing (IMP-I3)
  })

  test('UPS-R1: argument validation — bad key, orphan empty_cells, clear without columns', async ({
    admin,
  }) => {
    await setup(admin)
    for (const body of [
      { key_column: 'no_such_column', rows: [{ zone: 'x' }] },
      { empty_cells: 'clear', rows: [{ zone: 'x' }] }, // empty_cells without key
      { key_column: 'zone', empty_cells: 'sometimes', rows: [{ zone: 'x' }] },
      { key_column: 'zone', empty_cells: 'clear', rows: [{ zone: 'x' }] }, // no columns
      { key_column: 'zone', empty_cells: 'clear', columns: ['zone', 'ghost'], rows: [{ zone: 'x' }] },
    ]) {
      const res = await admin.fetch(PATH, { method: 'POST', body: JSON.stringify(body) })
      expect(res.status, JSON.stringify(body)).toBe(417)
    }
  })
})

describe('UPS-R2: match resolution', () => {
  // The example table, row for row.
  test('UPS-R2 examples: one match updates · none inserts · empty fails · file-dup fails both · multi-match fails with count', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    // Two database rows sharing a zone value — the multi-match target.
    await admin.post(PATH, {
      rows: [
        { zone: 'Twin', pop: 1 },
        { zone: 'Twin', pop: 2 },
      ],
    })
    const res = await admin.post<{
      updated: number
      inserted: number
      failed: { index: number; message: string }[]
    }>(PATH, {
      key_column: 'zone',
      rows: [
        { zone: 'Alpha', pop: 10 }, //  0: matches exactly one → update
        { zone: 'Foxtrot', pop: 20 }, //1: matches nothing → insert
        { pop: 30 }, //                 2: empty key → failed, named
        { zone: 'Dup', pop: 40 }, //    3: duplicates 4 → both failed
        { zone: 'Dup', pop: 50 }, //    4
        { zone: 'Twin', pop: 60 }, //   5: matches 2 existing → failed w/ count
      ],
    })
    expect(res.updated).toBe(1)
    expect(res.inserted).toBe(1)
    expect(res.failed.map((f) => f.index)).toEqual([2, 3, 4, 5])
    expect(res.failed[0].message).toContain('no value in the match key')
    expect(res.failed[1].message).toContain('more than once')
    expect(res.failed[2].message).toContain('more than once')
    expect(res.failed[3].message).toContain('matches 2 existing rows')

    const byZone = await rowsByZone(admin)
    expect(Number(byZone.Alpha.pop)).toBe(10)
    expect(byZone.Dup).toBeUndefined() // neither half of the file-dup landed
  })

  test('UPS-R2: keys resolve against the DATABASE, never the request — a later chunk matches an earlier chunk’s insert', async ({
    admin,
  }) => {
    await setup(admin)
    // Chunk 1 inserts Golf; chunk 2 (a separate request, as IMPORT_CHUNK
    // would send it) carries Golf again with a new value — it must UPDATE
    // the row chunk 1 landed, not insert a twin.
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Golf', pop: 1 }] })
    const res = await admin.post<{ updated: number; inserted: number }>(PATH, {
      key_column: 'zone',
      rows: [{ zone: 'Golf', pop: 2 }],
    })
    expect(res.updated).toBe(1)
    expect(res.inserted).toBe(0)
    const byZone = await rowsByZone(admin)
    expect(Number(byZone.Golf.pop)).toBe(2)
    const count = await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(DT)}:count`)
    expect(count.count).toBe(1)
  })

  test('UPS-R2 property: every row resolves to exactly one action and the arithmetic closes', async ({
    admin,
  }) => {
    await setup(admin)
    // Static database: five singleton zones + one twinned zone. dry_run
    // resolves without writing, so every generated file sees the same state.
    const existing = ['Z0', 'Z1', 'Z2', 'Z3', 'Z4']
    await admin.post(PATH, {
      rows: [
        ...existing.map((zone, i) => ({ zone, pop: i })),
        { zone: 'TWIN', pop: 90 },
        { zone: 'TWIN', pop: 91 },
      ],
    })
    const keyArb = fc.constantFrom(...existing, 'N0', 'N1', 'N2', 'TWIN', '')
    await fc.assert(
      fc.asyncProperty(fc.array(keyArb, { minLength: 1, maxLength: 12 }), async (keys) => {
        const rows = keys.map((zone, i) => (zone ? { zone, pop: i } : { pop: i }))
        const res = await admin.post<{
          valid: number
          updated: number
          inserted: number
          failed: { index: number }[]
          actions: ('update' | 'insert' | 'fail')[]
        }>(PATH, { dry_run: true, key_column: 'zone', rows })

        // Total: one action per row, nothing unaccounted (UPS-I1 shape).
        expect(res.actions).toHaveLength(rows.length)
        expect(res.updated + res.inserted + res.failed.length).toBe(rows.length)

        // Pointwise: the action follows the example table.
        const seen = new Map<string, number>()
        for (const k of keys) if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
        keys.forEach((k, i) => {
          const expected = !k
            ? 'fail' //                         empty key
            : (seen.get(k) ?? 0) > 1
              ? 'fail' //                       duplicated within the file
              : k === 'TWIN'
                ? 'fail' //                     matches 2 database rows
                : existing.includes(k)
                  ? 'update'
                  : 'insert'
          expect(res.actions[i], `row ${i} key "${k}"`).toBe(expected)
        })
      }),
      { numRuns: 25 },
    )
  })
})

describe('UPS-R3: what an update touches', () => {
  test('UPS-R3 examples: unmapped columns survive · new values land · empty+keep survives · empty+clear clears', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)

    // File maps only zone+pop (2 of 4): note and stage keep their values.
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 13500 }] })
    let byZone = await rowsByZone(admin)
    expect(Number(byZone.Alpha.pop)).toBe(13500)
    expect(byZone.Alpha.note).toBe('a')
    expect(byZone.Alpha.stage).toBe('New')

    // Mapped note, cell empty (absent), choice = keep (default): survives.
    await admin.post(PATH, {
      key_column: 'zone',
      columns: ['zone', 'pop', 'note'],
      rows: [{ zone: 'Alpha', pop: 14000 }],
    })
    byZone = await rowsByZone(admin)
    expect(byZone.Alpha.note).toBe('a')

    // Same file, choice = clear: the user said the file is the whole truth.
    await admin.post(PATH, {
      key_column: 'zone',
      empty_cells: 'clear',
      columns: ['zone', 'pop', 'note'],
      rows: [{ zone: 'Alpha', pop: 15000 }],
    })
    byZone = await rowsByZone(admin)
    expect(byZone.Alpha.note).toBeNull()
    expect(byZone.Alpha.stage).toBe('New') // never mapped — clear does not reach it
    expect(Number(byZone.Alpha.pop)).toBe(15000)
  })

  test('UPS-R3: row identity never changes — a mapped Row ID differing from the match fails the row', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    const before = await rowsByZone(admin)
    const res = await admin.post<{ updated: number; failed: { message: string }[] }>(PATH, {
      key_column: 'zone',
      rows: [{ zone: 'Alpha', name: 'SMUGGLED-ID', pop: 1 }],
    })
    expect(res.updated).toBe(0)
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].message).toContain("cannot change a row's id")
    const after = await rowsByZone(admin)
    expect(after.Alpha.name).toBe(before.Alpha.name)
    expect(Number(after.Alpha.pop)).toBe(12000)
  })

  test('UPS-R3 property: keep preserves exactly the absent mapped columns; clear nulls them', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post(PATH, {
      rows: [{ zone: 'Model', pop: 1, note: 'seed-note', stage: 'New' }],
    })
    // The model: what each column should hold after every run so far.
    const state: Record<string, unknown> = { pop: 1, note: 'seed-note', stage: 'New' }
    const mapped = ['pop', 'note', 'stage']
    const cellArb = fc.record({
      pop: fc.option(fc.integer({ min: 0, max: 9999 }), { nil: undefined }),
      note: fc.option(fc.constantFrom('x', 'y', 'z'), { nil: undefined }),
      stage: fc.option(fc.constantFrom('New', 'Done'), { nil: undefined }),
    })
    await fc.assert(
      fc.asyncProperty(cellArb, fc.boolean(), async (cells, clear) => {
        const row: Record<string, unknown> = { zone: 'Model' }
        for (const [col, v] of Object.entries(cells)) if (v !== undefined) row[col] = v
        const res = await admin.post<{ updated: number }>(PATH, {
          key_column: 'zone',
          ...(clear ? { empty_cells: 'clear' } : {}),
          columns: ['zone', ...mapped],
          rows: [row],
        })
        expect(res.updated).toBe(1)
        for (const col of mapped)
          state[col] = col in row ? row[col] : clear ? null : state[col]
        const byZone = await rowsByZone(admin)
        for (const col of mapped) {
          const got = byZone.Model[col]
          const want = state[col]
          if (col === 'pop' && want != null) expect(Number(got)).toBe(Number(want))
          else expect(got, col).toEqual(want)
        }
      }),
      { numRuns: 12 },
    )
  })
})

describe('UPS-R4: the file’s own codes as ids', () => {
  test('UPS-R4: supplied ids land verbatim on a series Table and the series is not consumed', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await admin.post<{ inserted: number; failed: unknown[] }>(PATH, {
      rows: [
        { name: 'Z-07/A x', zone: 'Coded' }, // charset: verbatim incl. slash+space
        { name: 'REF-002', zone: 'Coded2' },
        { zone: 'Series' }, // unsupplied — the series continues for it
      ],
    })
    expect(res.inserted).toBe(3)
    expect(res.failed).toEqual([])
    const byZone = await rowsByZone(admin)
    expect(byZone.Coded.name).toBe('Z-07/A x')
    expect(byZone.Coded2.name).toBe('REF-002')
    // IMP-R6: the pattern is the promise — and the two supplied ids burned
    // nothing, so the first series row is the FIRST of its series.
    expect(byZone.Series.name).toBe('UPST-001')
  })

  test('UPS-R4: on append without a key a colliding code fails by its row; as the match key it updates (UPS-J2 branch)', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post(PATH, { rows: [{ name: 'REF-001', zone: 'First', pop: 1 }] })

    const collide = await admin.post<{ inserted: number; failed: { index: number; message: string }[] }>(
      PATH,
      { rows: [{ name: 'REF-001', zone: 'Second' }, { name: 'REF-003', zone: 'Third' }] },
    )
    expect(collide.inserted).toBe(1)
    expect(collide.failed.map((f) => f.index)).toEqual([0])
    expect(collide.failed[0].message).toContain('already exists')

    const upsert = await admin.post<{ updated: number; inserted: number }>(PATH, {
      key_column: 'name',
      rows: [{ name: 'REF-001', pop: 42 }],
    })
    expect(upsert.updated).toBe(1)
    expect(upsert.inserted).toBe(0)
    const byZone = await rowsByZone(admin)
    expect(Number(byZone.First.pop)).toBe(42)
    expect(byZone.First.zone).toBe('First') // unmapped column untouched
  })
})

describe('UPS-R5: the key is remembered per Table', () => {
  test('UPS-R5: a keyed run stores its key and choice; a keyless run stores nothing', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    await admin.post(PATH, {
      key_column: 'zone',
      empty_cells: 'clear',
      columns: ['zone', 'pop'],
      rows: [{ zone: 'Alpha', pop: 1 }],
    })
    await admin.post(PATH, { rows: [{ zone: 'Later keyless', pop: 2 }] })

    const logs = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["key_column","empty_cells","created_at"]',
      )}&filters=${encodeURIComponent(
        JSON.stringify([['ref_table', '=', DT]]),
      )}&order_by=${encodeURIComponent('created_at desc')}`,
    )
    expect(logs.data.length).toBe(3) // seed request + keyed run + keyless run
    // Latest row (the keyless run) stored nothing…
    expect(logs.data[0].key_column).toBeNull()
    expect(logs.data[0].empty_cells).toBeNull()
    // …and the wizard's lookup — newest row WITH a key — still finds the
    // remembered pair, so a keyless run never erases the suggestion.
    const remembered = logs.data.find((l) => l.key_column != null)
    expect(remembered?.key_column).toBe('zone')
    expect(remembered?.empty_cells).toBe('clear')
  })
})

describe('UPS-I1/I2/I3: whole-run invariants', () => {
  test('UPS-I1: |request| = updated + inserted + failed, failures named by index', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    const rows = [
      { zone: 'Alpha', pop: 1 }, //  update
      { zone: 'India', pop: 2 }, //  insert
      { pop: 3 }, //                 fail — empty key
      { zone: 'Alpha', stage: 'Nope' }, // fail — dup key (and bad choice)
    ]
    const res = await admin.post<{
      updated: number
      inserted: number
      failed: { index: number }[]
    }>(PATH, { key_column: 'zone', rows })
    expect(res.updated + res.inserted + res.failed.length).toBe(rows.length)
    // Alpha's duplicate fails BOTH rows: 1 updated becomes 0.
    expect(res.updated).toBe(0)
    expect(res.inserted).toBe(1)
    expect(res.failed.map((f) => f.index)).toEqual([0, 2, 3])
  })

  test('UPS-I2: an upsert never deletes — database rows absent from the file are untouched', async ({
    admin,
  }) => {
    await setup(admin)
    await seed(admin)
    const before = await rowsByZone(admin)
    await admin.post(PATH, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 100 }] })
    const after = await rowsByZone(admin)
    const count = await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(DT)}:count`)
    expect(count.count).toBe(2)
    expect(after.Bravo).toEqual(before.Bravo) // byte-identical, updated_at included
  })

  test('UPS-I3: importing the same file twice is idempotent — all matched, zero inserted, zero value changes', async ({
    admin,
  }) => {
    await setup(admin)
    const file = [
      { zone: 'Alpha', pop: 13500, note: 'a2' },
      { zone: 'Bravo', pop: 8400, note: 'b2' },
    ]
    await seed(admin)
    const first = await admin.post<{ updated: number; inserted: number }>(PATH, {
      key_column: 'zone',
      rows: file,
    })
    expect(first.updated + first.inserted).toBe(2)
    const afterFirst = await rowsByZone(admin)

    const second = await admin.post<{ updated: number; inserted: number; failed: unknown[] }>(
      PATH,
      { key_column: 'zone', rows: file },
    )
    expect(second.updated).toBe(2)
    expect(second.inserted).toBe(0)
    expect(second.failed).toEqual([])

    const afterSecond = await rowsByZone(admin)
    const count = await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(DT)}:count`)
    expect(count.count).toBe(2)
    for (const zone of ['Alpha', 'Bravo']) {
      const firstVals = { ...afterFirst[zone] }
      const secondVals = { ...afterSecond[zone] }
      delete firstVals.updated_at
      delete secondVals.updated_at
      expect(secondVals).toEqual(firstVals)
    }
    // Zero VALUE changes, proven by the version trail: the second run
    // recorded no versions (recordVersion skips no-op updates).
    const versions = await admin.get<{ data: unknown[] }>(
      `/api/table/Version?filters=${encodeURIComponent(
        JSON.stringify([['ref_table', '=', DT]]),
      )}`,
    )
    expect(versions.data).toHaveLength(2) // the first run's two, none from the second
  })
})
