import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { loadJobs } from '../src/jobs'
import { createDocType } from '../src/doctype-engine'
import { saveDoc, submitDoc } from '../src/document'

// EML-004: a rule 'on submit of <DocType> where priority=High' fires exactly
// for matching documents.

const DT = 'Eml Rule Task'
const ACCOUNT = 'Eml Rule Account'

async function cleanup() {
  await sql`delete from tab_email_rule where document_type = ${DT}`
  await sql`delete from tab_email_queue`
  await sql`delete from tab_email_account where name = ${ACCOUNT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_eml_rule_task')
}

beforeAll(async () => {
  await loadJobs()
  await cleanup()
  await sql`insert into tab_email_account ${sql({
    name: ACCOUNT, owner: 'Administrator', modified_by: 'Administrator',
    email_id: 'rules@frappe.test', is_default: true,
  })}`
  await createDocType({
    name: DT,
    is_submittable: true,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'priority', fieldtype: 'Select', options: 'Low\nHigh' },
    ],
  })
  await sql`insert into tab_email_rule ${sql({
    name: 'High Priority Alert', owner: 'Administrator', modified_by: 'Administrator',
    document_type: DT, event: 'on_submit',
    condition_field: 'priority', condition_value: 'High',
    recipient: 'manager@x.com', subject: 'High priority submitted', message: 'see {{ doc.title }}',
    enabled: true,
  })}`
})

afterAll(cleanup)

async function queuedFor(subject: string): Promise<number> {
  const [row] = await sql`
    select count(*)::int as c from tab_email_queue where subject = ${subject}`
  return row.c as number
}

describe('EML-004: email rule on submit with condition', () => {
  it('fires for a matching document (priority=High)', async () => {
    const doc = await saveDoc(DT, { title: 'urgent', priority: 'High' }, 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(0) // not yet — only on submit
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(1)
  })

  it('does NOT fire for a non-matching document (priority=Low)', async () => {
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'chill', priority: 'Low' }, 'Administrator')
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before) // unchanged
  })

  it('fires exactly once per matching submit (no duplicates)', async () => {
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'urgent2', priority: 'High' }, 'Administrator')
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before + 1)
  })
})
