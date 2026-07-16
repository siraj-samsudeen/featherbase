import { randomBytes } from 'node:crypto'
import type { DocTypeController } from '../controllers'
import { sql } from '../db'

// UI-018: when a comment is posted, every @mentioned user that exists gets
// a Notification Log row. Runs inside the comment's save transaction.
const MENTION = /@([\w.@-]+)/g

const controller: DocTypeController = {
  doctype: 'Comment',
  hooks: {
    after_insert: async ({ doc, tx, user }) => {
      const content = String(doc.content ?? '')
      const mentioned = new Set<string>()
      for (const m of content.matchAll(MENTION)) mentioned.add(m[1])
      if (!mentioned.size) return
      const stx = (tx ?? sql) as typeof sql

      // Only notify names that resolve to real users.
      const users = await stx`
        select name from tab_user where name in ${stx([...mentioned])}`
      for (const u of users) {
        const target = u.name as string
        await stx`
          insert into tab_notification_log
            (name, owner, modified_by, for_user, subject, ref_doctype, ref_name, read)
          values (
            ${randomBytes(5).toString('hex')}, ${user}, ${user}, ${target},
            ${`${user} mentioned you in a comment`},
            ${String(doc.ref_doctype ?? '')}, ${String(doc.ref_name ?? '')}, false
          )`
      }
    },
  },
}

export default controller
