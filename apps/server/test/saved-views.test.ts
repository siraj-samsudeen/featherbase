import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { issueSession } from '../src/auth'

// #101 Phase 6: saved views — owner-scoped CRUD, sharing, isolation.

const FILTERS = [['status', '=', 'Open'] as [string, string, unknown]]

describe('#101: /api/saved_views', () => {
  test('create + list round-trips the filter set; owner rows sort first', async ({ admin }) => {
    const created = await admin.post<{ row_id: string; mine: boolean }>('/api/saved_views', {
      table: 'Customer',
      label: 'Open ones',
      filters: FILTERS,
    })
    expect(created.mine).toBe(true)
    const list = await admin.get<{ views: Array<Record<string, unknown>> }>(
      '/api/saved_views?table=Customer',
    )
    const view = list.views.find((v) => v.row_id === created.row_id)!
    expect(view).toMatchObject({ label: 'Open ones', shared: false, mine: true })
    expect(view.filters).toEqual(FILTERS)
    // A different table's bar does not see it.
    const other = await admin.get<{ views: unknown[] }>('/api/saved_views?table=Item')
    expect(other.views).toHaveLength(0)
  })

  test('validation: missing filters or label is 417; missing ?table too', async ({ admin }) => {
    await expect(
      admin.post('/api/saved_views', { table: 'Customer', label: 'x', filters: [] }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/saved_views', { table: 'Customer', filters: FILTERS }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.get('/api/saved_views')).rejects.toMatchObject({ status: 417 })
  })

  test('private views stay private; sharing opens them read-only', async ({ admin, api }) => {
    const DT = 'SV Share DT'
    await admin.post('/api/table_def', {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    // The second user needs read on the Table itself to see its views.
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: DT, role: 'All', tier: 'basic', can_read: true },
    })
    const created = await admin.post<{ row_id: string }>('/api/saved_views', {
      table: DT,
      label: 'Mine only',
      filters: FILTERS,
    })
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'sv-user@x.com', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
    const auth = { authorization: `Bearer ${token}` }

    const before = await api.fetch(`/api/saved_views?table=${encodeURIComponent(DT)}`, {
      headers: auth,
    })
    expect(((await before.json()) as { views: unknown[] }).views).toHaveLength(0)

    await admin.post(`/api/saved_views/${created.row_id}/share`, { shared: true })
    const after = await api.fetch(`/api/saved_views?table=${encodeURIComponent(DT)}`, {
      headers: auth,
    })
    const views = ((await after.json()) as { views: Array<Record<string, unknown>> }).views
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ label: 'Mine only', shared: true, mine: false })

    // The non-owner can neither re-share nor delete it.
    const share = await api.fetch(`/api/saved_views/${created.row_id}/share`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ shared: false }),
    })
    expect(share.status).toBe(403)
    const del = await api.fetch(`/api/saved_views/${created.row_id}`, {
      method: 'DELETE',
      headers: auth,
    })
    expect(del.status).toBe(403)
  })

  // PR #104 review: without read permission on the referenced Table, a user
  // can neither browse its shared views nor publish chips for it.
  test('saved views respect Table read permission', async ({ admin, api }) => {
    const DT = 'SV Locked DT'
    await admin.post('/api/table_def', {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'sv-locked@x.com', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
    const auth = { authorization: `Bearer ${token}` }

    const list = await api.fetch(`/api/saved_views?table=${encodeURIComponent(DT)}`, {
      headers: auth,
    })
    expect(list.status).toBe(403)
    const create = await api.fetch('/api/saved_views', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ table: DT, label: 'sneaky', filters: FILTERS, shared: true }),
    })
    expect(create.status).toBe(403)

    // Granting read opens both.
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: DT, role: 'All', tier: 'basic', can_read: true },
    })
    const listOk = await api.fetch(`/api/saved_views?table=${encodeURIComponent(DT)}`, {
      headers: auth,
    })
    expect(listOk.status).toBe(200)
    const createOk = await api.fetch('/api/saved_views', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ table: DT, label: 'legit', filters: FILTERS }),
    })
    expect(createOk.status).toBe(201)
  })

  test('the owner can delete; a missing view 404s', async ({ admin }) => {
    const created = await admin.post<{ row_id: string }>('/api/saved_views', {
      table: 'Customer',
      label: 'Ephemeral',
      filters: FILTERS,
    })
    await admin.delete(`/api/saved_views/${created.row_id}`)
    const list = await admin.get<{ views: Array<{ row_id: string }> }>(
      '/api/saved_views?table=Customer',
    )
    expect(list.views.some((v) => v.row_id === created.row_id)).toBe(false)
    await expect(admin.delete(`/api/saved_views/${created.row_id}`)).rejects.toMatchObject({
      status: 404,
    })
  })
  // SPEC: Changing a saved view means saving over it — there is no way to edit
  // or rename one in place; the only changes are share/unshare and delete.
  test('a saved view cannot be edited or renamed in place', async ({ admin }) => {
    const created = await admin.post<{ row_id: string }>('/api/saved_views', {
      table: 'Customer',
      label: 'Original',
      filters: FILTERS,
    })
    for (const method of ['PUT', 'PATCH']) {
      const res = await admin.fetch(`/api/saved_views/${created.row_id}`, {
        method,
        body: JSON.stringify({ label: 'Renamed', filters: [['status', '=', 'Closed']] }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
    const list = await admin.get<{ views: Array<{ row_id: string; label: string; filters: unknown }> }>(
      '/api/saved_views?table=Customer',
    )
    expect(list.views.find((v) => v.row_id === created.row_id)).toMatchObject({
      label: 'Original',
      filters: FILTERS,
    })
  })

  // SPEC: A saved view is private unless its owner shares it — the owner can
  // take the sharing back, and teammates stop seeing it.
  test('the owner can make a shared view private again', async ({ admin, api }) => {
    const DT = 'SV Unshare DT'
    await admin.post('/api/table_def', {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: DT, role: 'All', tier: 'basic', can_read: true },
    })
    const created = await admin.post<{ row_id: string }>('/api/saved_views', {
      table: DT,
      label: 'Brief share',
      filters: FILTERS,
      shared: true,
    })
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'sv-unshare@x.com', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
    const url = `/api/saved_views?table=${encodeURIComponent(DT)}`
    const seen = async () =>
      ((await (await api.fetch(url, { headers: { authorization: `Bearer ${token}` } })).json()) as {
        views: unknown[]
      }).views.length

    expect(await seen()).toBe(1)
    await admin.post(`/api/saved_views/${created.row_id}/share`, { shared: false })
    expect(await seen()).toBe(0)
    const own = await admin.get<{ views: Array<{ shared: boolean }> }>(url)
    expect(own.views[0]).toMatchObject({ shared: false })
  })
})
