import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { loadJobs } from '../src/jobs'
import { createDocType } from '../src/doctype-engine'
import { saveDoc } from '../src/document'

// EML-004 (extended): rules on the on_create / on_save events fire from the
// plain save path (not just submit), a conditional on_save rule fires only on
// the transition into the matching value, and the recipient supports
// {{ doc.field }} templating.

const DT = 'Eml Save Task'
const SUBJ_CREATE = 'EmlSave created'
const SUBJ_RESOLVED = 'EmlSave resolved'

async function cleanup() {
  await sql`delete from tab_email_rule where document_type = ${DT}`
  await sql`delete from tab_email_queue where subject in (${SUBJ_CREATE}, ${SUBJ_RESOLVED})`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_eml_save_task')
}

beforeAll(async () => {
  await loadJobs()
  await cleanup()
  await createDocType({
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nResolved', default_value: 'Open' },
      { fieldname: 'raised_by', fieldtype: 'Data' },
    ],
  })
  await sql`insert into tab_email_rule ${sql({
    name: 'EmlSave On Create', owner: 'Administrator', modified_by: 'Administrator',
    document_type: DT, event: 'on_create',
    recipient: 'ops@x.com', subject: SUBJ_CREATE, message: 'new {{ doc.title }}',
    enabled: true,
  })}`
  await sql`insert into tab_email_rule ${sql({
    name: 'EmlSave On Resolve', owner: 'Administrator', modified_by: 'Administrator',
    document_type: DT, event: 'on_save',
    condition_field: 'status', condition_value: 'Resolved',
    recipient: '{{ doc.raised_by }}', subject: SUBJ_RESOLVED, message: 'done {{ doc.title }}',
    enabled: true,
  })}`
})

afterAll(cleanup)

async function queued(subject: string) {
  return sql`select recipient from tab_email_queue where subject = ${subject} order by creation`
}

describe('EML-004 extended: on_create / on_save rules + templated recipient', () => {
  it('an on_create rule fires from a plain insert', async () => {
    await saveDoc(DT, { title: 'first', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queued(SUBJ_CREATE)).length).toBe(1)
  })

  it('a conditional on_save rule fires only on the transition into the match', async () => {
    const doc = await saveDoc(DT, { title: 'ticket', raised_by: 'cust@x.com' }, 'Administrator')
    expect((await queued(SUBJ_RESOLVED)).length).toBe(0) // created as Open

    const resolved = await saveDoc(
      DT,
      { name: doc.name, modified: (doc.modified as Date).toISOString(), status: 'Resolved' },
      'Administrator',
    )
    const afterResolve = await queued(SUBJ_RESOLVED)
    expect(afterResolve.length).toBe(1)
    // Recipient template rendered against the document.
    expect(afterResolve[0].recipient).toBe('cust@x.com')

    // A later save that KEEPS status=Resolved must not re-fire the rule.
    await saveDoc(
      DT,
      { name: doc.name, modified: (resolved.modified as Date).toISOString(), title: 'ticket v2' },
      'Administrator',
    )
    expect((await queued(SUBJ_RESOLVED)).length).toBe(1)
  })

  it('a rule whose templated recipient renders empty is skipped', async () => {
    const doc = await saveDoc(DT, { title: 'no email' }, 'Administrator') // raised_by unset
    await saveDoc(
      DT,
      { name: doc.name, modified: (doc.modified as Date).toISOString(), status: 'Resolved' },
      'Administrator',
    )
    const rows = await queued(SUBJ_RESOLVED)
    expect(rows.every((r) => r.recipient !== '')).toBe(true)
    expect(rows.length).toBe(1) // still only the earlier one
  })
})
