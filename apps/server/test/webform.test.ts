import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { getWebFormConfig, submitWebForm } from '../src/webform'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// WEB-002: public web forms expose a whitelist of a Table's columns and
// create a document on submit, with server validation and column
// whitelisting enforced.

const DT = 'WF Srv Msg'

// Each test builds the Table + both web forms inside its own sandbox
// transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'full_name', column_type: 'Data', reqd: true },
      { column_name: 'message', column_type: 'Long Text', reqd: true },
      { column_name: 'secret_note', column_type: 'Data' }, // NOT whitelisted
    ],
  })
  for (const [name, route, published] of [
    ['wf-srv-pg', 'wf-srv', true],
    ['wf-srv-draft-pg', 'wf-srv-draft', false],
  ] as const) {
    await admin.post('/api/save_row', {
      table: 'Web Form',
      row: {
        row_id: name,
        title: 'Contact',
        route,
        ref_table: DT,
        web_fields: ['full_name', 'message'],
        published,
      },
    })
  }
}

describe('WEB-002: web forms', () => {
  test('exposes only the whitelisted columns with their reqd flags', async ({ admin }) => {
    await setup(admin)
    const cfg = await getWebFormConfig('wf-srv')
    expect(cfg.columns.map((f) => f.column_name)).toEqual(['full_name', 'message'])
    expect(cfg.columns.every((f) => f.reqd)).toBe(true)
  })

  test('creates a document on submit and ignores non-whitelisted columns', async ({ admin }) => {
    await setup(admin)
    const res = await submitWebForm('wf-srv', {
      full_name: 'Alice',
      message: 'Hi',
      secret_note: 'should be dropped',
    })
    expect(res.row_id).toMatch(/^[0-9a-f]{10}$/)
    const [doc] =
      await sql`select full_name, message, secret_note from wf_srv_msg where row_id = ${res.row_id}`
    expect(doc.full_name).toBe('Alice')
    expect(doc.message).toBe('Hi')
    expect(doc.secret_note).toBeNull() // whitelist kept it out
  })

  test('still enforces server validation (missing required column)', async ({ admin }) => {
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

// Moved from coverage-gaps.test.ts (#221): the web_fields column-whitelist
// parser tolerates malformed JSON, an already-parsed array, and an absent
// column list.
describe('web form: field whitelist parsing', () => {
  test('malformed web_fields yields an empty field list; an array passes through', async ({
    admin,
  }) => {
    const DT = 'Cov Webform Note'
    await admin.post('/api/table_def', {
      name: DT,
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await admin.post('/api/save_row', {
      table: 'Web Form',
      row: {
        row_id: 'Cov WF Broken',
        title: 'Broken',
        route: 'cov-broken',
        ref_table: DT,
        published: true,
        web_fields: '{not json',
      },
    })
    expect((await getWebFormConfig('cov-broken')).columns).toEqual([])

    await admin.post('/api/save_row', {
      table: 'Web Form',
      row: {
        row_id: 'Cov WF Array',
        title: 'Array',
        route: 'cov-array',
        ref_table: DT,
        published: true,
        web_fields: ['title'],
      },
    })
    const config = await getWebFormConfig('cov-array')
    expect(config.columns.map((f) => f.column_name)).toEqual(['title'])

    await admin.post('/api/save_row', {
      table: 'Web Form',
      row: {
        row_id: 'Cov WF Nofields',
        title: 'Nofields',
        route: 'cov-nofields',
        ref_table: DT,
        published: true,
      },
    })
    expect((await getWebFormConfig('cov-nofields')).columns).toEqual([])
  })
})
