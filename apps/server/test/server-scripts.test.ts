import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { runApiScript } from '../src/server-scripts'

// CUST-004: sandboxed Server Scripts reject saves conditionally, can set
// fields, run as API methods, and cannot reach fs/network/process.

const DT = 'SS Srv Doc'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'amount', fieldtype: 'Int' },
      { fieldname: 'status', fieldtype: 'Data' },
    ],
  })
}

async function makeScript(admin: TestClient, doc: Record<string, unknown>) {
  await admin.post('/api/save_doc', { doctype: 'Server Script', doc })
}

function saveTarget(admin: TestClient, doc: Record<string, unknown>) {
  return admin.fetch('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: DT, doc }),
  })
}

describe('CUST-004: server scripts', () => {
  test('rejects a save conditionally (validate event)', async ({ admin }) => {
    await setup(admin)
    await makeScript(admin, { name: 'ss-srv-reject', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: 'if (doc.amount < 0) frappe.throw("no negatives")', enabled: true })
    const bad = await saveTarget(admin, { amount: -1 })
    expect(bad.status).toBe(417)
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain('no negatives')
    const ok = await saveTarget(admin, { amount: 5 })
    expect(ok.status).toBe(201)
  })

  test('can set a field (before_save event)', async ({ admin }) => {
    await setup(admin)
    await makeScript(admin, { name: 'ss-srv-set', script_type: 'Document Event', reference_doctype: DT, event: 'before_save', script: 'doc.status = doc.amount > 100 ? "big" : "small"', enabled: true })
    const created = await admin.post<{ name: string }>('/api/save_doc', {
      doctype: DT,
      doc: { amount: 200 },
    })
    const [row] = await sql`select status from tab_ss_srv_doc where name = ${created.name}`
    expect(row.status).toBe('big')
  })

  test('sandbox blocks require, process, and fetch', async ({ admin }) => {
    await setup(admin)
    for (const bad of ['require("fs")', 'process.exit(1)', 'fetch("http://x")']) {
      await sql`delete from tab_server_script where name = 'ss-srv-evil'`
      await makeScript(admin, { name: 'ss-srv-evil', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: bad, enabled: true })
      const res = await saveTarget(admin, { amount: 1 })
      expect(res.status).toBe(417)
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/is not defined|is not a function/)
    }
  })

  test('does not run a disabled script', async ({ admin }) => {
    await setup(admin)
    await makeScript(admin, { name: 'ss-srv-off', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: 'frappe.throw("should not fire")', enabled: false })
    const res = await saveTarget(admin, { amount: 1 })
    expect(res.status).toBe(201)
  })

  test('runs an API script and returns its result', async ({ admin }) => {
    await setup(admin)
    await makeScript(admin, { name: 'ss-srv-double', script_type: 'API', api_method: 'srv_double', script: 'result = (args.n || 0) * 2', enabled: true })
    expect(await runApiScript('srv_double', { n: 21 })).toBe(42)
  })

  test('time-boxes a runaway script instead of hanging', async ({ admin }) => {
    await setup(admin)
    await makeScript(admin, { name: 'ss-srv-loop', script_type: 'API', api_method: 'srv_loop', script: 'while(true){}', enabled: true })
    await expect(runApiScript('srv_loop', {})).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('cannot escape the sandbox via a constructor to reach the host realm', async ({ admin }) => {
    await setup(admin)
    // Eval #13 regression: injecting host built-ins let Object.constructor
    // (the host Function) run in the host realm and reach `process`.
    await makeScript(admin, { name: 'ss-srv-esc', script_type: 'API', api_method: 'srv_esc', script: 'result = Object.constructor("return typeof process")()', enabled: true })
    // In the sandbox, Object is context-native → process is undefined, not the
    // host process object.
    expect(await runApiScript('srv_esc', {})).toBe('undefined')

    // A direct attempt to read the pid errors (process not defined) — it never
    // returns a number.
    await sql`delete from tab_server_script where name = 'ss-srv-esc'`
    await makeScript(admin, { name: 'ss-srv-esc', script_type: 'API', api_method: 'srv_esc2', script: 'result = Object.constructor("return process.pid")()', enabled: true })
    await expect(runApiScript('srv_esc2', {})).rejects.toMatchObject({ type: 'ValidationError' })
  })
})
