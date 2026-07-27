import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { loadJobs } from '../src/jobs'
import { createTable } from '../src/doctype-engine'
import { saveDoc, submitDoc } from '../src/document'

// EML-004: a rule 'on submit of <Table> where priority=High' fires exactly
// for matching documents.

const DT = 'Eml Rule Task'
const ACCOUNT = 'Eml Rule Account'

// Runs at the start of each test, inside its sandbox transaction: clear any
// committed leftovers (rolled back afterwards), then create the account,
// Table, and rule that legacy beforeAll used to set up once.
async function setup() {
  await loadJobs()
  await sql`delete from email_rule where ref_table = ${DT}`
  await sql`delete from email_queue`
  await sql`delete from email_account where name = ${ACCOUNT}`
  await sql`delete from column_def where parent = ${DT}`
  await sql`delete from table_def where name = ${DT}`
  await sql.unsafe('drop table if exists eml_rule_task')
  await sql`insert into email_account ${sql({
    name: ACCOUNT, created_by: 'Administrator', updated_by: 'Administrator',
    email_id: 'rules@frappe.test', is_default: true,
  })}`
  await createTable({
    name: DT,
    is_submittable: true,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'priority', column_type: 'Choice', choices: 'Low\nHigh' },
    ],
  })
  await sql`insert into email_rule ${sql({
    name: 'High Priority Alert', created_by: 'Administrator', updated_by: 'Administrator',
    ref_table: DT, event: 'on_submit',
    condition_field: 'priority', condition_value: 'High',
    recipient: 'manager@x.com', subject: 'High priority submitted', message: 'see {{ doc.title }}',
    enabled: true,
  })}`
}

async function queuedFor(subject: string): Promise<number> {
  const [row] = await sql`
    select count(*)::int as c from email_queue where subject = ${subject}`
  return row.c as number
}

describe('EML-004: email rule on submit with condition', () => {
  test('fires for a matching document (priority=High)', async () => {
    await setup()
    const doc = await saveDoc(DT, { title: 'urgent', priority: 'High' }, 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(0) // not yet — only on submit
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(1)
  })

  test('does NOT fire for a non-matching document (priority=Low)', async () => {
    await setup()
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'chill', priority: 'Low' }, 'Administrator')
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before) // unchanged
  })

  test('fires exactly once per matching submit (no duplicates)', async () => {
    await setup()
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'urgent2', priority: 'High' }, 'Administrator')
    await submitDoc(DT, String(doc.name), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before + 1)
  })
})
