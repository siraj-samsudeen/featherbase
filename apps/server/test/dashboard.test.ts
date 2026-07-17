import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { countDocs, groupCount } from '../src/query'

// UI-026: dashboard aggregates (countDocs / groupCount) count and group live
// data with the same permission scoping as the list query.

const DT = 'Dash Srv Task'
const STATUSES = ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending']

// Each test rebuilds the DocType + rows inside its own rolled-back tx.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed\nPending' },
    ],
  })
  for (const status of STATUSES)
    await admin.post('/api/save_doc', { doctype: DT, doc: { title: 't', status } })
}

describe('UI-026: dashboard aggregates', () => {
  test('countDocs counts all and filtered documents', async ({ admin }) => {
    await setup(admin)
    expect(await countDocs(DT, [], 'Administrator')).toBe(6)
    expect(await countDocs(DT, [['status', '=', 'Open']], 'Administrator')).toBe(3)
    expect(await countDocs(DT, [['status', '=', 'Closed']], 'Administrator')).toBe(2)
  })

  test('groupCount groups by a field, ordered by descending count', async ({ admin }) => {
    await setup(admin)
    const rows = await groupCount(DT, 'status', [], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
      { label: 'Pending', value: 1 },
    ])
  })

  test('respects filters in grouped counts', async ({ admin }) => {
    await setup(admin)
    const rows = await groupCount(DT, 'status', [['status', '!=', 'Pending']], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
    ])
  })

  test('enforces read permission (a user without read cannot count)', async ({ admin }) => {
    await setup(admin)
    await expect(countDocs(DT, [], 'Guest')).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(groupCount(DT, 'status', [], 'Guest')).rejects.toMatchObject({
      type: 'PermissionError',
    })
  })
})
