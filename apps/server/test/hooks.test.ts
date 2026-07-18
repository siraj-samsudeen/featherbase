import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { clearControllers, registerController } from '../src/controllers'
import { AppError } from '../src/errors'

const DT = 'Hook Chain Probe'
const FILE_DT = 'Hook File Demo'

async function makeDoctypes(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'computed', fieldtype: 'Data' },
    ],
  })
  await admin.post('/api/doctype', {
    name: FILE_DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'slug', fieldtype: 'Data' },
    ],
  })
}

// Controller registration is per-process (NOT rolled back by the sandbox), so
// each test registers the probe controller itself and clears it in `finally`.
function registerProbe(events: string[]) {
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
}

describe('DOC-003: lifecycle hook chain', () => {
  test('runs the full chain in order on insert and persists hook mutations', async ({ admin }) => {
    await makeDoctypes(admin)
    const events: string[] = []
    registerProbe(events)
    try {
      const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
        doctype: DT,
        doc: { title: 'abc' },
      })
      expect(events).toEqual(['before_insert', 'validate', 'before_save', 'after_insert', 'after_save'])
      expect(doc.title).toBe('ABC')
      expect(doc.computed).toBe('ABC:new')
      const [row] = await sql.unsafe(
        `select title, computed from tab_hook_chain_probe where name='${doc.name}'`,
      )
      expect(row).toMatchObject({ title: 'ABC', computed: 'ABC:new' })
    } finally {
      clearControllers(DT)
    }
  })

  test('runs validate/before_save/after_save on update with old doc available', async ({
    admin,
  }) => {
    await makeDoctypes(admin)
    const events: string[] = []
    registerProbe(events)
    try {
      const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
        doctype: DT,
        doc: { title: 'x' },
      })
      events.length = 0
      const upd = await admin.post<Record<string, unknown>>('/api/save_doc', {
        doctype: DT,
        doc: { name: doc.name, modified: doc.modified, title: 'y' },
      })
      expect(events).toEqual(['validate', 'before_save', 'after_save'])
      expect(upd.computed).toBe('Y:upd')
    } finally {
      clearControllers(DT)
    }
  })

  test('a validate error aborts the entire transaction — no row inserted', async ({ admin }) => {
    await makeDoctypes(admin)
    const events: string[] = []
    registerProbe(events)
    try {
      await expect(
        admin.post('/api/save_doc', { doctype: DT, doc: { title: 'explode' } }),
      ).rejects.toMatchObject({ status: 417 })
      const [{ count }] = await sql.unsafe(
        `select count(*)::int as count from tab_hook_chain_probe where title='explode' or title='EXPLODE'`,
      )
      expect(count).toBe(0)
    } finally {
      clearControllers(DT)
    }
  })

  test('DocTypes without controllers still save', async ({ admin }) => {
    await makeDoctypes(admin)
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: FILE_DT, doc: { title: 'No Hooks Needed' } }),
    })
    expect(res.status).toBe(201)
  })
})

describe('DOC-004: file-based controller registry', () => {
  test('the controllers/hook_file_demo.ts file is loaded and its hooks fire', async ({ admin }) => {
    await makeDoctypes(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: FILE_DT,
      doc: { title: 'Hello World' },
    })
    expect(doc.slug).toBe('hello-world')
    await expect(
      admin.post('/api/save_doc', { doctype: FILE_DT, doc: { title: 'forbidden' } }),
    ).rejects.toMatchObject({ status: 417, fields: { title: expect.anything() } })
  })
})
