import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { invalidateMeta, resolveTableName } from '../src/meta'
import { sql } from '../src/db'
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

  // Two Tables can no longer share a slug: the slug normalizes like the
  // storage name, and createTable refuses a second Table on the same storage
  // whatever its kind (#432). The twins below are written straight into the
  // store, standing for definitions that pre-date that rule, which is the
  // case the resolver must still refuse to guess on.
  async function twins(a: string, b: string) {
    for (const name of [a, b]) await sql`insert into table_def ${sql({ name, module: 'Core', kind: 'settings' })}`
    invalidateMeta()
  }

  test('a second Table with the same slug is refused at creation', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Slug Twin', kind: 'settings', columns: [{ column_name: 'a', column_type: 'Data' }] })
    const res = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ name: 'SLUG Twin', kind: 'settings', columns: [{ column_name: 'b', column_type: 'Data' }] }) })
    expect(res.status).toBe(409)
  })

  test('an exact match always wins over a slug match', async () => {
    await twins('Case Twin', 'CASE Twin')
    // Both spellings slug-match both Tables, but each IS an exact name — so
    // each resolves to itself instead of erroring as ambiguous.
    expect(await resolveTableName('Case Twin')).toBe('Case Twin')
    expect(await resolveTableName('CASE Twin')).toBe('CASE Twin')
  })

  test('an ambiguous slug is an error, not a silent pick', async ({ admin }) => {
    await twins('Twin Case', 'TWIN CASE')
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
