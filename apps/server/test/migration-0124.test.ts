// Migration 0124 (26-Oct-2026): the script API object is named `featherbase`,
// so stored Server Script and Client Script source that calls `frappe.` is
// rewritten. Only the identifier used as an object changes; other names and
// text that merely contain the word are kept.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { runApiScript } from '../src/server-scripts'

const MIGRATION = readFileSync(new URL('../migrations/0124_script_api_featherbase.sql', import.meta.url), 'utf8')

async function saveRow(admin: TestClient, table: string, row: Record<string, unknown>) {
  await admin.post('/api/save_row', { table, row })
}

async function serverScript(rowId: string): Promise<string> {
  const [row] = await sql`select script from server_script where row_id = ${rowId}`
  return row.script
}

async function clientScript(rowId: string): Promise<string> {
  const [row] = await sql`select script from client_script where row_id = ${rowId}`
  return row.script
}

describe('0124: stored scripts call the featherbase API object', () => {
  test('a Server Script calling frappe.throw is rewritten and runs again', async ({ admin }) => {
    await saveRow(admin, 'Server Script', {
      row_id: 'm0124-api',
      script_type: 'API',
      api_method: 'm0124_reject',
      script: 'if (args.n < 0) frappe.throw("no negatives")\nresult = args.n',
      enabled: true,
    })
    await expect(runApiScript('m0124_reject', { n: -1 })).rejects.toThrow(/frappe is not defined/)

    await sql.unsafe(MIGRATION)

    expect(await serverScript('m0124-api')).toBe('if (args.n < 0) featherbase.throw("no negatives")\nresult = args.n')
    await expect(runApiScript('m0124_reject', { n: -1 })).rejects.toThrow(/no negatives/)
    expect(await runApiScript('m0124_reject', { n: 2 })).toBe(2)
  })

  test('a Client Script calling frappe.ui.form.on is rewritten', async ({ admin }) => {
    await saveRow(admin, 'Client Script', {
      row_id: 'm0124-client',
      ref_table: 'Server Script',
      script: "frappe.ui.form.on('Server Script', {\n  onload: function (frm) { frm.set_value('enabled', 1) },\n});",
      enabled: true,
    })

    await sql.unsafe(MIGRATION)

    expect(await clientScript('m0124-client')).toBe(
      "featherbase.ui.form.on('Server Script', {\n  onload: function (frm) { frm.set_value('enabled', 1) },\n});",
    )
  })

  test('names that only contain the word, and the word in text, are kept', async ({ admin }) => {
    const script = [
      'var my_frappe = { x: 1 }; my_frappe.x = 2',
      'var $frappe = {}; $frappe.y = 1',
      'var o = { frappe: { z: 1 } }; o.frappe.z = 3',
      '// written for frappe, see frappe_docs',
      'if (doc) frappe.throw("a"); (frappe.throw)("b")',
    ].join('\n')
    await saveRow(admin, 'Server Script', { row_id: 'm0124-names', script_type: 'API', api_method: 'm0124_names', script, enabled: false })

    await sql.unsafe(MIGRATION)

    expect(await serverScript('m0124-names')).toBe(
      [
        'var my_frappe = { x: 1 }; my_frappe.x = 2',
        'var $frappe = {}; $frappe.y = 1',
        'var o = { frappe: { z: 1 } }; o.frappe.z = 3',
        '// written for frappe, see frappe_docs',
        'if (doc) featherbase.throw("a"); (featherbase.throw)("b")',
      ].join('\n'),
    )
  })
})
