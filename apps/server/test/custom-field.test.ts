import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { reapplyCustomFields } from '../src/custom-fields'
import { getMeta, invalidateMeta } from '../src/meta'
import { areq } from './helpers'

// CUST-001: a custom field on an existing DocType appears in meta/API,
// stored separately, and survives a re-seed of core fixtures.

const FIELD = 'srv_custom_tag'

async function cleanup() {
  await sql`delete from tab_custom_field where dt = 'User' and fieldname = ${FIELD}`
  await sql`delete from tab_docfield where parent = 'User' and fieldname = ${FIELD}`
  await sql.unsafe(`alter table tab_user drop column if exists ${FIELD}`)
  invalidateMeta('User')
}

beforeAll(cleanup)
afterAll(cleanup)

describe('CUST-001: custom fields', () => {
  it('adds a field to User that appears in meta and round-trips through the API', async () => {
    const res = await areq('/api/save_doc', {
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
    const admin = (await (await areq('/api/resource/User/Administrator')).json()) as {
      modified: string
    }
    const upd = await areq('/api/resource/User/Administrator', {
      method: 'PUT',
      body: JSON.stringify({ [FIELD]: 'vip', modified: admin.modified }),
    })
    expect(upd.status).toBe(200)
    const read = (await (
      await areq(
        `/api/resource/User/Administrator?fields=${encodeURIComponent(JSON.stringify(['name', FIELD]))}`,
      )
    ).json()) as Record<string, unknown>
    expect(read[FIELD]).toBe('vip')
  })

  it('is stored separately and survives a core re-seed (docfield wipe)', async () => {
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
    const read = (await (
      await areq(
        `/api/resource/User/Administrator?fields=${encodeURIComponent(JSON.stringify([FIELD]))}`,
      )
    ).json()) as Record<string, unknown>
    expect(read[FIELD]).toBe('vip')
  })

  it('deleting the Custom Field removes the field but keeps the column data', async () => {
    await areq(`/api/resource/Custom%20Field/User-${FIELD}`, { method: 'DELETE' })
    invalidateMeta('User')
    expect((await getMeta('User')).fields.some((f) => f.fieldname === FIELD)).toBe(false)
    // Column still present with data (non-destructive).
    const [row] = await sql.unsafe(`select ${FIELD} from tab_user where name = 'Administrator'`)
    expect(row[FIELD]).toBe('vip')
  })
})
