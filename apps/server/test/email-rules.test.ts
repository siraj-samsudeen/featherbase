import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { loadJobs } from '../src/jobs'
import { createTable } from '../src/table-engine'
import { saveDoc, submitDoc } from '../src/document'

// EML-004: a rule 'on submit of <Table> where priority=High' fires exactly
// for matching documents.

const DT = 'Eml Rule Task'
const ACCOUNT = 'Eml Rule Account'

// Runs at the start of each test, inside its sandbox transaction: create the
// account, Table, and rule that legacy beforeAll used to set up once.
// email_rule/email_account are seeded with raw SQL rather than through the
// save lifecycle (API save_row) deliberately — these are fixture rows, not
// the behavior under test.
async function setup() {
  await loadJobs()
  await sql`insert into email_account ${sql({
    row_id: ACCOUNT, created_by: 'Administrator', updated_by: 'Administrator',
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
    row_id: 'High Priority Alert', created_by: 'Administrator', updated_by: 'Administrator',
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
    await submitDoc(DT, String(doc.row_id), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(1)
  })

  test('does NOT fire for a non-matching document (priority=Low)', async () => {
    await setup()
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'chill', priority: 'Low' }, 'Administrator')
    await submitDoc(DT, String(doc.row_id), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before) // unchanged
  })

  test('fires exactly once per matching submit (no duplicates)', async () => {
    await setup()
    const before = await queuedFor('High priority submitted')
    const doc = await saveDoc(DT, { title: 'urgent2', priority: 'High' }, 'Administrator')
    await submitDoc(DT, String(doc.row_id), 'Administrator')
    expect(await queuedFor('High priority submitted')).toBe(before + 1)
  })
})

// Merged from email-rules-save.test.ts (#221): rules on the on_create /
// on_save events fire from the plain save path (not just submit), a
// conditional on_save rule fires only on the transition into the matching
// value, and the recipient supports {{ doc.field }} templating.
//
// The table's own lifecycle field is named `stage` (not `status`) because
// `status` is now the reserved draft/submitted/cancelled column — a custom
// column may not shadow it (table-engine's STANDARD_COLUMNS check).

const SAVE_DT = 'Eml Save Task'
const SUBJ_CREATE = 'EmlSave created'
const SUBJ_RESOLVED = 'EmlSave resolved'

async function setupSaveRules(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: SAVE_DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nResolved', default_value: 'Open' },
      { column_name: 'raised_by', column_type: 'Data' },
    ],
  })
  // email_rule rows are seeded with raw SQL rather than through the save
  // lifecycle (API save_row) deliberately — these are fixture rows, not the
  // behavior under test.
  await sql`insert into email_rule ${sql({
    row_id: 'EmlSave On Create', created_by: 'Administrator', updated_by: 'Administrator',
    ref_table: SAVE_DT, event: 'on_create',
    recipient: 'ops@x.com', subject: SUBJ_CREATE, message: 'new {{ doc.title }}',
    enabled: true,
  })}`
  await sql`insert into email_rule ${sql({
    row_id: 'EmlSave On Resolve', created_by: 'Administrator', updated_by: 'Administrator',
    ref_table: SAVE_DT, event: 'on_save',
    condition_field: 'stage', condition_value: 'Resolved',
    recipient: '{{ doc.raised_by }}', subject: SUBJ_RESOLVED, message: 'done {{ doc.title }}',
    enabled: true,
  })}`
}

async function queuedSave(subject: string) {
  return sql`select recipient from email_queue where subject = ${subject} order by created_at`
}

describe('EML-004 extended: on_create / on_save rules + templated recipient', () => {
  test('an on_create rule fires from a plain insert', async ({ admin }) => {
    await setupSaveRules(admin)
    await saveDoc(SAVE_DT, { title: 'first', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queuedSave(SUBJ_CREATE)).length).toBe(1)
  })

  test('a conditional on_save rule fires only on the transition into the match', async ({
    admin,
  }) => {
    await setupSaveRules(admin)
    const doc = await saveDoc(SAVE_DT, { title: 'ticket', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queuedSave(SUBJ_RESOLVED)).length).toBe(0) // created as Open

    const resolved = await saveDoc(
      SAVE_DT,
      { row_id: doc.row_id, updated_at: (doc.updated_at as Date).toISOString(), stage: 'Resolved' },
      'Administrator',
    )
    const afterResolve = await queuedSave(SUBJ_RESOLVED)
    expect(afterResolve.length).toBe(1)
    // Recipient template rendered against the document.
    expect(afterResolve[0].recipient).toBe('cust@x.com')

    // A later save that KEEPS stage=Resolved must not re-fire the rule.
    await saveDoc(
      SAVE_DT,
      { row_id: doc.row_id, updated_at: (resolved.updated_at as Date).toISOString(), title: 'ticket v2' },
      'Administrator',
    )
    expect((await queuedSave(SUBJ_RESOLVED)).length).toBe(1)
  })

  test('a rule whose templated recipient renders empty is skipped', async ({ admin }) => {
    await setupSaveRules(admin)
    const doc = await saveDoc(SAVE_DT, { title: 'no email' }, 'Administrator') // raised_by unset
    await saveDoc(
      SAVE_DT,
      { row_id: doc.row_id, updated_at: (doc.updated_at as Date).toISOString(), stage: 'Resolved' },
      'Administrator',
    )
    const rows = await queuedSave(SUBJ_RESOLVED)
    expect(rows.length).toBe(0)
  })
})
