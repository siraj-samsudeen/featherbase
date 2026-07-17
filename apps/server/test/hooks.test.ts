import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { clearControllers, registerController } from '../src/controllers'
import { AppError } from '../src/errors'
import { areq } from './helpers'

const DT = 'Hook Chain Probe'
const FILE_DT = 'Hook File Demo'

async function post(path: string, body: unknown) {
  return areq(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const events: string[] = []

beforeAll(async () => {
  await sql`delete from tab_doctype where name in (${DT}, ${FILE_DT})`
  await sql.unsafe('drop table if exists tab_hook_chain_probe')
  await sql.unsafe('drop table if exists tab_hook_file_demo')
  await post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'computed', fieldtype: 'Data' },
    ],
  })
  await post('/api/doctype', {
    name: FILE_DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'slug', fieldtype: 'Data' },
    ],
  })
  registerController({
    doctype: DT,
    hooks: {
      before_insert: () => { events.push('before_insert') },
      validate: ({ doc }) => {
        events.push('validate')
        if (doc.title === 'explode')
          throw new AppError('ValidationError', 'no explosions', { title: 'boom' })
        doc.title = String(doc.title ?? '').toUpperCase()
      },
      before_save: ({ doc, isNew }) => {
        events.push('before_save')
        doc.computed = `${doc.title}:${isNew ? 'new' : 'upd'}`
      },
      after_insert: () => { events.push('after_insert') },
      after_save: () => { events.push('after_save') },
    },
  })
})

afterAll(async () => {
  clearControllers(DT)
  await sql`delete from tab_doctype where name in (${DT}, ${FILE_DT})`
  await sql.unsafe('drop table if exists tab_hook_chain_probe')
  await sql.unsafe('drop table if exists tab_hook_file_demo')
  await sql.end()
})

describe('DOC-003: lifecycle hook chain', () => {
  it('runs the full chain in order on insert and persists hook mutations', async () => {
    events.length = 0
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { title: 'abc' } })
    ).json()) as Record<string, unknown>
    expect(events).toEqual(['before_insert', 'validate', 'before_save', 'after_insert', 'after_save'])
    expect(doc.title).toBe('ABC')
    expect(doc.computed).toBe('ABC:new')
    const [row] = await sql.unsafe(
      `select title, computed from tab_hook_chain_probe where name='${doc.name}'`,
    )
    expect(row).toMatchObject({ title: 'ABC', computed: 'ABC:new' })
  })

  it('runs validate/before_save/after_save on update with old doc available', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: DT, doc: { title: 'x' } })
    ).json()) as Record<string, unknown>
    events.length = 0
    const upd = (await (
      await post('/api/save_doc', {
        doctype: DT,
        doc: { name: doc.name, modified: doc.modified, title: 'y' },
      })
    ).json()) as Record<string, unknown>
    expect(events).toEqual(['validate', 'before_save', 'after_save'])
    expect(upd.computed).toBe('Y:upd')
  })

  it('a validate error aborts the entire transaction — no row inserted', async () => {
    const res = await post('/api/save_doc', { doctype: DT, doc: { title: 'explode' } })
    expect(res.status).toBe(417)
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from tab_hook_chain_probe where title='explode' or title='EXPLODE'`,
    )
    expect(count).toBe(0)
  })

  it('DocTypes without controllers still save', async () => {
    const res = await post('/api/save_doc', { doctype: FILE_DT, doc: { title: 'No Hooks Needed' } })
    expect(res.status).toBe(201)
  })
})

describe('DOC-004: file-based controller registry', () => {
  it('the controllers/hook_file_demo.ts file is loaded and its hooks fire', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: FILE_DT, doc: { title: 'Hello World' } })
    ).json()) as Record<string, unknown>
    expect(doc.slug).toBe('hello-world')
    const blocked = await post('/api/save_doc', { doctype: FILE_DT, doc: { title: 'forbidden' } })
    expect(blocked.status).toBe(417)
    expect((await blocked.json()).error.fields.title).toBeTruthy()
  })
})
