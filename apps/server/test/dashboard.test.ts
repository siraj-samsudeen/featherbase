import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { countDocs, groupCount } from '../src/query'
import { areq } from './helpers'

// UI-026: dashboard aggregates (countDocs / groupCount) count and group live
// data with the same permission scoping as the list query.

const DT = 'Dash Srv Task'
const STATUSES = ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending']

async function cleanup() {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_dash_srv_task')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed\nPending' },
      ],
    }),
  })
  for (const status of STATUSES)
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { title: 't', status } }),
    })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('UI-026: dashboard aggregates', () => {
  it('countDocs counts all and filtered documents', async () => {
    expect(await countDocs(DT, [], 'Administrator')).toBe(6)
    expect(await countDocs(DT, [['status', '=', 'Open']], 'Administrator')).toBe(3)
    expect(await countDocs(DT, [['status', '=', 'Closed']], 'Administrator')).toBe(2)
  })

  it('groupCount groups by a field, ordered by descending count', async () => {
    const rows = await groupCount(DT, 'status', [], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
      { label: 'Pending', value: 1 },
    ])
  })

  it('respects filters in grouped counts', async () => {
    const rows = await groupCount(DT, 'status', [['status', '!=', 'Pending']], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
    ])
  })

  it('enforces read permission (a user without read cannot count)', async () => {
    await expect(countDocs(DT, [], 'Guest')).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(groupCount(DT, 'status', [], 'Guest')).rejects.toMatchObject({
      type: 'PermissionError',
    })
  })
})
