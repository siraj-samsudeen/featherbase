import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { createUserWithRole, grantRole, tableRef } from './fixtures'
import { sql } from '../src/db'

// #609: a file attached to a row is only as visible as that row, whatever
// the reader's grant on File says. A file on a whole Table, or on nothing,
// stays with the File grant.
// #610: a comment (or a file) on a row is removed only by someone who may
// open that row.
const PLAIN = 'Rafd Note'
const ROLE = 'Rafd Agent'
const FILE = tableRef('File')
const COMMENT = tableRef('Comment')

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/table_def', { name: PLAIN, columns: [{ column_name: 'subject', column_type: 'Data' }] })
  // The agent reads only the rows they created, but holds broad read, edit
  // and delete on Comment and File.
  const agent = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: PLAIN,
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
    own_rows_only: true,
  })
  await grantRole(admin, {
    role: ROLE,
    table: ['Comment', 'File'],
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
    can_delete: true,
  })
  const theirs = String((await admin.post<Record<string, any>>('/api/save_row', { table: PLAIN, row: { subject: 'Not yours' } })).row_id)
  const mine = String((await agent.post<Record<string, any>>('/api/save_row', { table: PLAIN, row: { subject: 'Yours' } })).row_id)
  const file = async (file_name: string, ref: Record<string, string>) =>
    String((await admin.post<Record<string, any>>('/api/save_row', {
      table: 'File',
      row: { file_name, file_url: `/files/rafd-${file_name}`, is_private: false, ...ref },
    })).row_id)
  const comment = async (content: string, ref_name: string) =>
    String((await admin.post<Record<string, any>>('/api/save_row', {
      table: 'Comment',
      row: { ref_table: PLAIN, ref_name, content },
    })).row_id)
  return {
    agent,
    theirs,
    mine,
    files: {
      theirs: await file('payslip.pdf', { ref_table: PLAIN, ref_name: theirs }),
      mine: await file('receipt.pdf', { ref_table: PLAIN, ref_name: mine }),
      onTable: await file('template.pdf', { ref_table: PLAIN }),
      loose: await file('logo.png', {}),
    },
    comments: { theirs: await comment('secret plan', theirs), mine: await comment('my note', mine) },
  }
}

const fileNames = async (client: TestClient, filters: [string, string, unknown][] = []) =>
  (await client.get<{ data: Record<string, any>[] }>(FILE.listUrl({ fields: ['file_name'], filters, limit_page_length: 500 })))
    .data.map((f) => f.file_name as string)

describe('#609: files follow the row they are attached to', () => {
  test('a broad File grant lists only the files on rows the reader may open, plus table and loose files', async ({ admin, createUser }) => {
    const { agent } = await setup(admin, createUser)
    const all = await fileNames(agent)
    expect(all).toEqual(expect.arrayContaining(['receipt.pdf', 'template.pdf', 'logo.png']))
    expect(all).not.toContain('payslip.pdf')
    // The row's own file panel names its Table, and gets the same answer.
    const onTable = await fileNames(agent, [['ref_table', '=', PLAIN]])
    expect(onTable.sort()).toEqual(['receipt.pdf', 'template.pdf'])
  })

  test('a file on a row the reader cannot open cannot be opened by its id', async ({ admin, createUser }) => {
    const { agent, files } = await setup(admin, createUser)
    expect((await agent.fetch(FILE.rowUrl(files.theirs))).status).toBe(403)
    expect((await agent.fetch(FILE.rowUrl(files.mine))).status).toBe(200)
    expect((await agent.fetch(FILE.rowUrl(files.onTable))).status).toBe(200)
  })

  test('a row shared with the reader shows its files', async ({ admin, createUser }) => {
    const { agent, theirs } = await setup(admin, createUser)
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: PLAIN, share_name: theirs, person: agent.user, read: true } })
    expect(await fileNames(agent, [['ref_table', '=', PLAIN]])).toContain('payslip.pdf')
  })
})

describe('#609: attaching follows the row too', () => {
  test('a File row cannot be saved onto a row the writer cannot open', async ({ admin, createUser }) => {
    const { agent, theirs } = await setup(admin, createUser)
    const res = await agent.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'File', row: { file_name: 'x.pdf', file_url: '/files/rafd-x.pdf', ref_table: PLAIN, ref_name: theirs } }),
    })
    expect(res.status).toBe(403)
  })

  test('nothing is attached to another file or comment, and one stored that way is refused, not followed', async ({ admin, createUser }) => {
    const { agent, files } = await setup(admin, createUser)
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'File', row: { file_name: 'y.pdf', file_url: '/files/rafd-y.pdf', ref_table: 'File', ref_name: files.mine } }),
    })
    expect(res.status).toBe(417)
    // Two files pointing at each other, as only a direct write could leave them.
    await sql`update file set ref_table = 'File', ref_name = ${files.loose} where row_id = ${files.mine}`
    await sql`update file set ref_table = 'File', ref_name = ${files.mine} where row_id = ${files.loose}`
    expect((await agent.fetch(FILE.rowUrl(files.mine))).status).toBe(403)
    expect((await agent.fetch(FILE.rowUrl(files.mine), { method: 'DELETE' })).status).toBe(403)
  })

  test('the files on a source-bound row show to whoever may read every row of it', async ({ admin, createUser }) => {
    const { agent } = await setup(admin, createUser)
    await admin.post('/api/table_def', { name: 'Rafd Outside', id_pattern: 'prompt', columns: [{ column_name: 'subject', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: 'Rafd Outside', row: { row_id: 'o-1', subject: 'Outside' } })
    await grantRole(admin, { role: ROLE, table: 'Rafd Outside', tier: 'basic', can_read: true })
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'outside.pdf', file_url: '/files/rafd-o.pdf', ref_table: 'Rafd Outside', ref_name: 'o-1' } })
    await sql`update table_def set data_source = 'outside-db' where name = 'Rafd Outside'`
    expect(await fileNames(agent, [['ref_table', '=', 'Rafd Outside']])).toEqual(['outside.pdf'])
  })
})

describe('#610: removing a comment or a file needs access to its row', () => {
  test('a comment on a row the caller cannot open is not deleted by its id', async ({ admin, createUser }) => {
    const { agent, comments } = await setup(admin, createUser)
    const res = await agent.fetch(COMMENT.rowUrl(comments.theirs), { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await sql`select 1 from comment where row_id = ${comments.theirs}`).toHaveLength(1)
    // A comment on their own row is theirs to remove.
    expect((await agent.fetch(COMMENT.rowUrl(comments.mine), { method: 'DELETE' })).status).toBe(200)
  })

  test('a comment on a row the caller cannot open is not edited by its id', async ({ admin, createUser }) => {
    const { agent, comments } = await setup(admin, createUser)
    const [cur] = await sql`select updated_at from comment where row_id = ${comments.theirs}`
    const res = await agent.fetch(COMMENT.rowUrl(comments.theirs), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, content: 'rewritten' }),
    })
    expect(res.status).toBe(403)
    const [after] = await sql`select content from comment where row_id = ${comments.theirs}`
    expect(after.content).toBe('secret plan')
  })

  test('a comment on a row the caller cannot open is not moved onto one they can', async ({ admin, createUser }) => {
    const { agent, mine, comments } = await setup(admin, createUser)
    const [cur] = await sql`select updated_at from comment where row_id = ${comments.theirs}`
    const res = await agent.fetch(COMMENT.rowUrl(comments.theirs), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, ref_name: mine }),
    })
    expect(res.status).toBe(403)
    const [after] = await sql`select ref_name from comment where row_id = ${comments.theirs}`
    expect(after.ref_name).not.toBe(mine)
  })

  test('a file on a row the caller cannot open is not deleted by its id', async ({ admin, createUser }) => {
    const { agent, files } = await setup(admin, createUser)
    const res = await agent.fetch(FILE.rowUrl(files.theirs), { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await sql`select 1 from file where row_id = ${files.theirs}`).toHaveLength(1)
  })
})



