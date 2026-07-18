import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { reapplyCustomFields } from '../src/custom-fields'
import { getMeta, invalidateMeta } from '../src/meta'
import type { TestClient } from 'feather-testing-postgres'

// CUST-001: a custom field on an existing DocType appears in meta/API,
// stored separately, and survives a re-seed of core fixtures.

const FIELD = 'srv_custom_tag'

// The legacy suite chained state across tests; under the sandbox each test
// replays the steps it depends on (create the field, set the value) itself.
async function addCustomField(admin: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'Custom Field',
    doc: {
      name: `User-${FIELD}`,
      dt: 'User',
      fieldname: FIELD,
      label: 'Custom Tag',
      fieldtype: 'Data',
      in_list_view: true,
    },
  })
}

async function setVip(admin: TestClient) {
  const adminDoc = await admin.get<{ modified: string }>('/api/resource/User/Administrator')
  await admin.put('/api/resource/User/Administrator', {
    [FIELD]: 'vip',
    modified: adminDoc.modified,
  })
}

describe('CUST-001: custom fields', () => {
  test('adds a field to User that appears in meta and round-trips through the API', async ({
    admin,
  }) => {
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Custom Field',
        doc: {
          name: `User-${FIELD}`,
          dt: 'User',
          fieldname: FIELD,
          label: 'Custom Tag',
          fieldtype: 'Data',
          in_list_view: true,
        },
      }),
    })
    expect(res.status).toBe(201)

    const meta = await getMeta('User')
    const f = meta.fields.find((x) => x.fieldname === FIELD)
    expect(f).toBeDefined()
    expect((f as { custom?: boolean }).custom).toBe(true)

    // Writable + readable via the generic API.
    const adminDoc = await admin.get<{ modified: string }>('/api/resource/User/Administrator')
    const upd = await admin.fetch('/api/resource/User/Administrator', {
      method: 'PUT',
      body: JSON.stringify({ [FIELD]: 'vip', modified: adminDoc.modified }),
    })
    expect(upd.status).toBe(200)
    const read = await admin.get<Record<string, unknown>>(
      `/api/resource/User/Administrator?fields=${encodeURIComponent(JSON.stringify(['name', FIELD]))}`,
    )
    expect(read[FIELD]).toBe('vip')
  })

  test('is stored separately and survives a core re-seed (docfield wipe)', async ({ admin }) => {
    await addCustomField(admin)
    await setVip(admin)

    // The Custom Field record is the source of truth.
    const [rec] = await sql`select 1 from tab_custom_field where fieldname = ${FIELD}`
    expect(rec).toBeDefined()

    // Simulate a re-seed that rewrote User's base docfields, dropping the
    // custom one — the column/value stay.
    await sql`delete from tab_docfield where parent = 'User' and fieldname = ${FIELD}`
    invalidateMeta('User')
    expect((await getMeta('User')).fields.some((f) => f.fieldname === FIELD)).toBe(false)

    // Re-apply (runs at boot) restores it.
    await reapplyCustomFields()
    const meta = await getMeta('User')
    expect(meta.fields.some((f) => f.fieldname === FIELD)).toBe(true)

    // Value was never lost (column untouched).
    const read = await admin.get<Record<string, unknown>>(
      `/api/resource/User/Administrator?fields=${encodeURIComponent(JSON.stringify([FIELD]))}`,
    )
    expect(read[FIELD]).toBe('vip')
  })

  test('deleting the Custom Field removes the field but keeps the column data', async ({
    admin,
  }) => {
    await addCustomField(admin)
    await setVip(admin)

    await admin.delete(`/api/resource/Custom%20Field/User-${FIELD}`)
    invalidateMeta('User')
    expect((await getMeta('User')).fields.some((f) => f.fieldname === FIELD)).toBe(false)
    // Column still present with data (non-destructive).
    const [row] = await sql.unsafe(`select ${FIELD} from tab_user where name = 'Administrator'`)
    expect(row[FIELD]).toBe('vip')
  })
})
