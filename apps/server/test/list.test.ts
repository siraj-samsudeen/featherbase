import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'List Test Item'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed' },
      { fieldname: 'qty', fieldtype: 'Int' },
    ],
  })
  for (const [title, status, qty] of [
    ['alpha', 'Open', 1],
    ['beta', 'Open', 5],
    ['gamma', 'Closed', 3],
    ['delta', 'Closed', 9],
  ]) {
    await admin.post('/api/save_doc', { doctype: DT, doc: { title, status, qty } })
  }
}

const listPath = (params: Record<string, string>) =>
  `/api/list/${encodeURIComponent(DT)}?${new URLSearchParams(params).toString()}`

describe('DOC-010: get_list with filters, fields, order_by, pagination', () => {
  test('filters by equality', async ({ admin }) => {
    await setup(admin)
    const body = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({
        filters: JSON.stringify([['status', '=', 'Open']]),
        fields: JSON.stringify(['name', 'title', 'qty']),
      }),
    )
    expect(body.total).toBe(2)
    expect(body.data.map((r: { title: string }) => r.title).sort()).toEqual(['alpha', 'beta'])
  })

  test('combines filters, supports like/in/>=', async ({ admin }) => {
    await setup(admin)
    const body = await admin.get<{ data: { title: string }[] }>(
      listPath({
        filters: JSON.stringify([
          ['status', 'in', ['Open', 'Closed']],
          ['qty', '>=', 3],
          ['title', 'like', '%a%'],
        ]),
        fields: JSON.stringify(['title']),
        order_by: 'qty desc',
      }),
    )
    expect(body.data.map((r: { title: string }) => r.title)).toEqual(['delta', 'beta', 'gamma'])
  })

  test('paginates with stable ordering and reports total', async ({ admin }) => {
    await setup(admin)
    const page1 = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({ order_by: 'qty asc', fields: JSON.stringify(['title']), limit_page_length: '2' }),
    )
    const page2 = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({
        order_by: 'qty asc',
        fields: JSON.stringify(['title']),
        limit_page_length: '2',
        limit_start: '2',
      }),
    )
    expect(page1.total).toBe(4)
    expect(page1.data.map((r: { title: string }) => r.title)).toEqual(['alpha', 'gamma'])
    expect(page2.data.map((r: { title: string }) => r.title)).toEqual(['beta', 'delta'])
  })

  test('errors cleanly on unknown filter/select/order fields and bad operators', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(
      admin.get(listPath({ filters: JSON.stringify([['nope', '=', 1]]) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(listPath({ fields: JSON.stringify(['nope']) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.get(listPath({ order_by: 'nope desc' }))).rejects.toMatchObject({
      status: 417,
    })
    await expect(
      admin.get(listPath({ order_by: 'qty; drop table doctype' })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(listPath({ filters: JSON.stringify([['qty', '~', 1]]) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.get(listPath({ filters: 'not-json' }))).rejects.toMatchObject({
      status: 417,
    })
  })
})
