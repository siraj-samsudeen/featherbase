import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'

// EML-004 (extended): rules on the on_create / on_save events fire from the
// plain save path (not just submit), a conditional on_save rule fires only on
// the transition into the matching value, and the recipient supports
// {{ doc.field }} templating.
//
// The table's own lifecycle field is named `stage` (not `status`) because
// `status` is now the reserved draft/submitted/cancelled column — a custom
// column may not shadow it (doctype-engine's STANDARD_COLUMNS check).

const DT = 'Eml Save Task'
const SUBJ_CREATE = 'EmlSave created'
const SUBJ_RESOLVED = 'EmlSave resolved'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nResolved', default_value: 'Open' },
      { column_name: 'raised_by', column_type: 'Data' },
    ],
  })
  await sql`insert into email_rule ${sql({
    name: 'EmlSave On Create', created_by: 'Administrator', updated_by: 'Administrator',
    ref_table: DT, event: 'on_create',
    recipient: 'ops@x.com', subject: SUBJ_CREATE, message: 'new {{ doc.title }}',
    enabled: true,
  })}`
  await sql`insert into email_rule ${sql({
    name: 'EmlSave On Resolve', created_by: 'Administrator', updated_by: 'Administrator',
    ref_table: DT, event: 'on_save',
    condition_field: 'stage', condition_value: 'Resolved',
    recipient: '{{ doc.raised_by }}', subject: SUBJ_RESOLVED, message: 'done {{ doc.title }}',
    enabled: true,
  })}`
}

async function queued(subject: string) {
  return sql`select recipient from email_queue where subject = ${subject} order by created_at`
}

describe('EML-004 extended: on_create / on_save rules + templated recipient', () => {
  test('an on_create rule fires from a plain insert', async ({ admin }) => {
    await setup(admin)
    await saveDoc(DT, { title: 'first', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queued(SUBJ_CREATE)).length).toBe(1)
  })

  test('a conditional on_save rule fires only on the transition into the match', async ({
    admin,
  }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'ticket', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queued(SUBJ_RESOLVED)).length).toBe(0) // created as Open

    const resolved = await saveDoc(
      DT,
      { name: doc.name, updated_at: (doc.updated_at as Date).toISOString(), stage: 'Resolved' },
      'Administrator',
    )
    const afterResolve = await queued(SUBJ_RESOLVED)
    expect(afterResolve.length).toBe(1)
    // Recipient template rendered against the document.
    expect(afterResolve[0].recipient).toBe('cust@x.com')

    // A later save that KEEPS stage=Resolved must not re-fire the rule.
    await saveDoc(
      DT,
      { name: doc.name, updated_at: (resolved.updated_at as Date).toISOString(), title: 'ticket v2' },
      'Administrator',
    )
    expect((await queued(SUBJ_RESOLVED)).length).toBe(1)
  })

  test('a rule whose templated recipient renders empty is skipped', async ({ admin }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'no email' }, 'Administrator') // raised_by unset
    await saveDoc(
      DT,
      { name: doc.name, updated_at: (doc.updated_at as Date).toISOString(), stage: 'Resolved' },
      'Administrator',
    )
    const rows = await queued(SUBJ_RESOLVED)
    expect(rows.length).toBe(0)
  })
})
