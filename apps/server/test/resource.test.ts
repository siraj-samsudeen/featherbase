import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Rest Project'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data', reqd: true },
      { fieldname: 'stars', fieldtype: 'Int' },
    ],
  })
}

describe('API-001/API-002: generic REST resource', () => {
  test('runs the full CRUD cycle through /api/resource with zero per-DocType code', async ({
    admin,
  }) => {
    await setup(admin)
    // CREATE
    const created = await admin.post<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}`,
      { title: 'proj-a', stars: 1 },
    )
    expect(created.name).toBeTruthy()

    // READ one
    const one = await admin.fetch(`/api/resource/${encodeURIComponent(DT)}/${created.name}`)
    expect(one.status).toBe(200)
    expect(((await one.json()) as Record<string, unknown>).title).toBe('proj-a')

    // UPDATE (PUT)
    const put = await admin.fetch(`/api/resource/${encodeURIComponent(DT)}/${created.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modified: created.modified, title: 'proj-b' }),
    })
    expect(put.status).toBe(200)
    expect(((await put.json()) as Record<string, unknown>).title).toBe('proj-b')

    // LIST with filters + pagination params
    for (const [t, s] of [['x1', 5], ['x2', 6], ['x3', 7]] as const)
      await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { title: t, stars: s })
    const qs = new URLSearchParams({
      filters: JSON.stringify([['stars', '>=', 5]]),
      fields: JSON.stringify(['name', 'title', 'stars']),
      order_by: 'stars desc',
      limit_page_length: '2',
    })
    const list = await admin.get<{ data: { title: string }[]; total: number }>(
      `/api/resource/${encodeURIComponent(DT)}?${qs}`,
    )
    expect(list.total).toBe(3)
    expect(list.data.map((r) => r.title)).toEqual(['x3', 'x2'])

    // DELETE
    const del = await admin.fetch(`/api/resource/${encodeURIComponent(DT)}/${created.name}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    expect(
      (await admin.fetch(`/api/resource/${encodeURIComponent(DT)}/${created.name}`)).status,
    ).toBe(404)
  })

  test('404s on unknown doctype for every verb', async ({ admin }) => {
    await setup(admin)
    expect((await admin.fetch('/api/resource/Nope')).status).toBe(404)
    expect((await admin.fetch('/api/resource/Nope/x')).status).toBe(404)
    expect(
      (
        await admin.fetch('/api/resource/Nope', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(404)
    expect((await admin.fetch('/api/resource/Nope/x', { method: 'DELETE' })).status).toBe(404)
  })

  test('validation errors surface through the resource layer field-wise', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post(`/api/resource/${encodeURIComponent(DT)}`, { stars: 'bad' }),
    ).rejects.toMatchObject({
      status: 417,
      fields: {
        title: expect.anything(),
        stars: expect.anything(),
      },
    })
  })
})
