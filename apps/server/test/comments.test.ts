import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'

// UI-018: an @mention in a comment creates a Notification Log for each
// mentioned real user; unknown handles are ignored.

describe('UI-018: comment @mention notifications', () => {
  test('notifies mentioned real users and ignores unknown handles', async ({ admin }) => {
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Comment',
        doc: {
          ref_doctype: 'User',
          ref_name: 'cmt-srv-doc',
          content: 'hi @Administrator and @Guest, cc @ghost-user',
        },
      }),
    })
    expect(res.status).toBe(201)

    const notifs = await sql`
      select for_user, subject from tab_notification_log
      where ref_name = 'cmt-srv-doc' order by for_user`
    const users = notifs.map((n) => n.for_user as string)
    expect(users).toContain('Administrator')
    expect(users).toContain('Guest')
    expect(users).not.toContain('ghost-user')
    expect(notifs[0].subject).toContain('mentioned you')
  })

  test('a comment with no mentions creates no notifications', async ({ admin }) => {
    const before = (await sql`select count(*)::int as c from tab_notification_log`)[0].c as number
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Comment',
        doc: { ref_doctype: 'User', ref_name: 'cmt-srv-doc', content: 'no mentions here' },
      }),
    })
    expect(res.status).toBe(201)
    const after = (await sql`select count(*)::int as c from tab_notification_log`)[0].c as number
    expect(after).toBe(before)
  })
})
