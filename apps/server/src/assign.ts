import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { saveDoc } from './document'
import { publishUserEvent } from './realtime'

// EML-006 / UI-017: the write side of assigning a document to a user — a ToDo
// in their task list plus a notification (Notification Log + realtime user
// event). Shared by the /api/assign endpoint and Assignment Rules.

export async function createAssignment(
  doctype: string,
  name: string,
  assignTo: string,
  assignedBy: string,
  description?: string,
): Promise<string> {
  const todo = await saveDoc(
    'ToDo',
    {
      allocated_to: assignTo,
      reference_doctype: doctype,
      reference_name: name,
      description: description ?? `Assigned ${doctype} ${name}`,
      status: 'Open',
    },
    assignedBy,
  )
  const subject = `${assignedBy} assigned you ${doctype} ${name}`
  await sql`
    insert into tab_notification_log ${sql({
      name: randomBytes(5).toString('hex'),
      owner: assignedBy,
      modified_by: assignedBy,
      for_user: assignTo,
      subject,
      ref_doctype: doctype,
      ref_name: name,
      read: false,
    })}`
  publishUserEvent(assignTo, 'notification', { subject })
  return todo.name as string
}
