// docs/specs/0007-table-lifecycle.md — the contract half of the row
// lifecycle (TLC-R2, TLC-R3) plus the two pins that hold the spec's
// invariants against defects the Admin is about to build on top of.
//
// Titles read as the rule they prove: the ID is the join key
// check-evidence.mjs uses, and the sentence after it is what a reviewer
// checks the assertion against without reading the implementation.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const NOTE = 'TLC Note'
const REF = 'TLC Ref'

const rowPath = (table: string, name: string) =>
  `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`

/** A plain table, and a second one whose Reference column points at it. */
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: NOTE,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'body', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' },
    ],
  })
  await admin.post('/api/table_def', {
    name: REF,
    id_pattern: 'prompt',
    columns: [{ column_name: 'note', column_type: 'Reference', reference_table: NOTE }],
  })
}

describe('TLC-R2: creating a row', () => {
  test('TLC-R2: a row with no row_id is an insert, and the response carries the id the pattern assigned', async ({
    admin,
  }) => {
    await admin.post('/api/table_def', {
      name: NOTE,
      // hash, not prompt: the point of this test is that the CLIENT does not
      // choose the id — the table's own pattern does.
      columns: [{ column_name: 'body', column_type: 'Data' }],
    })

    const saved = await admin.post<{ row_id: string; body: string }>('/api/save_row', {
      table: NOTE,
      row: { body: 'first' },
    })

    expect(saved.row_id).toBeTruthy()
    expect(saved.body).toBe('first')
    // Addressable by the id it just handed back, with no second read needed
    // to find out what the row is called.
    const read = await admin.get<{ body: string }>(rowPath(NOTE, saved.row_id))
    expect(read.body).toBe('first')
  })

  test('TLC-R2: a column-keyed error map comes back for an invalid value, which is what the form renders inline', async ({
    admin,
  }) => {
    await setup(admin)

    await expect(
      admin.post('/api/save_row', {
        table: NOTE,
        row: { row_id: 'note-bad', stage: 'Nonexistent' },
      }),
    ).rejects.toMatchObject({ status: 417, fields: { stage: expect.any(String) } })
  })
})

describe('TLC-R3: deleting a row', () => {
  test('TLC-R3: an existing unreferenced row is removed, and reading it afterwards is a 404', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-1', body: 'gone soon' } })

    const res = await admin.delete<{ ok: boolean }>(rowPath(NOTE, 'note-1'))
    expect(res).toEqual({ ok: true })

    await expect(admin.get(rowPath(NOTE, 'note-1'))).rejects.toMatchObject({ status: 404 })
  })

  test('TLC-R3: deleting a row that does not exist is a 404, never a silent success', async ({
    admin,
  }) => {
    await setup(admin)

    await expect(admin.delete(rowPath(NOTE, 'never-existed'))).rejects.toMatchObject({
      status: 404,
    })
  })

  test('TLC-R3.referenced: a referenced row is refused, and the message names the row holding the reference', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-1', body: 'held' } })
    await admin.post('/api/save_row', { table: REF, row: { row_id: 'ref-1', note: 'note-1' } })

    // The refusal has to be actionable: knowing something references the row
    // is useless without knowing WHAT, which is the whole point of R3.referenced.
    await expect(admin.delete(rowPath(NOTE, 'note-1'))).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining('ref-1'),
    })

    // And the refusal left the row alone.
    const survived = await admin.get<{ body: string }>(rowPath(NOTE, 'note-1'))
    expect(survived.body).toBe('held')
  })

  test('TLC-R3: a settings table refuses direct row deletion, naming the table', async ({
    admin,
  }) => {
    await expect(admin.delete(rowPath('System Settings', 'System Settings'))).rejects.toMatchObject(
      { status: 417, message: expect.stringContaining('System Settings') },
    )
  })
})

// ------------------------------------------------------------- the pins
//
// These assert the SPEC and are EXPECTED to fail. When #250 and #251 are
// fixed each one goes green and Vitest reports the expected-failure as a
// failure — which is the signal to flip it to a plain `test` in the same
// change (CLAUDE.md pin protocol).

describe('TLC-I2 / TLC-I3: invariants the definition API violates today', () => {
  test.fails(
    'TLC-I2 / TLC-R6: renaming a column keeps its data readable under the new name (pins #250)',
    async ({ admin }) => {
      await admin.post('/api/table_def', {
        name: NOTE,
        id_pattern: 'prompt',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      })
      await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-1', title: 'first' } })

      // The ordinary edit: one column, one new name, nothing else touched.
      await admin.put(`/api/table_def/${encodeURIComponent(NOTE)}`, {
        columns: [{ column_name: 'headline', column_type: 'Data' }],
      })

      const row = await admin.get<{ headline: string }>(rowPath(NOTE, 'note-1'))
      // Today: headline is null and "first" is unreachable through every read
      // path, because updateTable diffed the rename into a drop plus an add.
      expect(row.headline).toBe('first')
    },
  )

  test.fails(
    'TLC-I3 / TLC-R7: a definition write refuses a name it will not apply, rather than reporting success (pins #251)',
    async ({ admin }) => {
      await setup(admin)

      // The caller asks to rename the table. The server cannot do that, so
      // the one thing it must not do is answer 200 with the old name.
      await expect(
        admin.put(`/api/table_def/${encodeURIComponent(NOTE)}`, {
          name: 'TLC Note Renamed',
          columns: [{ column_name: 'body', column_type: 'Data' }],
        }),
      ).rejects.toMatchObject({ status: 417 })
    },
  )
})
