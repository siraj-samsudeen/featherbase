import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { issueSession } from '../src/auth'

// #101 Phase 6: saved views — owner-scoped CRUD, sharing, isolation.

const FILTERS = [['status', '=', 'Open'] as [string, string, unknown]]

describe('#101: /api/saved_views', () => {
  test('create + list round-trips the filter set; owner rows sort first', async ({ admin }) => {
    const created = await admin.post<{ name: string; mine: boolean }>('/api/saved_views', {
      table: 'Customer',
      label: 'Open ones',
      filters: FILTERS,
    })
    expect(created.mine).toBe(true)
    const list = await admin.get<{ views: Array<Record<string, unknown>> }>(
      '/api/saved_views?table=Customer',
    )
    const view = list.views.find((v) => v.name === created.name)!
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
    const created = await admin.post<{ name: string }>('/api/saved_views', {
      table: 'Customer',
      label: 'Mine only',
      filters: FILTERS,
    })
    await admin.post('/api/save_doc', {
      doctype: 'User',
      doc: { name: 'sv-user@x.com', email: 'sv-user@x.com', enabled: true },
    })
    const { token } = await issueSession('sv-user@x.com')
    const auth = { authorization: `Bearer ${token}` }

    const before = await api.fetch('/api/saved_views?table=Customer', { headers: auth })
    expect(((await before.json()) as { views: unknown[] }).views).toHaveLength(0)

    await admin.post(`/api/saved_views/${created.name}/share`, { shared: true })
    const after = await api.fetch('/api/saved_views?table=Customer', { headers: auth })
    const views = ((await after.json()) as { views: Array<Record<string, unknown>> }).views
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ label: 'Mine only', shared: true, mine: false })

    // The non-owner can neither re-share nor delete it.
    const share = await api.fetch(`/api/saved_views/${created.name}/share`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ shared: false }),
    })
    expect(share.status).toBe(403)
    const del = await api.fetch(`/api/saved_views/${created.name}`, {
      method: 'DELETE',
      headers: auth,
    })
    expect(del.status).toBe(403)
  })

  test('the owner can delete; a missing view 404s', async ({ admin }) => {
    const created = await admin.post<{ name: string }>('/api/saved_views', {
      table: 'Customer',
      label: 'Ephemeral',
      filters: FILTERS,
    })
    await admin.delete(`/api/saved_views/${created.name}`)
    const list = await admin.get<{ views: Array<{ name: string }> }>(
      '/api/saved_views?table=Customer',
    )
    expect(list.views.some((v) => v.name === created.name)).toBe(false)
    await expect(admin.delete(`/api/saved_views/${created.name}`)).rejects.toMatchObject({
      status: 404,
    })
  })
})
