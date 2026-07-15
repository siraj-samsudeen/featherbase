import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const DT = 'List Test Item'
const TABLE = 'tab_list_test_item'

beforeAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await app.request('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed' },
        { fieldname: 'qty', fieldtype: 'Int' },
      ],
    }),
  })
  for (const [title, status, qty] of [
    ['alpha', 'Open', 1],
    ['beta', 'Open', 5],
    ['gamma', 'Closed', 3],
    ['delta', 'Closed', 9],
  ]) {
    await app.request('/api/save_doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctype: DT, doc: { title, status, qty } }),
    })
  }
})

afterAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

async function list(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return app.request(`/api/list/${encodeURIComponent(DT)}?${qs}`)
}

describe('DOC-010: get_list with filters, fields, order_by, pagination', () => {
  it('filters by equality', async () => {
    const res = await list({
      filters: JSON.stringify([['status', '=', 'Open']]),
      fields: JSON.stringify(['name', 'title', 'qty']),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.data.map((r: { title: string }) => r.title).sort()).toEqual(['alpha', 'beta'])
  })

  it('combines filters, supports like/in/>=', async () => {
    const res = await list({
      filters: JSON.stringify([
        ['status', 'in', ['Open', 'Closed']],
        ['qty', '>=', 3],
        ['title', 'like', '%a%'],
      ]),
      fields: JSON.stringify(['title']),
      order_by: 'qty desc',
    })
    const body = await res.json()
    expect(body.data.map((r: { title: string }) => r.title)).toEqual(['delta', 'beta', 'gamma'])
  })

  it('paginates with stable ordering and reports total', async () => {
    const page1 = await (
      await list({ order_by: 'qty asc', fields: JSON.stringify(['title']), limit_page_length: '2' })
    ).json()
    const page2 = await (
      await list({
        order_by: 'qty asc',
        fields: JSON.stringify(['title']),
        limit_page_length: '2',
        limit_start: '2',
      })
    ).json()
    expect(page1.total).toBe(4)
    expect(page1.data.map((r: { title: string }) => r.title)).toEqual(['alpha', 'gamma'])
    expect(page2.data.map((r: { title: string }) => r.title)).toEqual(['beta', 'delta'])
  })

  it('errors cleanly on unknown filter/select/order fields and bad operators', async () => {
    expect((await list({ filters: JSON.stringify([['nope', '=', 1]]) })).status).toBe(417)
    expect((await list({ fields: JSON.stringify(['nope']) })).status).toBe(417)
    expect((await list({ order_by: 'nope desc' })).status).toBe(417)
    expect((await list({ order_by: 'qty; drop table doctype' })).status).toBe(417)
    expect((await list({ filters: JSON.stringify([['qty', '~', 1]]) })).status).toBe(417)
    expect((await list({ filters: 'not-json' })).status).toBe(417)
  })
})
