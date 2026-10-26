import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { onEvent } from '../src/realtime'
import { test } from './pg-test'
import { makePerson } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

// UI-018: an @mention in a comment creates a Notification Log for each
// mentioned real user; unknown handles are ignored.

describe('UI-018: comment @mention notifications', () => {
  test('notifies mentioned real users and ignores unknown handles', async ({ admin }) => {
    // person-rename: a mention names a person by username or `@[Full Name]`,
    // never by row id (ids are opaque). An ambiguous name notifies nobody.
    const alice = await makePerson({ username: 'cmt-alice', full_name: 'Alice Cmt' })
    const bob = await makePerson({ full_name: 'Bob  Cmt Kumar' })
    const twin1 = await makePerson({ full_name: 'Cmt Twin' })
    const twin2 = await makePerson({ full_name: 'Cmt Twin' })
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Comment',
        row: {
          ref_table: 'Person',
          ref_name: alice,
          content: `hi @cmt-alice and @[bob cmt kumar], cc @ghost-user @[Cmt Twin] @${twin1}`,
        },
      }),
    })
    expect(res.status).toBe(201)

    const notifs = await sql`
      select for_user, subject from notification_log
      where ref_name = ${alice} order by for_user`
    const users = notifs.map((n) => n.for_user as string)
    expect(users.sort()).toEqual([alice, bob].sort())
    expect(users).not.toContain(twin1)
    expect(users).not.toContain(twin2)
    expect(users).not.toContain('ghost-user')
    expect(notifs[0].subject).toContain('mentioned you')
    // The actor is named by display name, not by id.
    expect(notifs[0].subject).not.toContain('psn_')
  })

  test('a comment that mentions someone only by full name notifies that person', async ({ admin }) => {
    const dana = await makePerson({ full_name: 'Dana Cmt Only' })
    await admin.post('/api/save_row', {
      table: 'Comment',
      row: { ref_table: 'Person', ref_name: dana, content: 'thanks @[Dana Cmt Only]' },
    })
    const notifs = await sql`select for_user from notification_log where ref_name = ${dana}`
    expect(notifs.map((n) => n.for_user)).toEqual([dana])
  })

  test('a comment with no mentions creates no notifications', async ({ admin }) => {
    const before = (await sql`select count(*)::int as c from notification_log`)[0].c as number
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Comment',
        row: { ref_table: 'Person', ref_name: 'Administrator', content: 'no mentions here' },
      }),
    })
    expect(res.status).toBe(201)
    const after = (await sql`select count(*)::int as c from notification_log`)[0].c as number
    expect(after).toBe(before)
  })
})

// Comment on a row: the people a role lets comment, and who then sees it.
const CMT_DT = 'Cmt Req Doc'

async function commentWorld(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: CMT_DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'due', column_type: 'Date' },
    ],
  })
  for (const r of ['Cmt Req Reader', 'Cmt Req Commenter'])
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: r } })
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: CMT_DT, role: 'Cmt Req Reader', tier: 'basic', can_read: true },
  })
  for (const role of ['Cmt Req Reader', 'Cmt Req Commenter'])
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Comment', role, tier: 'basic', can_read: true, can_create: true, can_write: true },
    })
  return admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
    table: CMT_DT,
    row: { title: 'discuss', due: '2026-11-01' },
  })
}

const postComment = (user: TestClient, row: string, content: string) =>
  user.fetch('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({ table: 'Comment', row: { ref_table: CMT_DT, ref_name: row, content } }),
  })

describe('Comment on a row', () => {
  test('a comment from someone allowed to comment is seen by another person who can read the row', async ({
    admin,
    createUser,
  }) => {
    const doc = await commentWorld(admin)
    const author = await createUser({ roles: ['Cmt Req Reader'] })
    const reader = await createUser({ roles: ['Cmt Req Reader'] })
    expect((await postComment(author, doc.row_id, 'Following up with the supplier')).status).toBe(201)

    const activity = await reader.get<{ comments: { content: string }[] }>(
      `/api/activity/${encodeURIComponent(CMT_DT)}/${doc.row_id}`,
    )
    expect(activity.comments.map((c) => c.content)).toEqual(['Following up with the supplier'])
  })

  test('someone who is not allowed to comment is refused', async ({ admin, createUser }) => {
    const doc = await commentWorld(admin)
    const outsider = await createUser({ roles: [] })
    expect((await postComment(outsider, doc.row_id, 'let me in')).status).toBe(403)
    expect((await sql`select 1 from comment where ref_name = ${doc.row_id}`).length).toBe(0)
  })

  // #507: a role that may comment but may not read the row's Table cannot
  // comment on that row by naming it.
  test('someone who cannot read the row cannot comment on it', async ({ admin, createUser }) => {
    const doc = await commentWorld(admin)
    const commenter = await createUser({ roles: ['Cmt Req Commenter'] })
    expect((await postComment(commenter, doc.row_id, 'I should not be here')).status).toBe(403)
  })
})

describe('Mention someone in a comment', () => {
  test('a mention by username notifies that person, and an email address mentions nobody', async ({ admin }) => {
    const doc = await commentWorld(admin)
    const gmail = await makePerson({ username: 'gmail' })
    const priya = await makePerson({ username: 'priya.m', full_name: 'Priya M' })
    await postComment(admin, doc.row_id, `ask me at ravi@gmail.com, but @Priya.M can see this`)

    const users = (await sql`select for_user from notification_log where ref_name = ${doc.row_id}`).map((n) => n.for_user)
    expect(users).toEqual([priya])
    expect(users).not.toContain(gmail)
  })
})

describe('Get notified when you\'re mentioned in a comment', () => {
  test('the person mentioned gets a notification linking to the row, and their unread count goes up live', async ({ admin, createUser }) => {
    const doc = await commentWorld(admin)
    const teammate = await createUser({ roles: [] })
    await sql`update person set username = 'mention-mate' where row_id = ${teammate.user}`
    const heard: { channel: string; event: string }[] = []
    const stop = onEvent((e) => heard.push(e))
    await postComment(admin, doc.row_id, 'please look, @mention-mate')
    stop()

    expect(heard).toContainEqual(expect.objectContaining({ channel: `user:${teammate.user}`, event: 'notification' }))
    expect((await teammate.get<{ count: number }>('/api/unread_count')).count).toBe(1)
    const [note] = await sql`select ref_table, ref_name from notification_log where for_user = ${teammate.user}`
    expect(note).toMatchObject({ ref_table: CMT_DT, ref_name: doc.row_id })
  })
})

describe('See a row\'s whole history in order', () => {
  test('the timeline lists a date change with from and to, then the comment that followed', async ({ admin }) => {
    const doc = await commentWorld(admin)
    await admin.post('/api/save_row', {
      table: CMT_DT,
      row: { row_id: doc.row_id, updated_at: doc.updated_at, due: '2026-12-15' },
    })
    await postComment(admin, doc.row_id, 'moved the date')

    const activity = await admin.get<{
      comments: { content: string; created_at: string }[]
      versions: { data: { changed: [string, unknown, unknown][] }; created_at: string }[]
    }>(`/api/activity/${encodeURIComponent(CMT_DT)}/${doc.row_id}`)
    expect(activity.versions).toHaveLength(1)
    const [field, from, to] = activity.versions[0].data.changed[0]
    expect(field).toBe('due')
    expect(String(from)).toContain('2026-11-01')
    expect(String(to)).toContain('2026-12-15')
    expect(activity.comments.map((c) => c.content)).toEqual(['moved the date'])
    expect(new Date(activity.versions[0].created_at).getTime()).toBeLessThanOrEqual(
      new Date(activity.comments[0].created_at).getTime(),
    )
  })

  test('a Table that does not keep change history shows comments only', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Cmt Req NoHist', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await sql`update table_def set track_changes = false where name = 'Cmt Req NoHist'`
    invalidateMeta('Cmt Req NoHist')
    const doc = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'Cmt Req NoHist', row: { title: 'a' } })
    await admin.post('/api/save_row', { table: 'Cmt Req NoHist', row: { row_id: doc.row_id, updated_at: doc.updated_at, title: 'b' } })
    const activity = await admin.get<{ versions: unknown[] }>(`/api/activity/Cmt%20Req%20NoHist/${doc.row_id}`)
    expect(activity.versions).toEqual([])
  })
})
