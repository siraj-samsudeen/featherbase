import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc, submitDoc } from '../src/document'
import { registerApp, installApp, uninstallApp } from '../src/apps'
import { callMethod } from '../src/methods'

// Frappe lifecycle parity: before_validate and on_update fire in Frappe's
// order, doc_events["*"] hooks every DocType, an app's scheduler_events get a
// live recurring job, and override_whitelisted_methods swaps an RPC handler
// (restored on uninstall).

const DT = 'Hook Parity Note'

async function makeDT(admin: TestClient, opts: { submittable?: boolean } = {}) {
  await admin.post('/api/doctype', {
    name: DT,
    is_submittable: opts.submittable ?? false,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
}

describe('Frappe lifecycle + app-contract parity', () => {
  test('before_validate and on_update fire in order on insert and update', async ({ admin }) => {
    await makeDT(admin)
    const seen: string[] = []
    const APP = `hookp-order-${Date.now()}`
    registerApp({
      name: APP,
      doc_events: {
        [DT]: {
          before_validate: ({ doc }) => {
            seen.push('before_validate')
            // Frappe's canonical use: normalise before validation runs.
            if (typeof doc.title === 'string') doc.title = doc.title.trim()
          },
          validate: () => seen.push('validate'),
          on_update: () => seen.push('on_update'),
        },
      },
    })
    try {
      await installApp(APP)
      const doc = await saveDoc(DT, { title: '  padded  ' }, 'Administrator')
      expect(doc.title).toBe('padded')
      expect(seen).toEqual(['before_validate', 'validate', 'on_update'])

      seen.length = 0
      await saveDoc(
        DT,
        { name: doc.name, modified: (doc.modified as Date).toISOString(), title: 'again' },
        'Administrator',
      )
      expect(seen).toEqual(['before_validate', 'validate', 'on_update'])
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('before_submit can abort and on_update fires on submit', async ({ admin }) => {
    await makeDT(admin, { submittable: true })
    const seen: string[] = []
    const APP = `hookp-submit-${Date.now()}`
    registerApp({
      name: APP,
      doc_events: {
        [DT]: {
          before_submit: ({ doc }) => {
            seen.push('before_submit')
            if (doc.title === 'blocked') throw new Error('submission blocked')
          },
          on_update: () => seen.push('on_update'),
          on_submit: () => seen.push('on_submit'),
        },
      },
    })
    try {
      await installApp(APP)
      const ok = await saveDoc(DT, { title: 'fine' }, 'Administrator')
      seen.length = 0
      await submitDoc(DT, String(ok.name), 'Administrator')
      expect(seen).toEqual(['before_submit', 'on_update', 'on_submit'])

      const bad = await saveDoc(DT, { title: 'blocked' }, 'Administrator')
      await expect(submitDoc(DT, String(bad.name), 'Administrator')).rejects.toThrow(
        'submission blocked',
      )
      const [row] = await sql`
        select docstatus from tab_hook_parity_note where name = ${String(bad.name)}`
      expect(row.docstatus).toBe(0) // the abort rolled the write back
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('doc_events["*"] hooks every DocType', async ({ admin }) => {
    await makeDT(admin)
    const audited: string[] = []
    const APP = `hookp-wild-${Date.now()}`
    registerApp({
      name: APP,
      doc_events: {
        '*': { after_insert: ({ meta }) => void audited.push(meta.name) },
      },
    })
    try {
      await installApp(APP)
      await saveDoc(DT, { title: 'a' }, 'Administrator')
      await saveDoc('Role', { name: `Hookp Wild Role ${Date.now()}` }, 'Administrator')
      expect(audited).toContain(DT)
      expect(audited).toContain('Role')
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('scheduler_events register a handler and a live recurring job', async ({ admin: _a }) => {
    const APP = `hookp-sched-${Date.now()}`
    const METHOD = `hookp_sweep_${Date.now()}`
    registerApp({
      name: APP,
      scheduler_events: [{ method: METHOD, every_seconds: 3600, handler: async () => {} }],
    })
    try {
      await installApp(APP)
      const [job] = await sql`
        select repeat_every from tab_background_job where method = ${METHOD} and status = 'queued'`
      expect(Number(job.repeat_every)).toBe(3600)
    } finally {
      await uninstallApp(APP).catch(() => {})
      const rows = await sql`select 1 from tab_background_job where method = ${METHOD} and status = 'queued'`
      expect(rows.length).toBe(0) // uninstall dropped the pending recurrence
    }
  })

  test('override_whitelisted_methods swaps an RPC handler and restores it on uninstall', async () => {
    const APP = `hookp-override-${Date.now()}`
    const guest = { name: 'Guest', email: 'guest@x', full_name: 'Guest' }
    registerApp({
      name: APP,
      override_whitelisted_methods: { 'frappe.ping': () => 'pong from app' },
    })
    try {
      expect(await callMethod('frappe.ping', {}, guest)).toBe('pong')
      await installApp(APP)
      expect(await callMethod('frappe.ping', {}, guest)).toBe('pong from app')
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
    expect(await callMethod('frappe.ping', {}, guest)).toBe('pong')
  })
})
