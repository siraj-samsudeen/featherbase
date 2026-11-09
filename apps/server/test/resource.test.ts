import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { getCollectionAction, getRowAction, listActions, registerCollectionAction, registerRowAction } from '../src/actions'
import { expectStatus } from './fixtures'

const DT = 'Rest Project'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true },
      { column_name: 'stars', column_type: 'Int' },
    ],
  })
}

describe('API-001/API-002: generic REST resource', () => {
  test('extensions cannot replace generated endpoints with row or collection actions', async ({ admin }) => {
    await setup(admin)
    const before = listActions()
    for (const name of ['meta', 'count', 'distinct', 'actions']) {
      expect(() => registerRowAction(name, getRowAction('submit')!)).toThrow(`":${name}" is reserved for the generated Table layer`)
      expect(() => registerCollectionAction(name, getCollectionAction('import')!)).toThrow(`":${name}" is reserved for the generated Table layer`)
    }
    expect(listActions()).toEqual(before)
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}:meta`)).toMatchObject({ name: DT })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}:count`)).toEqual({ count: 0 })
  })

  test('runs the full CRUD cycle through /api/resource with zero per-Table code', async ({
    admin,
  }) => {
    await setup(admin)
    // CREATE
    const created = await admin.post<Record<string, unknown>>(
      `/api/table/${encodeURIComponent(DT)}`,
      { title: 'proj-a', stars: 1 },
    )
    expect(created.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3

    // READ one
    const one = await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`)
    await expectStatus(one, 200)
    expect(((await one.json()) as Record<string, unknown>).title).toBe('proj-a')

    // UPDATE (PUT)
    const put = await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updated_at: created.updated_at, title: 'proj-b' }),
    })
    await expectStatus(put, 200)
    expect(((await put.json()) as Record<string, unknown>).title).toBe('proj-b')

    // LIST with filters + pagination params
    for (const [t, s] of [['x1', 5], ['x2', 6], ['x3', 7]] as const)
      await admin.post(`/api/table/${encodeURIComponent(DT)}`, { title: t, stars: s })
    const qs = new URLSearchParams({
      filters: JSON.stringify([['stars', '>=', 5]]),
      fields: JSON.stringify(['row_id', 'title', 'stars']),
      order_by: 'stars desc',
      limit_page_length: '2',
    })
    const list = await admin.get<{ data: { title: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(DT)}?${qs}`,
    )
    expect(list.total).toBe(3)
    expect(list.data.map((r) => r.title)).toEqual(['x3', 'x2'])

    // DELETE: a row with history can't be deleted (#321, owner decision
    // 27-Oct-2026), so the edited row stays and an unedited one goes.
    const doomed = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(DT)}`, { title: 'proj-c' })
    const refused = await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`, { method: 'DELETE' })
    await expectStatus(refused, 417)
    const del = await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${doomed.row_id}`, {
      method: 'DELETE',
    })
    await expectStatus(del, 200)
    expect(
      (await admin.fetch(`/api/table/${encodeURIComponent(DT)}/${doomed.row_id}`)).status,
    ).toBe(404)
  })

  test('404s on unknown table for every verb', async ({ admin }) => {
    await setup(admin)
    await expectStatus(await admin.fetch('/api/table/Nope'), 404)
    await expectStatus(await admin.fetch('/api/table/Nope/x'), 404)
    expect(
      (
        await admin.fetch('/api/table/Nope', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(404)
    await expectStatus(await admin.fetch('/api/table/Nope/x', { method: 'DELETE' }), 404)
  })

  test('validation errors surface through the resource layer field-wise', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post(`/api/table/${encodeURIComponent(DT)}`, { stars: 'bad' }),
    ).rejects.toMatchObject({
      status: 417,
      fields: {
        title: expect.anything(),
        stars: expect.anything(),
      },
    })
  })

  test('POST never treats a row URL or a read action as a write action', async ({ admin }) => {
    await setup(admin)
    const row = await admin.post<{ row_id: string; title: string }>(`/api/table/${encodeURIComponent(DT)}`, { title: 'unchanged' })
    for (const [path, message] of [
      [`/api/table/${encodeURIComponent(DT)}/${row.row_id}`, 'Expected a row action, e.g. :submit'],
      [`/api/table/${encodeURIComponent(DT)}/${row.row_id}:connections`, 'No writable row action ":connections"'],
      [`/api/table/${encodeURIComponent(DT)}:count`, 'No writable collection action ":count"'],
    ]) {
      const response = await admin.fetch(path, { method: 'POST', body: JSON.stringify({ title: 'must not write' }) })
      await expectStatus(response, 404)
      expect(await response.json()).toMatchObject({ error: { type: 'NotFoundError', message } })
    }
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${row.row_id}`)).toMatchObject({ title: 'unchanged' })
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}`)).toMatchObject({ total: 1 })
  })
})

describe('JSON command validation at the HTTP boundary', () => {
  // Truncated JSON must receive the same useful validation as an empty object,
  // not an internal parser error or a successful command with absent arguments.
  for (const [method, path, message] of [
    ['POST', '/api/events', 'Expected { events: [{ kind, key, … }] } (max 50)'],
    ['POST', '/api/saved_views', 'Expected { table, label, filters: [[col, op, value], …] }'],
    ['POST', '/api/saved_views/view-missing/share', 'Expected { shared: boolean }'],
    ['POST', '/api/row_titles', 'Expected { rows: [{ table, row_id }] } (max 100)'],
    ['POST', '/api/people/names', 'Expected { ids: [...] }'],
    ['POST', '/api/setup/system-managers', 'Name at least one person, each with an email address'],
    ['POST', '/api/set_theme', 'theme must be one of light, dark, device'],
    ['POST', '/api/set_language', 'Expected a language code like "en" or "fr"'],
    ['POST', '/api/people/Administrator/identities', 'Expected { method }'],
    ['POST', '/api/access_tokens', 'Expected { label }'],
    ['POST', '/api/service_accounts', 'Expected { label }'],
    ['PATCH', '/api/service_accounts/missing', 'Expected either { label } or { enabled }'],
    ['POST', '/api/service_accounts/missing/roles', 'Expected { roles: [...] }'],
    ['POST', '/api/access_log', 'Expected { table }'],
    ['POST', '/api/dashboard/count', 'Expected { table }'],
    ['POST', '/api/dashboard/chart', 'Expected { table, group_by }'],
    ['POST', '/api/pin_chart_to_dashboard', 'Expected { dashboard, chart }'],
    ['POST', '/api/permissions/Person', 'Expected { role }'],
    ['POST', '/api/glossary/take_app_wording', 'Expected { id }'],
    ['POST', '/api/preview_app_upgrade', 'Expected application name, target version and reviewed planId for upgrade'],
    ['POST', '/api/upgrade_app', 'Expected application name, target version and reviewed planId for upgrade'],
    ['POST', '/api/activate_app_upgrade', 'Expected application name, target version and reviewed planId for upgrade'],
    ['POST', '/api/install_app', 'Expected { name } or { manifest }'],
    ['POST', '/api/uninstall_app', 'Expected { name }'],
    ['POST', '/api/run_auto_email_report', 'Expected { row_id }'],
    ['POST', '/api/run_script_report', 'Expected { report }'],
    ['POST', '/api/retry_job', 'Expected { row_id }'],
  ]) {
    test(`${method} ${path} refuses malformed and missing arguments`, async ({ admin }) => {
      for (const body of ['{"unfinished":', '{}']) {
        const response = await admin.fetch(path, { method, body, headers: { 'content-type': 'application/json' } })
        await expectStatus(response, 417)
        expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message } })
      }
    })
  }
})
