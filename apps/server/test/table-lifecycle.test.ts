// docs/specs/0007-table-lifecycle.md — the contract half of the row
// lifecycle (TLC-R2, TLC-R3) plus the two invariants that keep a
// definition write from losing data silently.
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

// ------------------------------------------------------------- the invariants
//
// #250: a remove-one/add-one definition is ambiguous, so it is refused and the
// explicit rename_column operation is the way to rename (#249's decision).
// #251: a definition write refuses a name or a removal it was not asked for.

describe('TLC-I2 / TLC-I3: the definition API never loses data silently', () => {
  test(
    'TLC-I2 / TLC-R6: a rename typed as remove-plus-add is refused, and the rename operation keeps the data (#250)',
    async ({ admin }) => {
      await admin.post('/api/table_def', {
        name: NOTE,
        id_pattern: 'prompt',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      })
      await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-1', title: 'first' } })

      // The ordinary edit: one column, one new name, nothing else touched.
      const res = await admin.fetch(`/api/table_def/${encodeURIComponent(NOTE)}`, {
        method: 'PUT',
        body: JSON.stringify({ columns: [{ column_name: 'headline', column_type: 'Data' }] }),
      })
      expect(res.status).toBe(417)
      const body = await res.json()
      expect(body.error.fields.title).toMatch(/1 row holds a value/)
      expect(body.error.fields.title).toMatch(/rename_column/)
      expect(body.error.fields.title).toMatch(/headline/)
      expect((await admin.get<{ title: string }>(rowPath(NOTE, 'note-1'))).title).toBe('first')

      await admin.post(`/api/table_def/${encodeURIComponent(NOTE)}/rename_column`, { from: 'title', to: 'headline' })
      expect((await admin.get<{ headline: string }>(rowPath(NOTE, 'note-1'))).headline).toBe('first')
    },
  )

  test(
    'TLC-I3 / TLC-R7: a definition write refuses a name it will not apply, rather than reporting success (#251)',
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
