import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { getWebFormConfig, submitWebForm } from '../src/webform'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// WEB-002: public web forms expose a whitelist of a DocType's fields and create
// a document on submit, with server validation and field whitelisting enforced.

const DT = 'WF Srv Msg'

// Each test builds the DocType + both web forms inside its own sandbox
// transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'full_name', fieldtype: 'Data', reqd: true },
      { fieldname: 'message', fieldtype: 'Long Text', reqd: true },
      { fieldname: 'secret_note', fieldtype: 'Data' }, // NOT whitelisted
    ],
  })
  for (const [name, route, published] of [
    ['wf-srv-pg', 'wf-srv', true],
    ['wf-srv-draft-pg', 'wf-srv-draft', false],
  ] as const) {
    await admin.post('/api/save_doc', {
      doctype: 'Web Form',
      doc: {
        name,
        title: 'Contact',
        route,
        document_type: DT,
        web_fields: ['full_name', 'message'],
        published,
      },
    })
  }
}

describe('WEB-002: web forms', () => {
  test('exposes only the whitelisted fields with their reqd flags', async ({ admin }) => {
    await setup(admin)
    const cfg = await getWebFormConfig('wf-srv')
    expect(cfg.fields.map((f) => f.fieldname)).toEqual(['full_name', 'message'])
    expect(cfg.fields.every((f) => f.reqd)).toBe(true)
  })

  test('creates a document on submit and ignores non-whitelisted fields', async ({ admin }) => {
    await setup(admin)
    const res = await submitWebForm('wf-srv', {
      full_name: 'Alice',
      message: 'Hi',
      secret_note: 'should be dropped',
    })
    expect(res.name).toBeTruthy()
    const [doc] =
      await sql`select full_name, message, secret_note from tab_wf_srv_msg where name = ${res.name}`
    expect(doc.full_name).toBe('Alice')
    expect(doc.message).toBe('Hi')
    expect(doc.secret_note).toBeNull() // whitelist kept it out
  })

  test('still enforces server validation (missing required field)', async ({ admin }) => {
    await setup(admin)
    await expect(submitWebForm('wf-srv', { full_name: 'NoMessage' })).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  test('does not serve or accept an unpublished form', async ({ admin }) => {
    await setup(admin)
    await expect(getWebFormConfig('wf-srv-draft')).rejects.toMatchObject({ type: 'NotFoundError' })
    await expect(
      submitWebForm('wf-srv-draft', { full_name: 'X', message: 'Y' }),
    ).rejects.toMatchObject({
      type: 'NotFoundError',
    })
  })

  test('is reachable over HTTP with no session', async ({ admin, api }) => {
    await setup(admin)
    const cfg = await api.fetch('/api/web_form/wf-srv')
    expect(cfg.status).toBe(200)
    const submit = await api.fetch('/api/web_form/wf-srv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { full_name: 'HttpAnon', message: 'via http' } }),
    })
    expect(submit.status).toBe(201)
  })
})
