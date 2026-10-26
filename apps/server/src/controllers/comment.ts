import { randomBytes } from 'node:crypto'
import type { TableController } from '../controllers'
import { sql } from '../db'
import { publishUserEvent } from '../realtime'
import { afterDocumentCommit } from '../action-transaction'
import { getDoc } from '../document'

// UI-018: when a comment is posted, every @mentioned person gets a
// Notification Log row. RT-003: each also receives a realtime notification
// event so their unread count updates without a reload.
//
// person-rename: a mention names a person, never a row id (ids are opaque):
// `@username`, or `@[Full Name]` for someone without a username. A name that
// matches no one, or more than one person, notifies nobody — never a guess.
// The address rule is about shape, not a list of domains: an `@` that follows
// a non-space character is inside an address (`name@gmail.com`) and mentions
// nobody; an `@` that starts a word is a mention (`@ravi.m`), which notifies
// only if someone holds that username.
const MENTION = /(?<![\w.@-])@\[([^\]\n]{1,140})\]|(?<![\w.@-])@([a-z0-9][a-z0-9._-]{2,63})/gi

export function mentionedNames(content: string): { usernames: string[]; names: string[] } {
  const usernames = new Set<string>()
  const names = new Set<string>()
  for (const m of content.matchAll(MENTION)) {
    if (m[1]) names.add(m[1].trim().replace(/\s+/g, ' ').toLowerCase())
    // A full stop after a mention is punctuation.
    else if (m[2]) usernames.add(m[2].toLowerCase().replace(/[._-]+$/, ''))
  }
  return { usernames: [...usernames], names: [...names] }
}

const controller: TableController = {
  table: 'Comment',
  hooks: {
    // #507: a comment is about a row, so only someone who may open that row
    // can comment on it — otherwise a mention would hand others a link to a
    // row the commenter was never shown.
    validate: async ({ row, user }) => {
      if (row.ref_table && row.ref_name) await getDoc(String(row.ref_table), String(row.ref_name), user)
    },
    after_insert: async ({ row, tx, user }) => {
      const content = String(row.content ?? '')
      const { usernames, names } = mentionedNames(content)
      if (!usernames.length && !names.length) return
      const stx = (tx ?? sql) as typeof sql

      const byUsername = usernames.length
        ? await stx`select row_id from person where not built_in and enabled and lower(username) in ${stx(usernames)}`
        : []
      const byName = names.length
        ? await stx`
            select min(row_id) as row_id from person
            where not built_in and enabled and lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) in ${stx(names)}
            group by lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) having count(*) = 1`
        : []
      const users = [...new Map([...byUsername, ...byName].map((r) => [String(r.row_id), r])).values()]
      const [actor] = await stx`
        select coalesce(full_name, row_id) as name from person where row_id = ${user}
        union all select label from service_account where row_id = ${user}`
      const who = String(actor?.name ?? user)
      const notified: string[] = []
      for (const u of users) {
        const target = u.row_id as string
        await stx`
          insert into notification_log
            (row_id, created_by, updated_by, for_user, subject, ref_table, ref_name, read)
          values (
            ${randomBytes(5).toString('hex')}, ${user}, ${user}, ${target},
            ${`${who} mentioned you in a comment`},
            ${String(row.ref_table ?? '')}, ${String(row.ref_name ?? '')}, false
          )`
        notified.push(target)
      }
      // RT-003: notify after the row exists so the recipient's unread query
      // (triggered by the event) sees the new notification.
      await afterDocumentCommit(async () => {
        for (const target of notified)
          publishUserEvent(target, 'notification', {
            subject: `${who} mentioned you in a comment`,
          })
      })
    },
  },
}

export default controller
