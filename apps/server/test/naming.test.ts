import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const SERIES_DT = 'Nm Invoice'
const FIELD_DT = 'Nm Country'
const PROMPT_DT = 'Nm Category'

async function makeDT(admin: TestClient, name: string, autoname: string) {
  await admin.post('/api/doctype', {
    name,
    autoname,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
}

const save = (admin: TestClient, doctype: string, doc: Record<string, unknown>) =>
  admin.post<{ name: string } & Record<string, unknown>>('/api/save_doc', { doctype, doc })

describe('META-006: naming rules', () => {
  test('50 parallel series inserts produce distinct gapless sequential names', async ({
    admin,
  }) => {
    await makeDT(admin, SERIES_DT, 'NMINV-.####')
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => save(admin, SERIES_DT, { title: `t${i}` })),
    )
    const names = results.map((r) => r.name)
    expect(new Set(names).size).toBe(50)
    const nums = names.map((n) => Number(n.replace('NMINV-', ''))).sort((a, b) => a - b)
    expect(nums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(names[0]).toMatch(/^NMINV-\d{4}$/)
  })

  test('field: naming uses the field value and requires it', async ({ admin }) => {
    await makeDT(admin, FIELD_DT, 'field:title')
    const doc = await save(admin, FIELD_DT, { title: 'India' })
    expect(doc.name).toBe('India')
    await expect(save(admin, FIELD_DT, {})).rejects.toMatchObject({ status: 417 })
  })

  test('prompt naming inserts with the client-provided name and requires it', async ({
    admin,
  }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    const doc = await save(admin, PROMPT_DT, { name: 'Hardware', title: 'x' })
    expect(doc.name).toBe('Hardware')
    await expect(save(admin, PROMPT_DT, { title: 'y' })).rejects.toMatchObject({ status: 417 })
  })

  test('prompt naming updates the existing doc when the name already exists', async ({
    admin,
  }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    const first = await save(admin, PROMPT_DT, { name: 'Software', title: 'v1' })
    await save(admin, PROMPT_DT, {
      name: 'Software',
      modified: first.modified,
      title: 'v2',
    })
    const [row] = await sql.unsafe(`select title from tab_nm_category where name='Software'`)
    expect(row.title).toBe('v2')
  })
})
