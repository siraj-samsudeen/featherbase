import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const DT = 'Rest Project'
const TABLE = 'tab_rest_project'

const req = (path: string, init?: RequestInit) =>
  areq(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })

beforeAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await req('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'stars', fieldtype: 'Int' },
      ],
    }),
  })
})

afterAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

describe('API-001/API-002: generic REST resource', () => {
  it('runs the full CRUD cycle through /api/resource with zero per-DocType code', async () => {
    // CREATE
    const created = (await (
      await req(`/api/resource/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'proj-a', stars: 1 }),
      })
    ).json()) as Record<string, unknown>
    expect(created.name).toBeTruthy()

    // READ one
    const one = await req(`/api/resource/${encodeURIComponent(DT)}/${created.name}`)
    expect(one.status).toBe(200)
    expect(((await one.json()) as Record<string, unknown>).title).toBe('proj-a')

    // UPDATE (PUT)
    const put = await req(`/api/resource/${encodeURIComponent(DT)}/${created.name}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: created.modified, title: 'proj-b' }),
    })
    expect(put.status).toBe(200)
    expect(((await put.json()) as Record<string, unknown>).title).toBe('proj-b')

    // LIST with filters + pagination params
    for (const [t, s] of [['x1', 5], ['x2', 6], ['x3', 7]] as const)
      await req(`/api/resource/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: t, stars: s }),
      })
    const qs = new URLSearchParams({
      filters: JSON.stringify([['stars', '>=', 5]]),
      fields: JSON.stringify(['name', 'title', 'stars']),
      order_by: 'stars desc',
      limit_page_length: '2',
    })
    const list = (await (
      await req(`/api/resource/${encodeURIComponent(DT)}?${qs}`)
    ).json()) as { data: { title: string }[]; total: number }
    expect(list.total).toBe(3)
    expect(list.data.map((r) => r.title)).toEqual(['x3', 'x2'])

    // DELETE
    const del = await req(`/api/resource/${encodeURIComponent(DT)}/${created.name}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    expect((await req(`/api/resource/${encodeURIComponent(DT)}/${created.name}`)).status).toBe(404)
  })

  it('404s on unknown doctype for every verb', async () => {
    expect((await req('/api/resource/Nope')).status).toBe(404)
    expect((await req('/api/resource/Nope/x')).status).toBe(404)
    expect(
      (await req('/api/resource/Nope', { method: 'POST', body: '{}' })).status,
    ).toBe(404)
    expect(
      (await req('/api/resource/Nope/x', { method: 'DELETE' })).status,
    ).toBe(404)
  })

  it('validation errors surface through the resource layer field-wise', async () => {
    const res = await req(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ stars: 'bad' }),
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.title).toBeTruthy()
    expect(body.error.fields.stars).toBeTruthy()
  })
})
