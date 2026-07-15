import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const SERIES_DT = 'Nm Invoice'
const FIELD_DT = 'Nm Country'
const PROMPT_DT = 'Nm Category'

async function makeDT(name: string, autoname: string) {
  const res = await areq('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      autoname,
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    }),
  })
  if (res.status !== 201) throw new Error(`setup ${name}: ${res.status}`)
}

async function save(doctype: string, doc: Record<string, unknown>) {
  return areq('/api/save_doc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doctype, doc }),
  })
}

async function cleanup() {
  await sql`delete from tab_doctype where name in (${SERIES_DT}, ${FIELD_DT}, ${PROMPT_DT})`
  await sql.unsafe('drop table if exists tab_nm_invoice')
  await sql.unsafe('drop table if exists tab_nm_country')
  await sql.unsafe('drop table if exists tab_nm_category')
  await sql`delete from series where name = 'NMINV-'`
}

beforeAll(async () => {
  await cleanup()
  await makeDT(SERIES_DT, 'NMINV-.####')
  await makeDT(FIELD_DT, 'field:title')
  await makeDT(PROMPT_DT, 'prompt')
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('META-006: naming rules', () => {
  it('50 parallel series inserts produce distinct gapless sequential names', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => save(SERIES_DT, { title: `t${i}` })),
    )
    for (const r of results) expect(r.status).toBe(201)
    const names = await Promise.all(
      results.map(async (r) => ((await r.json()) as { name: string }).name),
    )
    expect(new Set(names).size).toBe(50)
    const nums = names.map((n) => Number(n.replace('NMINV-', ''))).sort((a, b) => a - b)
    expect(nums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(names[0]).toMatch(/^NMINV-\d{4}$/)
  })

  it('field: naming uses the field value and requires it', async () => {
    const res = await save(FIELD_DT, { title: 'India' })
    expect(((await res.json()) as { name: string }).name).toBe('India')
    expect((await save(FIELD_DT, {})).status).toBe(417)
  })

  it('prompt naming inserts with the client-provided name and requires it', async () => {
    const res = await save(PROMPT_DT, { name: 'Hardware', title: 'x' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { name: string }).name).toBe('Hardware')
    expect((await save(PROMPT_DT, { title: 'y' })).status).toBe(417)
  })

  it('prompt naming updates the existing doc when the name already exists', async () => {
    const first = (await (await save(PROMPT_DT, { name: 'Software', title: 'v1' })).json()) as Record<string, unknown>
    const res = await save(PROMPT_DT, {
      name: 'Software',
      modified: first.modified,
      title: 'v2',
    })
    expect(res.status).toBe(201)
    const [row] = await sql.unsafe(`select title from tab_nm_category where name='Software'`)
    expect(row.title).toBe('v2')
  })
})
