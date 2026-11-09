import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { invalidateMeta, resolveTableName } from '../src/meta'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'
import { expectStatus } from './fixtures'

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
      await expectStatus(res, 200)
      const { data } = (await res.json()) as { data: { title: string }[] }
      expect(data[0].title).toBe('seeded')
    }
    // Writes resolve the same way.
    const ins = await admin.fetch('/api/table/slug-test-note', {
      method: 'POST',
      body: JSON.stringify({ title: 'via slug' }),
    })
    await expectStatus(ins, 201)
  })

  test('the exact name and its %20 encoding keep working unchanged', async ({ admin }) => {
    await setup(admin)
    await expectStatus(await admin.fetch(`/api/table/${encodeURIComponent(DT)}`), 200)
    await expectStatus(await admin.fetch('/api/table/Slug%20Test%20Note'), 200)
  })

  // Slugs fold separators and trim; storage names do not trim or collapse
  // underscores. New cross-Table slug collisions must therefore be checked
  // independently of storage ownership. Raw legacy twins remain ambiguous:
  // the resolver must not silently rename or merge those identities.
  async function twins(a: string, b: string) {
    for (const name of [a, b]) await sql`insert into table_def ${sql({ name, module: 'Core', kind: 'settings' })}`
    invalidateMeta()
  }

  test('a second Table with the same slug is refused at creation', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Slug Twin', kind: 'settings', columns: [{ column_name: 'a', column_type: 'Data' }] })
    const res = await admin.fetch('/api/table_def', { method: 'POST', body: JSON.stringify({ name: 'SLUG Twin', kind: 'settings', columns: [{ column_name: 'b', column_type: 'Data' }] }) })
    await expectStatus(res, 409)
  })

  test('#821: public create refuses a trailing-space slug twin without changing the original identity', async ({ admin }) => {
    const definition = { name: 'Probe Twin', id_pattern: 'prompt', columns: [{ column_name: 'title', label: 'Original probe label', column_type: 'Data' }] }
    await admin.post('/api/table_def', definition)
    await admin.post('/api/save_row', { table: definition.name, row: { row_id: 'kept', title: 'Original content' } })
    const before = await admin.get('/api/table/probe-twin:meta')
    const refused = await admin.fetch('/api/table_def', {
      method: 'POST', body: JSON.stringify({ ...definition, name: 'Probe Twin ' }),
    })
    await expectStatus(refused, 409)
    expect(await admin.get('/api/table/probe-twin:meta')).toEqual(before)
    expect(await admin.get('/api/table/probe-twin/kept')).toMatchObject({ title: 'Original content' })
    expect(await sql`select name from table_def where name like 'Probe Twin%'`).toEqual([{ name: 'Probe Twin' }])
    expect(await sql`select to_regclass('featherbase.probe_twin_') as stranded`).toEqual([{ stranded: null }])

    // Distinct slugs still work, retaining the supplied column label and identity.
    await admin.post('/api/table_def', { ...definition, name: 'Probe Other' })
    expect(await admin.get('/api/table/probe-other:meta')).toMatchObject({ name: 'Probe Other', columns: [{ label: 'Original probe label' }] })
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
    await expectStatus(res, 409)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('Twin Case')
    expect(body.error.message).toContain('TWIN CASE')
  })

  test('Table address resolution prefers live metadata before ambiguous deletion history', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Grave Probe',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await admin.delete('/api/table_def/Grave%20Probe')
    await admin.post('/api/table_def', {
      name: 'grave probe',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })

    // One live Table wins over the older Table's normalized deletion name.
    const live = await admin.fetch('/api/table/grave-probe:meta')
    await expectStatus(live, 200)
    expect(await live.json()).toMatchObject({ name: 'grave probe' })

    await admin.delete('/api/table_def/grave%20probe')
    const ambiguous = await admin.fetch('/api/table/grave-probe:meta')
    await expectStatus(ambiguous, 409)
    const body = (await ambiguous.json()) as { error: { type: string; message: string } }
    expect(body.error.type).toBe('ConflictError')
    expect(body.error.message).toContain('Ambiguous Table slug grave-probe')
    expect(body.error.message).toContain('Grave Probe')
    expect(body.error.message).toContain('grave probe')

    // Exact historical names still identify their own tombstone, not the
    // ambiguous normalized spelling shared by the two deleted Tables.
    for (const [path, name] of [
      ['/api/table/Grave%20Probe:meta', 'Grave Probe'],
      ['/api/table/grave%20probe:meta', 'grave probe'],
    ]) {
      const exact = await admin.fetch(path)
      await expectStatus(exact, 404)
      const tombstone = (await exact.json()) as { error: { message: string } }
      expect(tombstone.error.message).toMatch(
        new RegExp(`^Table ${name} was deleted by Administrator on \\d{2}-[A-Z][a-z]{2}-\\d{4}$`),
      )
    }
  })

  test('an unknown slug falls through to the usual NotFound', async ({ admin }) => {
    await expectStatus(await admin.fetch('/api/table/no-such-table'), 404)
  })

  test('the slug map is invalidated with the meta cache', async ({ admin }) => {
    // Build the slug map before the Table exists…
    await expectStatus(await admin.fetch('/api/table/inval-note'), 404)
    // …then create it: creation invalidates the meta cache, which must drop
    // the slug map too, or the new name would stay unreachable by slug.
    await admin.post('/api/table_def', { name: 'Inval Note', columns: [{ column_name: 'a', column_type: 'Data' }] })
    await expectStatus(await admin.fetch('/api/table/inval-note'), 200)
  })
})
