import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { clearControllers, registerController } from '../src/controllers'

const DT = 'Sbm Expense'
const PLAIN = 'Sbm Plain'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    is_submittable: true,
    fields: [{ fieldname: 'amount', fieldtype: 'Currency' }],
  })
  await admin.post('/api/doctype', {
    name: PLAIN,
    fields: [{ fieldname: 'x', fieldtype: 'Data' }],
  })
}

describe('DOC-007: submittable documents', () => {
  test('full lifecycle: draft -> submit (hook, immutable, undeletable) -> cancel', async ({
    admin,
  }) => {
    await setup(admin)
    // Controller registration is per-process (not part of the DB sandbox), so
    // register inside the test and clear again in `finally`.
    const fired: string[] = []
    registerController({
      doctype: DT,
      hooks: {
        on_submit: () => { fired.push('on_submit') },
        on_cancel: () => { fired.push('on_cancel') },
      },
    })
    try {
      const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
        doctype: DT,
        doc: { amount: 100 },
      })
      expect(doc.docstatus).toBe(0)

      fired.length = 0
      const submitted = await admin.post<Record<string, unknown>>('/api/submit_doc', {
        doctype: DT,
        name: doc.name,
      })
      expect(submitted.docstatus).toBe(1)
      expect(fired).toEqual(['on_submit'])

      // Immutable while submitted
      await expect(
        admin.post('/api/save_doc', {
          doctype: DT,
          doc: { name: doc.name, modified: submitted.modified, amount: 999 },
        }),
      ).rejects.toMatchObject({
        status: 417,
        message: expect.stringMatching(/submitted/),
      })

      // Cannot delete while submitted
      await expect(
        admin.delete(`/api/doc/${encodeURIComponent(DT)}/${doc.name}`),
      ).rejects.toMatchObject({ status: 417 })

      // Cannot double-submit
      await expect(
        admin.post('/api/submit_doc', { doctype: DT, name: doc.name }),
      ).rejects.toMatchObject({ status: 417 })

      const cancelled = await admin.post<Record<string, unknown>>('/api/cancel_doc', {
        doctype: DT,
        name: doc.name,
      })
      expect(cancelled.docstatus).toBe(2)
      expect(fired).toEqual(['on_submit', 'on_cancel'])

      // Cancelled is terminal for edits
      await expect(
        admin.post('/api/save_doc', {
          doctype: DT,
          doc: { name: doc.name, modified: cancelled.modified, amount: 5 },
        }),
      ).rejects.toMatchObject({ status: 417 })
    } finally {
      clearControllers(DT)
    }
  })

  test('cannot cancel a draft; cannot submit a non-submittable DocType', async ({ admin }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { amount: 1 },
    })
    await expect(
      admin.post('/api/cancel_doc', { doctype: DT, name: doc.name }),
    ).rejects.toMatchObject({ status: 417 })

    const plain = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: PLAIN,
      doc: { x: 'a' },
    })
    await expect(
      admin.post('/api/submit_doc', { doctype: PLAIN, name: plain.name }),
    ).rejects.toMatchObject({
      status: 417,
      message: expect.stringMatching(/not submittable/),
    })
  })
})
