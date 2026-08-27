import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// #206/#207 (issue #197): a file-import, seen and undone as one thing.
//
// "Since here by mistake it created these 11 tables, I did not have an easy
// way to see these tables came from where and delete them all in one."
//
// `run_id` was already per TARGET — it is what a revert addresses. What was
// missing is the identity of the file-import itself, which is what ties the
// eleven Tables together.

interface Batch {
  batch_id: string
  file_name: string | null
  targets: {
    table: string
    created: boolean
    inserted: number
    updated: number
    failed: number
    sheets: string[]
    exists: boolean
    run_id: string | null
  }[]
  inserted: number
  updated: number
  failed: number
  created: number
}

let seq = 0
const newBatch = () => `bat-${++seq}-${process.pid}`

async function makeTable(admin: TestClient, name: string) {
  await admin.post('/api/table_def', {
    name,
    columns: [
      { column_name: 'zone', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
    ],
  })
}

async function importInto(
  admin: TestClient,
  table: string,
  rows: Record<string, unknown>[],
  context: Record<string, unknown>,
) {
  await admin.post(`/api/table/${encodeURIComponent(table)}:import`, { rows, context })
}

async function batches(admin: TestClient) {
  return (await admin.get<{ batches: Batch[] }>('/api/import/batches')).batches
}

describe('#206: one file-import is one batch', () => {
  test('the targets of one import roll up under it', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Alpha')
    await makeTable(admin, 'Batch Beta')
    await importInto(admin, 'Batch Alpha', [{ zone: 'a' }, { zone: 'b' }], {
      batch_id: batch,
      file_name: 'chain.xlsx',
      sheet_name: 'Alpha',
      table_created: true,
      run_id: 'r1',
    })
    await importInto(admin, 'Batch Beta', [{ zone: 'c' }], {
      batch_id: batch,
      file_name: 'chain.xlsx',
      sheet_name: 'Beta',
      table_created: true,
      run_id: 'r2',
    })

    const [found] = (await batches(admin)).filter((b) => b.batch_id === batch)
    expect(found.file_name).toBe('chain.xlsx')
    expect(found.targets.map((t) => t.table).sort()).toEqual(['Batch Alpha', 'Batch Beta'])
    expect(found.inserted).toBe(3)
    expect(found.created).toBe(2)
    // The run identity a revert addresses is kept per target, not blended.
    expect(found.targets.find((t) => t.table === 'Batch Alpha')?.run_id).toBe('r1')
  })

  test('a merge group is ONE target however many sheets fed it', async ({ admin }) => {
    // #201 sends a part per member sheet. Rolling those up per part would
    // report eleven Tables where the user made one.
    const batch = newBatch()
    await makeTable(admin, 'Batch Merged')
    for (const sheet of ['Store 001', 'Store 002', 'Store 003']) {
      await importInto(admin, 'Batch Merged', [{ zone: sheet }], {
        batch_id: batch,
        file_name: 'chain.xlsx',
        sheet_name: sheet,
        table_created: sheet === 'Store 001',
        run_id: 'merged-run',
      })
    }
    const [found] = (await batches(admin)).filter((b) => b.batch_id === batch)
    expect(found.targets).toHaveLength(1)
    expect(found.targets[0].sheets).toEqual(['Store 001', 'Store 002', 'Store 003'])
    expect(found.targets[0].inserted).toBe(3)
    // `table_created` is stamped on the first part only — it is a fact about
    // the target, not about each part.
    expect(found.targets[0].created).toBe(true)
    expect(found.created).toBe(1)
  })

  test('a chunked target counts once, with its rows summed', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Chunked')
    await importInto(admin, 'Batch Chunked', [{ zone: 'a' }], {
      batch_id: batch,
      part: 1,
      parts: 2,
      table_created: true,
      run_id: 'chunked',
    })
    await importInto(admin, 'Batch Chunked', [{ zone: 'b' }, { zone: 'c' }], {
      batch_id: batch,
      part: 2,
      parts: 2,
      run_id: 'chunked',
    })
    const [found] = (await batches(admin)).filter((b) => b.batch_id === batch)
    expect(found.targets).toHaveLength(1)
    expect(found.targets[0].inserted).toBe(3)
  })

  test('adding rows to a Table that already existed is not a creation', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Existing')
    await importInto(admin, 'Batch Existing', [{ zone: 'a' }], {
      batch_id: batch,
      table_created: false,
      run_id: 'append',
    })
    const [found] = (await batches(admin)).filter((b) => b.batch_id === batch)
    expect(found.targets[0].created).toBe(false)
    expect(found.created).toBe(0)
  })

  test('separate imports of the same file are separate batches', async ({ admin }) => {
    // file_name repeats every time; it was never an identity.
    await makeTable(admin, 'Batch Repeat')
    const first = newBatch()
    const second = newBatch()
    for (const id of [first, second]) {
      await importInto(admin, 'Batch Repeat', [{ zone: id }], {
        batch_id: id,
        file_name: 'same.xlsx',
        run_id: id,
      })
    }
    const ids = (await batches(admin)).map((b) => b.batch_id)
    expect(ids).toContain(first)
    expect(ids).toContain(second)
  })

  test('an import with no batch_id is simply not a batch', async ({ admin }) => {
    // A plain API import, or a run from before #206. It must not become one
    // enormous null batch.
    await makeTable(admin, 'Batch None')
    await importInto(admin, 'Batch None', [{ zone: 'a' }], { run_id: 'bare' })
    expect((await batches(admin)).every((b) => b.batch_id)).toBe(true)
  })

  test('a batch is addressable on its own, however old', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Direct')
    await importInto(admin, 'Batch Direct', [{ zone: 'a' }], {
      batch_id: batch,
      table_created: true,
      run_id: 'direct',
    })
    const one = await admin.get<Batch>(`/api/import/batches/${batch}`)
    expect(one.batch_id).toBe(batch)
    expect(one.targets[0].table).toBe('Batch Direct')
  })

  test('an unknown batch is a 404, not an empty one', async ({ admin }) => {
    await expect(admin.get('/api/import/batches/nope-not-a-batch')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('#207: deleting what one import created', () => {
  test('every created Table goes, and the appended-to one stays', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Made One')
    await makeTable(admin, 'Batch Made Two')
    await makeTable(admin, 'Batch Preexisting')
    for (const [table, created] of [
      ['Batch Made One', true],
      ['Batch Made Two', true],
      ['Batch Preexisting', false],
    ] as const) {
      await importInto(admin, table, [{ zone: 'x' }], {
        batch_id: batch,
        table_created: created,
        run_id: table,
      })
    }

    const res = await admin.post<{ deleted: string[]; refused: unknown[] }>(
      `/api/import/batches/${batch}/delete_tables`,
      {},
    )
    expect(res.deleted.sort()).toEqual(['Batch Made One', 'Batch Made Two'])
    expect(res.refused).toEqual([])

    const tables = await admin.get<{ data: { row_id: string }[] }>(
      '/api/table/Table?limit_page_length=500',
    )
    const names = tables.data.map((t) => t.row_id)
    expect(names).not.toContain('Batch Made One')
    expect(names).not.toContain('Batch Made Two')
    // A Table that merely RECEIVED rows is not this import's to destroy —
    // taking those rows back is the per-run revert, offered separately.
    expect(names).toContain('Batch Preexisting')
  })

  test('a Table another Table points at is refused by name, and the rest still go', async ({
    admin,
  }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Held')
    await makeTable(admin, 'Batch Free')
    for (const table of ['Batch Held', 'Batch Free']) {
      await importInto(admin, table, [{ zone: 'x' }], {
        batch_id: batch,
        table_created: true,
        run_id: table,
      })
    }
    // A live pointer at 'Batch Held' — deleting it must refuse (DEL-R3).
    await admin.post('/api/table_def', {
      name: 'Batch Pointer',
      columns: [
        { column_name: 'held', column_type: 'Reference', reference_table: 'Batch Held' },
      ],
    })

    const res = await admin.post<{ deleted: string[]; refused: { table: string }[] }>(
      `/api/import/batches/${batch}/delete_tables`,
      {},
    )
    // Ten Tables that can go should still go — one blocker is not a reason
    // to strand the batch.
    expect(res.deleted).toEqual(['Batch Free'])
    expect(res.refused.map((r) => r.table)).toEqual(['Batch Held'])
  })

  test('deleting twice is not an error the second time', async ({ admin }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Twice')
    await importInto(admin, 'Batch Twice', [{ zone: 'x' }], {
      batch_id: batch,
      table_created: true,
      run_id: 'twice',
    })
    await admin.post(`/api/import/batches/${batch}/delete_tables`, {})
    // The log rows went with the Table (DEL-R4 sweeps live pointers), so the
    // batch is simply gone — a 404, not a crash.
    await expect(admin.post(`/api/import/batches/${batch}/delete_tables`, {})).rejects.toMatchObject(
      { status: 404 },
    )
  })

  test('a non-System-Manager cannot delete a batch of Tables', async ({ admin, createUser }) => {
    const batch = newBatch()
    await makeTable(admin, 'Batch Guarded')
    await importInto(admin, 'Batch Guarded', [{ zone: 'x' }], {
      batch_id: batch,
      table_created: true,
      run_id: 'guarded',
    })
    const user = await createUser({ roles: [] })
    await expect(user.post(`/api/import/batches/${batch}/delete_tables`, {})).rejects.toMatchObject({
      status: 403,
    })
    const tables = await admin.get<{ data: { row_id: string }[] }>(
      '/api/table/Table?limit_page_length=500',
    )
    expect(tables.data.map((t) => t.row_id)).toContain('Batch Guarded')
  })
})
