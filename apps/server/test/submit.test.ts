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
    columns: [{ column_name: 'amount', column_type: 'Currency' }],
  })
  await admin.post('/api/doctype', {
    name: PLAIN,
    columns: [{ column_name: 'x', column_type: 'Data' }],
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
      table: DT,
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
      expect(doc.status).toBe('draft')

      fired.length = 0
      const submitted = await admin.post<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(DT)}/${doc.name}:submit`,
      )
      expect(submitted.status).toBe('submitted')
      expect(fired).toEqual(['on_submit'])

      // Immutable while submitted
      await expect(
        admin.post('/api/save_doc', {
          doctype: DT,
          doc: { name: doc.name, updated_at: submitted.updated_at, amount: 999 },
        }),
      ).rejects.toMatchObject({
        status: 417,
        message: expect.stringMatching(/submitted/),
      })

      // Cannot delete while submitted
      await expect(
        admin.delete(`/api/table/${encodeURIComponent(DT)}/${doc.name}`),
      ).rejects.toMatchObject({ status: 417 })

      // Cannot double-submit
      await expect(
        admin.post(`/api/table/${encodeURIComponent(DT)}/${doc.name}:submit`),
      ).rejects.toMatchObject({ status: 417 })

      const cancelled = await admin.post<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(DT)}/${doc.name}:cancel`,
      )
      expect(cancelled.status).toBe('cancelled')
      expect(fired).toEqual(['on_submit', 'on_cancel'])

      // Cancelled is terminal for edits
      await expect(
        admin.post('/api/save_doc', {
          doctype: DT,
          doc: { name: doc.name, updated_at: cancelled.updated_at, amount: 5 },
        }),
      ).rejects.toMatchObject({ status: 417 })
    } finally {
      clearControllers(DT)
    }
  })

  test('cannot cancel a draft; cannot submit a non-submittable Table', async ({ admin }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: DT,
      doc: { amount: 1 },
    })
    await expect(
      admin.post(`/api/table/${encodeURIComponent(DT)}/${doc.name}:cancel`),
    ).rejects.toMatchObject({ status: 417 })

    const plain = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: PLAIN,
      doc: { x: 'a' },
    })
    await expect(
      admin.post(`/api/table/${encodeURIComponent(PLAIN)}/${plain.name}:submit`),
    ).rejects.toMatchObject({
      status: 417,
      message: expect.stringMatching(/not submittable/),
    })
  })
})
