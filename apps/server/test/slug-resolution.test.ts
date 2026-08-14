import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { resolveTableName } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// #56: /api/resource accepts slug spellings of Table names with spaces —
// report-feedback and report_feedback reach "Report Feedback" — so external
// clients never need %20. The exact name always wins, ambiguity is an error,
// and the slug map lives and dies with the meta cache.

const DT = 'Slug Test Note'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: DT, row: { title: 'seeded' } })
}

describe('#56: Table slugs in resource URLs', () => {
  test('hyphen and underscore slugs resolve to the spaced name', async ({ admin }) => {
    await setup(admin)
    for (const spelling of ['slug-test-note', 'slug_test_note', 'Slug-Test-Note']) {
      const res = await admin.fetch(
        `/api/table/${spelling}?fields=${encodeURIComponent('["row_id","title"]')}`,
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: { title: string }[] }
      expect(data[0].title).toBe('seeded')
    }
    // Writes resolve the same way.
    const ins = await admin.fetch('/api/table/slug-test-note', {
      method: 'POST',
      body: JSON.stringify({ title: 'via slug' }),
    })
    expect(ins.status).toBe(201)
  })

  test('the exact name and its %20 encoding keep working unchanged', async ({ admin }) => {
    await setup(admin)
    expect((await admin.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(200)
    expect((await admin.fetch('/api/table/Slug%20Test%20Note')).status).toBe(200)
  })

  // Two table-backed Tables can never share a slug — tableName() collapses
  // the same variants, so the second create collides on the table. Settings
  // Tables (kind: 'settings') get no table, so they are the one way two names
  // can normalize alike — which is exactly the case the resolver must refuse
  // to guess on.
  test('an exact match always wins over a slug match', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Case Twin', kind: 'settings', columns: [{ column_name: 'a', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'CASE Twin', kind: 'settings', columns: [{ column_name: 'b', column_type: 'Data' }] })
    // Both spellings slug-match both Tables, but each IS an exact name — so
    // each resolves to itself instead of erroring as ambiguous.
    expect(await resolveTableName('Case Twin')).toBe('Case Twin')
    expect(await resolveTableName('CASE Twin')).toBe('CASE Twin')
  })

  test('an ambiguous slug is an error, not a silent pick', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Twin Case', kind: 'settings', columns: [{ column_name: 'a', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'TWIN CASE', kind: 'settings', columns: [{ column_name: 'b', column_type: 'Data' }] })
    const res = await admin.fetch('/api/table/twin-case')
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Twin Case')
    expect(body.error.message).toContain('TWIN CASE')
  })

  test('an unknown slug falls through to the usual NotFound', async ({ admin }) => {
    expect((await admin.fetch('/api/table/no-such-table')).status).toBe(404)
  })

  test('the slug map is invalidated with the meta cache', async ({ admin }) => {
    // Build the slug map before the Table exists…
    expect((await admin.fetch('/api/table/inval-note')).status).toBe(404)
    // …then create it: creation invalidates the meta cache, which must drop
    // the slug map too, or the new name would stay unreachable by slug.
    await admin.post('/api/table_def', { name: 'Inval Note', columns: [{ column_name: 'a', column_type: 'Data' }] })
    expect((await admin.fetch('/api/table/inval-note')).status).toBe(200)
  })
})
