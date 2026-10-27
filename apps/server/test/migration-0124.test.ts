// Migration 0124 (26-Oct-2026): the script API object is named `featherbase`,
// so stored Server Script and Client Script source that calls `frappe.` is
// rewritten. Only the identifier used as an object changes; other names, and
// text that merely contains the word (strings, template text, comments,
// regular expressions), are kept (#556).
import { describe, expect, it, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { runApiScript } from '../src/server-scripts'
import { renameScriptApi, up } from '../migrations/0124_script_api_featherbase'

/** Run the migration, returning what it reported. */
async function migrate(): Promise<string[]> {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')) })
  try {
    await up()
  } finally {
    log.mockRestore()
  }
  return lines
}

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

    await migrate()

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

    await migrate()

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

    await migrate()

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

  // #556: the earlier text-level rewrite changed these too, silently.
  test('a frappe. inside a string, a URL, template text, a comment or a regex is kept', async ({ admin }) => {
    const script = [
      'var r = fetch("https://frappe.io/api"); var msg = "see frappe.throw docs"',
      "var single = 'frappe.ui'",
      'var t = `frappe.x is ${frappe.session.user} and ${`nested frappe.y ${frappe.z}`}`',
      '// call frappe.throw here',
      '/* frappe.old */ var re = /frappe\\.io/',
      'frappe . throw(msg); frappe?.ui',
    ].join('\n')
    await saveRow(admin, 'Server Script', { row_id: 'm0124-text', script_type: 'API', api_method: 'm0124_text', script, enabled: false })

    await migrate()

    expect(await serverScript('m0124-text')).toBe([
      'var r = fetch("https://frappe.io/api"); var msg = "see frappe.throw docs"',
      "var single = 'frappe.ui'",
      'var t = `frappe.x is ${featherbase.session.user} and ${`nested frappe.y ${featherbase.z}`}`',
      '// call frappe.throw here',
      '/* frappe.old */ var re = /frappe\\.io/',
      'featherbase . throw(msg); featherbase?.ui',
    ].join('\n'))
  })

  test('a second run changes nothing', async ({ admin }) => {
    await saveRow(admin, 'Server Script', {
      row_id: 'm0124-rerun', script_type: 'API', api_method: 'm0124_rerun', enabled: false,
      script: 'frappe.throw("frappe.throw")',
    })
    await migrate()
    expect(await serverScript('m0124-rerun')).toBe('featherbase.throw("frappe.throw")')
    expect(await migrate()).toEqual(['script-api-rename: 0 Server Scripts and 0 Client Scripts rewritten'])
    expect(await serverScript('m0124-rerun')).toBe('featherbase.throw("frappe.throw")')
  })

  test('a script that cannot be read as JavaScript is left as it is, and named', async ({ admin }) => {
    await saveRow(admin, 'Server Script', {
      row_id: 'm0124-broken', script_type: 'API', api_method: 'm0124_broken', enabled: false,
      script: 'frappe.throw("unterminated)',
    })
    const report = await migrate()
    expect(await serverScript('m0124-broken')).toBe('frappe.throw("unterminated)')
    expect(report).toContain('script-api-rename: left unchanged, not readable as JavaScript (edit by hand): Server Script m0124-broken')
  })

  // A bare `frappe` the rename cannot follow (a typeof guard, a local of that
  // name) would change meaning silently, so the script is named for a person.
  test('a script with a bare frappe left after the rename is named for checking by hand', async ({ admin }) => {
    await saveRow(admin, 'Server Script', {
      row_id: 'm0124-bare', script_type: 'API', api_method: 'm0124_bare', enabled: false,
      script: 'if (typeof frappe !== "undefined") frappe.throw("x")',
    })
    await saveRow(admin, 'Server Script', {
      row_id: 'm0124-local', script_type: 'API', api_method: 'm0124_local', enabled: false,
      script: 'const frappe = { a: 1 }; result = frappe.a',
    })
    const report = await migrate()
    expect(await serverScript('m0124-bare')).toBe('if (typeof frappe !== "undefined") featherbase.throw("x")')
    expect(report).toContain('script-api-rename: still names frappe outside a member access (check by hand): Server Script m0124-bare, Server Script m0124-local')
  })
})

describe('0124: the rename itself', () => {
  it('returns null for source it cannot read, and the source itself when there is nothing to rename', () => {
    expect(renameScriptApi('"open')).toBeNull()
    expect(renameScriptApi('return 1')).toEqual({ source: 'return 1', bare: false })
    expect(renameScriptApi('await x; return frappe.y')).toEqual({ source: 'await x; return featherbase.y', bare: false })
    expect(renameScriptApi('var f = frappe; o.frappe = 1')).toEqual({ source: 'var f = frappe; o.frappe = 1', bare: true })
  })
})
