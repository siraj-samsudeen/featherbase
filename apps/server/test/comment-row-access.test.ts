import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { createUserWithRole, grantRole, patchDoc, tableRef } from './fixtures'
import { countDocs } from '../src/query'

// #342: a comment or an edit is about one row, so it is readable only where
// that row is — whatever the reader's grant on the Comment and Version
// Tables themselves says. History is also kept from a reader who cannot see
// every column of the row, since a change can carry a restricted value.
const DT = 'Cra Case'
const PLAIN = 'Cra Note'
const ROLE = 'Cra Agent'
const cases = tableRef(DT)
const notes = tableRef(PLAIN)
const COMMENT = tableRef('Comment')
const VERSION = tableRef('Version')

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/table_def', {
    name: DT,
    track_changes: true,
    columns: [
      { column_name: 'subject', column_type: 'Data' },
      { column_name: 'payout', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  await admin.post('/api/table_def', {
    name: PLAIN,
    track_changes: true,
    columns: [{ column_name: 'subject', column_type: 'Data' }],
  })
  // The agent reads only the rows they created, but holds broad read (and
  // create) on Comment and Version, as an app's grant might give everyone.
  const agent = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: [DT, PLAIN],
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
    own_rows_only: true,
  })
  await grantRole(admin, { role: ROLE, table: ['Comment', 'Version'], tier: 'basic', can_read: true, can_create: true })
  const theirs = await admin.post<Record<string, any>>('/api/save_row', { table: PLAIN, row: { subject: 'Not yours' } })
  const mine = await agent.post<Record<string, any>>('/api/save_row', { table: PLAIN, row: { subject: 'Yours' } })
  for (const [row, text] of [[theirs, 'secret plan'], [mine, 'my note']] as const)
    await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: PLAIN, ref_name: row.row_id, content: text } })
  return { agent, theirs: String(theirs.row_id), mine: String(mine.row_id) }
}

const listOf = (client: TestClient, table: ReturnType<typeof tableRef>, refTable: string, fields: string[]) =>
  client.get<{ data: Record<string, any>[]; total: number }>(
    table.listUrl({ fields, filters: [['ref_table', '=', refTable]] }),
  )

describe('#342: comments follow the row they are on', () => {
  test('a broad Comment grant lists only the comments on rows the reader may open', async ({ admin, createUser }) => {
    const { agent } = await setup(admin, createUser)
    const seen = await listOf(agent, COMMENT, PLAIN, ['content'])
    expect(seen.data.map((c) => c.content)).toEqual(['my note'])
    expect(seen.total).toBe(1)
    expect(await countDocs('Comment', [['ref_table', '=', PLAIN]], agent.user!)).toBe(1)
    // The same list, unfiltered, still holds nothing from the other row.
    const all = await agent.get<{ data: Record<string, any>[] }>(COMMENT.listUrl({ fields: ['content'] }))
    expect(all.data.map((c) => c.content)).not.toContain('secret plan')
  })

  test('a comment on a row the reader cannot open cannot be opened by its id', async ({ admin, createUser }) => {
    const { agent, theirs } = await setup(admin, createUser)
    const [comment] = (await listOf(admin, COMMENT, PLAIN, ['row_id', 'ref_name'])).data.filter((c) => c.ref_name === theirs)
    const res = await agent.fetch(COMMENT.rowUrl(comment.row_id))
    expect(res.status).toBe(403)
  })

  test('a row shared with the reader shows its comments', async ({ admin, createUser }) => {
    const { agent, theirs } = await setup(admin, createUser)
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: PLAIN, share_name: theirs, person: agent.user, read: true } })
    const seen = await listOf(agent, COMMENT, PLAIN, ['content'])
    expect(seen.data.map((c) => c.content).sort()).toEqual(['my note', 'secret plan'])
  })

  test('the row’s activity lists its comments with their ids', async ({ admin, createUser }) => {
    const { agent, mine } = await setup(admin, createUser)
    const activity = await agent.get<{ comments: { row_id: string; content: string }[] }>(
      `/api/activity/${encodeURIComponent(PLAIN)}/${mine}`,
    )
    expect(activity.comments).toEqual([expect.objectContaining({ content: 'my note', row_id: expect.any(String) })])
    const res = await agent.fetch(`/api/activity/${encodeURIComponent(PLAIN)}/${encodeURIComponent('nope')}`)
    expect(res.status).toBe(404)
  })
})

describe('#342: history follows the row and its columns', () => {
  test('edits are listed only for rows the reader may open', async ({ admin, createUser }) => {
    const { agent, theirs, mine } = await setup(admin, createUser)
    for (const name of [theirs, mine]) {
      const cur = await admin.get<Record<string, any>>(notes.rowUrl(name))
      await patchDoc(admin, notes.rowUrl(name), { updated_at: cur.updated_at, subject: `${cur.subject} (edited)` })
    }
    const seen = await listOf(agent, VERSION, PLAIN, ['ref_name'])
    expect(seen.data.map((v) => v.ref_name)).toEqual([mine])
  })

  test('a reader without the restricted tier gets no list of a Table’s edits, only the row’s activity', async ({ admin, createUser }) => {
    const { agent } = await setup(admin, createUser)
    const row = await agent.post<Record<string, any>>('/api/save_row', { table: DT, row: { subject: 'Refund' } })
    const cur = await admin.get<Record<string, any>>(cases.rowUrl(row.row_id))
    await patchDoc(admin, cases.rowUrl(row.row_id), { updated_at: cur.updated_at, subject: 'Refund due', payout: 9876 })

    const seen = await listOf(agent, VERSION, DT, ['data'])
    expect(seen.data).toEqual([])
    const activity = await agent.get<{ versions: { data: { changed: [string, unknown, unknown][] } }[] }>(
      `/api/activity/${encodeURIComponent(DT)}/${row.row_id}`,
    )
    expect(activity.versions.flatMap((v) => v.data.changed.map(([f]) => f))).toEqual(['subject'])
    expect(JSON.stringify(activity)).not.toContain('9876')
  })
})
