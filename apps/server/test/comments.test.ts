import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'
import { makePerson } from './fixtures'

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
          ref_name: 'cmt-srv-doc',
          content: `hi @cmt-alice and @[bob cmt kumar], cc @ghost-user @[Cmt Twin] @${twin1}`,
        },
      }),
    })
    expect(res.status).toBe(201)

    const notifs = await sql`
      select for_user, subject from notification_log
      where ref_name = 'cmt-srv-doc' order by for_user`
    const users = notifs.map((n) => n.for_user as string)
    expect(users.sort()).toEqual([alice, bob].sort())
    expect(users).not.toContain(twin1)
    expect(users).not.toContain(twin2)
    expect(users).not.toContain('ghost-user')
    expect(notifs[0].subject).toContain('mentioned you')
    // The actor is named by display name, not by id.
    expect(notifs[0].subject).not.toContain('psn_')
  })

  test('a comment with no mentions creates no notifications', async ({ admin }) => {
    const before = (await sql`select count(*)::int as c from notification_log`)[0].c as number
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Comment',
        row: { ref_table: 'Person', ref_name: 'cmt-srv-doc', content: 'no mentions here' },
      }),
    })
    expect(res.status).toBe(201)
    const after = (await sql`select count(*)::int as c from notification_log`)[0].c as number
    expect(after).toBe(before)
  })
})
