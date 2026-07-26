import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { saveDoc } from './document'
import { publishUserEvent } from './realtime'

// EML-006 / UI-017: the write side of assigning a row to a user — a ToDo
// in their task list plus a notification (Notification Log + realtime user
// event). Shared by the /api/assign endpoint and Assignment Rules.

export async function createAssignment(
  table: string,
  name: string,
  assignTo: string,
  assignedBy: string,
  description?: string,
): Promise<string> {
  const todo = await saveDoc(
    'ToDo',
    {
      allocated_to: assignTo,
      ref_table: table,
      reference_name: name,
      description: description ?? `Assigned ${table} ${name}`,
      // NOTE: ToDo's own open/closed state — renamed from `status` because the
      // generic `status` (draft/submitted/cancelled) is now a reserved
      // STANDARD_COLUMNS name every Table gets (see workflow.ts's
      // WorkflowState.target_status for the same collision).
      todo_status: 'Open',
    },
    assignedBy,
  )
  const subject = `${assignedBy} assigned you ${table} ${name}`
  await sql`
    insert into notification_log ${sql({
      name: randomBytes(5).toString('hex'),
      created_by: assignedBy,
      updated_by: assignedBy,
      for_user: assignTo,
      subject,
      ref_table: table,
      ref_name: name,
      read: false,
    })}`
  publishUserEvent(assignTo, 'notification', { subject })
  return todo.name as string
}
