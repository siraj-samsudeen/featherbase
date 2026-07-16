import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { runApiScript } from '../src/server-scripts'
import { areq } from './helpers'

// CUST-004: sandboxed Server Scripts reject saves conditionally, can set
// fields, run as API methods, and cannot reach fs/network/process.

const DT = 'SS Srv Doc'

async function cleanup() {
  await sql`delete from tab_server_script where reference_doctype = ${DT} or api_method in ('srv_double', 'srv_loop')`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_ss_srv_doc')
}

async function makeScript(doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'Server Script', doc }) })
  if (res.status !== 201) throw new Error(`script: ${res.status} ${await res.text()}`)
}

async function saveDoc(doc: Record<string, unknown>) {
  return areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: DT, doc }) })
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'amount', fieldtype: 'Int' }, { fieldname: 'status', fieldtype: 'Data' }] }),
  })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('CUST-004: server scripts', () => {
  it('rejects a save conditionally (validate event)', async () => {
    await makeScript({ name: 'ss-srv-reject', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: 'if (doc.amount < 0) frappe.throw("no negatives")', enabled: true })
    const bad = await saveDoc({ amount: -1 })
    expect(bad.status).toBe(417)
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain('no negatives')
    const ok = await saveDoc({ amount: 5 })
    expect(ok.status).toBe(201)
  })

  it('can set a field (before_save event)', async () => {
    await sql`delete from tab_server_script where name = 'ss-srv-reject'`
    await makeScript({ name: 'ss-srv-set', script_type: 'Document Event', reference_doctype: DT, event: 'before_save', script: 'doc.status = doc.amount > 100 ? "big" : "small"', enabled: true })
    const res = await saveDoc({ amount: 200 })
    const created = (await res.json()) as { name: string }
    const [row] = await sql`select status from tab_ss_srv_doc where name = ${created.name}`
    expect(row.status).toBe('big')
  })

  it('sandbox blocks require, process, and fetch', async () => {
    await sql`delete from tab_server_script where reference_doctype = ${DT}`
    for (const bad of ['require("fs")', 'process.exit(1)', 'fetch("http://x")']) {
      await sql`delete from tab_server_script where name = 'ss-srv-evil'`
      await makeScript({ name: 'ss-srv-evil', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: bad, enabled: true })
      const res = await saveDoc({ amount: 1 })
      expect(res.status).toBe(417)
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/is not defined|is not a function/)
    }
    await sql`delete from tab_server_script where name = 'ss-srv-evil'`
  })

  it('does not run a disabled script', async () => {
    await sql`delete from tab_server_script where reference_doctype = ${DT}`
    await makeScript({ name: 'ss-srv-off', script_type: 'Document Event', reference_doctype: DT, event: 'validate', script: 'frappe.throw("should not fire")', enabled: false })
    const res = await saveDoc({ amount: 1 })
    expect(res.status).toBe(201)
    await sql`delete from tab_server_script where name = 'ss-srv-off'`
  })

  it('runs an API script and returns its result', async () => {
    await makeScript({ name: 'ss-srv-double', script_type: 'API', api_method: 'srv_double', script: 'result = (args.n || 0) * 2', enabled: true })
    expect(await runApiScript('srv_double', { n: 21 })).toBe(42)
  })

  it('time-boxes a runaway script instead of hanging', async () => {
    await makeScript({ name: 'ss-srv-loop', script_type: 'API', api_method: 'srv_loop', script: 'while(true){}', enabled: true })
    await expect(runApiScript('srv_loop', {})).rejects.toMatchObject({ type: 'ValidationError' })
  })
})
