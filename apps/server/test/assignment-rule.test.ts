import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'

// Assignment Rules: creations of the target DocType are auto-assigned
// round-robin across the rule's user pool (ToDo + notification), the picked
// user lands in assign_to_field, and the condition gates the rule per-doc.

const DT = 'Asg Rule Ticket'
const RULE = 'Asg Rule RR'
const A1 = 'asg-agent1@x.com'
const A2 = 'asg-agent2@x.com'

async function setup(admin: TestClient) {
  for (const u of [A1, A2])
    await sql`insert into tab_user ${sql({
      name: u, owner: 'Administrator', modified_by: 'Administrator', email: u, enabled: true,
    })}`
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'priority', fieldtype: 'Select', options: 'Low\nHigh', default_value: 'High' },
      { fieldname: 'agent', fieldtype: 'Link', options: 'User' },
    ],
  })
  await saveDoc('Assignment Rule', {
    name: RULE,
    document_type: DT,
    assign_condition: "doc.priority === 'High'",
    assign_to_field: 'agent',
    users: [{ user: A1 }, { user: A2 }],
  })
}

async function assignee(name: string): Promise<string | undefined> {
  const [todo] = await sql`
    select allocated_to from tab_todo
    where reference_doctype = ${DT} and reference_name = ${name}`
  return todo?.allocated_to as string | undefined
}

describe('Assignment Rules: round-robin auto-assignment', () => {
  test('assigns matching creations round-robin and stamps assign_to_field', async ({ admin }) => {
    await setup(admin)
    const d1 = await saveDoc(DT, { title: 'one' }, 'Administrator')
    const d2 = await saveDoc(DT, { title: 'two' }, 'Administrator')
    const d3 = await saveDoc(DT, { title: 'three' }, 'Administrator')
    expect(await assignee(String(d1.name))).toBe(A1)
    expect(await assignee(String(d2.name))).toBe(A2)
    expect(await assignee(String(d3.name))).toBe(A1)
    // assign_to_field stamped the pool user into the document itself.
    const [row] = await sql`select agent from tab_asg_rule_ticket where name = ${String(d2.name)}`
    expect(row.agent).toBe(A2)
    // The assignee got a notification.
    const [note] = await sql`
      select for_user from tab_notification_log
      where ref_doctype = ${DT} and ref_name = ${String(d1.name)}`
    expect(note.for_user).toBe(A1)
  })

  test('skips documents that fail the condition', async ({ admin }) => {
    await setup(admin)
    const low = await saveDoc(DT, { title: 'low', priority: 'Low' }, 'Administrator')
    expect(await assignee(String(low.name))).toBeUndefined()
  })

  test('a disabled rule never assigns', async ({ admin }) => {
    await setup(admin)
    await sql`update tab_assignment_rule set disabled = true where name = ${RULE}`
    const doc = await saveDoc(DT, { title: 'off' }, 'Administrator')
    expect(await assignee(String(doc.name))).toBeUndefined()
  })
})
