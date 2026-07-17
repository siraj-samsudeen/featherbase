import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { getWebFormConfig, submitWebForm } from '../src/webform'
import { areq } from './helpers'

// WEB-002: public web forms expose a whitelist of a DocType's fields and create
// a document on submit, with server validation and field whitelisting enforced.

const DT = 'WF Srv Msg'

async function cleanup() {
  await sql`delete from tab_web_form where route in ('wf-srv', 'wf-srv-draft')`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_wf_srv_msg')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'full_name', fieldtype: 'Data', reqd: true },
        { fieldname: 'message', fieldtype: 'Long Text', reqd: true },
        { fieldname: 'secret_note', fieldtype: 'Data' }, // NOT whitelisted
      ],
    }),
  })
  for (const [name, route, published] of [
    ['wf-srv-pg', 'wf-srv', true],
    ['wf-srv-draft-pg', 'wf-srv-draft', false],
  ] as const) {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Web Form',
        doc: { name, title: 'Contact', route, document_type: DT, web_fields: ['full_name', 'message'], published },
      }),
    })
  }
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('WEB-002: web forms', () => {
  it('exposes only the whitelisted fields with their reqd flags', async () => {
    const cfg = await getWebFormConfig('wf-srv')
    expect(cfg.fields.map((f) => f.fieldname)).toEqual(['full_name', 'message'])
    expect(cfg.fields.every((f) => f.reqd)).toBe(true)
  })

  it('creates a document on submit and ignores non-whitelisted fields', async () => {
    const res = await submitWebForm('wf-srv', {
      full_name: 'Alice',
      message: 'Hi',
      secret_note: 'should be dropped',
    })
    expect(res.name).toBeTruthy()
    const [doc] = await sql`select full_name, message, secret_note from tab_wf_srv_msg where name = ${res.name}`
    expect(doc.full_name).toBe('Alice')
    expect(doc.message).toBe('Hi')
    expect(doc.secret_note).toBeNull() // whitelist kept it out
  })

  it('still enforces server validation (missing required field)', async () => {
    await expect(submitWebForm('wf-srv', { full_name: 'NoMessage' })).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  it('does not serve or accept an unpublished form', async () => {
    await expect(getWebFormConfig('wf-srv-draft')).rejects.toMatchObject({ type: 'NotFoundError' })
    await expect(submitWebForm('wf-srv-draft', { full_name: 'X', message: 'Y' })).rejects.toMatchObject({
      type: 'NotFoundError',
    })
  })

  it('is reachable over HTTP with no session', async () => {
    const cfg = await app.request('/api/web_form/wf-srv')
    expect(cfg.status).toBe(200)
    const submit = await app.request('/api/web_form/wf-srv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { full_name: 'HttpAnon', message: 'via http' } }),
    })
    expect(submit.status).toBe(201)
  })
})
