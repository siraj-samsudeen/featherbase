import { createRequire } from 'node:module'
import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { renderPdf, renderPrintHtml } from '../src/print'
import { createTable } from '../src/table-engine'
import { saveDoc } from '../src/document'
import { test } from './pg-test'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse') as {
  PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> }
}

// PRN-003: the print pipeline produces a valid PDF whose text includes the
// document's field values, for both the auto layout and a Print Format.
// (The Chromium instance is a process-wide singleton — never closed here.)

const DT = 'Pdf Srv DT'

async function pdfText(html: string): Promise<string> {
  const pdf = await renderPdf(html)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  return (await parser.getText()).text
}

async function setup() {
  await createTable({
    name: DT,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'customer', column_type: 'Data' },
      { column_name: 'amount', column_type: 'Int' },
    ],
  })
  await saveDoc(DT, { row_id: 'srv-1', customer: 'Umbrella Corp', amount: 9876 }, 'Administrator')
}

describe('PRN-003: server-side PDF', () => {
  test('auto-layout PDF contains the field values', async () => {
    await setup()
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'standard')
    expect(html).toMatch(/^<!DOCTYPE html>/)
    const text = await pdfText(html)
    expect(text).toContain('Umbrella Corp')
    expect(text).toContain('9876')
  }, 30_000)

  test('a Print Format template is interpolated into the PDF', async () => {
    await setup()
    await sql`
      insert into print_format (row_id, created_by, updated_by, ref_table, is_default, template)
      values ('Pdf Srv Format', 'Administrator', 'Administrator', ${DT}, false,
        '<h1>RECEIPT</h1><p>Paid by {{ customer }} — {{ amount }} USD</p>')`
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'Pdf Srv Format')
    const text = await pdfText(html)
    expect(text).toContain('RECEIPT')
    expect(text).toContain('Paid by Umbrella Corp')
    expect(text).toContain('9876')
  }, 30_000)
})

// Printing / Print a row — the server-side PDF download of one row.
describe('Print a row', () => {
  test('downloading a row as a PDF returns a PDF with its values, and the print is recorded', async ({
    admin,
  }) => {
    await setup()
    const res = await admin.fetch(`/api/print/${encodeURIComponent(DT)}/srv-1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const pdf = Buffer.from(await res.arrayBuffer())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const parser = new PDFParse({ data: new Uint8Array(pdf) })
    expect((await parser.getText()).text).toContain('Umbrella Corp')

    const logged = await sql`
      select operation, method, reference_name from access_log
      where ref_table = ${DT} and operation = 'print'`
    expect(logged).toEqual([{ operation: 'print', method: 'pdf', reference_name: 'srv-1' }])
  }, 30_000)

  test('a row the user cannot open cannot be printed either', async ({ admin, createUser }) => {
    await setup()
    const stranger = await createUser({ roles: [] })
    const res = await stranger.fetch(`/api/print/${encodeURIComponent(DT)}/srv-1`)
    expect(res.status).toBe(403)
    expect(await sql`select 1 from access_log where ref_table = ${DT} and operation = 'print'`).toHaveLength(0)
    // Admin is unaffected.
    expect((await admin.fetch(`/api/print/${encodeURIComponent(DT)}/srv-1`)).status).toBe(200)
  }, 30_000)
})

describe('A print format fixes the layout and wording', () => {
  async function formats() {
    await setup()
    await sql`
      insert into print_format (row_id, created_by, updated_by, ref_table, is_default, template)
      values ('Pf Invoice', 'Administrator', 'Administrator', ${DT}, true, '<h1>INVOICE for {{ customer }}</h1>'),
             ('Pf Receipt', 'Administrator', 'Administrator', ${DT}, false, '<h1>RECEIPT for {{ customer }}</h1>')`
  }

  test('the format marked as default is used when nobody picks one, and a pick replaces it', async () => {
    await formats()
    const byDefault = await renderPrintHtml(DT, 'srv-1', 'Administrator')
    expect(byDefault).toContain('INVOICE for Umbrella Corp')
    const picked = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'Pf Receipt')
    expect(picked).toContain('RECEIPT for Umbrella Corp')
    expect(picked).not.toContain('INVOICE')
  })

  test('the standard layout can still be chosen over a default format', async () => {
    await formats()
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'standard')
    expect(html).not.toContain('INVOICE')
    expect(html).toContain('Umbrella Corp')
  })

  test('a value containing markup is printed as text, not run as markup', async () => {
    await formats()
    await saveDoc(DT, { row_id: 'srv-2', customer: '<script>alert(1)</script>', amount: 1 }, 'Administrator')
    const html = await renderPrintHtml(DT, 'srv-2', 'Administrator', 'Pf Receipt')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('a Sub-table prints as a table under its heading', () => {
  test('the standard layout lists each child row under the Sub-table\'s label, without framework columns', async () => {
    await createTable({
      name: 'Pdf Line',
      kind: 'sub_table',
      columns: [
        { column_name: 'item', column_type: 'Data' },
        { column_name: 'qty', column_type: 'Int' },
      ],
    })
    await createTable({
      name: 'Pdf Order',
      id_pattern: 'prompt',
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pdf Line', label: 'Order lines' },
        { column_name: 'empty_lines', column_type: 'Sub-table', row_table: 'Pdf Line' },
      ],
    })
    await saveDoc('Pdf Order', { row_id: 'ord-1', title: 'First', lines: [{ item: 'Bolt', qty: 4 }, { item: 'Nut', qty: 9 }] }, 'Administrator')
    const html = await renderPrintHtml('Pdf Order', 'ord-1', 'Administrator', 'standard')
    expect(html).toContain('<h2>Order lines</h2>')
    expect(html).toContain('<th>item</th><th>qty</th></tr></thead><tbody><tr><td>Bolt</td><td>4</td></tr><tr><td>Nut</td><td>9</td></tr>')
    expect(html).not.toContain('<th>parent</th>')
    // A Sub-table with no rows still prints its heading, with an empty table.
    expect(html).toContain('<h2>empty_lines</h2><table><thead><tr></tr></thead><tbody></tbody></table>')
  }, 30_000)
})

describe('finding the Chromium binary', () => {
  // A fake Playwright bundle root: <root>/<dir>/<layout>, each an empty file.
  async function bundle(layouts: Record<string, string>) {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { dirname, join } = await import('node:path')
    const root = mkdtempSync(join(tmpdir(), 'pw-'))
    for (const [dir, rel] of Object.entries(layouts)) {
      mkdirSync(dirname(join(root, dir, rel)), { recursive: true })
      writeFileSync(join(root, dir, rel), '')
    }
    return root
  }
  const resolveWith = async (env: Record<string, string>) => {
    const { withVariable } = await import('../src/env')
    const { resolveChromium } = await import('../src/print')
    const entries = Object.entries(env) as ['CHROMIUM_PATH' | 'PLAYWRIGHT_BROWSERS_PATH', string][]
    const apply = async (i: number): Promise<string | undefined> =>
      i === entries.length ? resolveChromium() : withVariable(entries[i][0], entries[i][1], () => apply(i + 1))
    return apply(0)
  }

  test('CHROMIUM_PATH wins when it names a file that exists', async () => {
    const root = await bundle({ 'chromium-1': 'chrome-linux/chrome' })
    expect(await resolveWith({ CHROMIUM_PATH: `${root}/chromium-1/chrome-linux/chrome`, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' })).toBe(`${root}/chromium-1/chrome-linux/chrome`)
  })

  test('without CHROMIUM_PATH, or with one that is missing, the newest bundle under the browsers path is searched in each platform layout', async () => {
    const { join } = await import('node:path')
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const root = await bundle({ 'chromium-1100': rel, 'chromium-1243': rel, 'chromium_headless_shell-1243': 'x/y' })
      expect(await resolveWith({ CHROMIUM_PATH: '/nonexistent/chrome', PLAYWRIGHT_BROWSERS_PATH: root })).toBe(join(root, 'chromium-1243', ...rel.split('/')))
    }
  })

  test('with nothing to find it leaves the choice to Playwright', async () => {
    const empty = await bundle({ 'chromium-1': 'unrelated/file' })
    expect(await resolveWith({ CHROMIUM_PATH: '', PLAYWRIGHT_BROWSERS_PATH: empty })).toBeUndefined()
    expect(await resolveWith({ CHROMIUM_PATH: '', PLAYWRIGHT_BROWSERS_PATH: '/nonexistent/browsers' })).toBeUndefined()
  })

  test('the container\'s own browsers directory is searched when no path is given', async () => {
    const { withVariable } = await import('../src/env')
    const { resolveChromium } = await import('../src/print')
    const { existsSync } = await import('node:fs')
    const found = await withVariable('CHROMIUM_PATH', '', async () => resolveChromium())
    // /opt/pw-browsers exists in the container and CI image; elsewhere Playwright decides.
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) return
    if (existsSync('/opt/pw-browsers')) expect(found).toMatch(/^\/opt\/pw-browsers\/chromium-\d+\/chrome-linux6?4?\/chrome$/)
    else expect(found).toBeUndefined()
  })
})

describe('the shared browser', () => {
  test('a browser that has died is replaced on the next request, and a failed launch is not remembered', async () => {
    const { getBrowser } = await import('../src/print')
    const { withVariable } = await import('../src/env')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const first = await getBrowser()
    expect(await getBrowser()).toBe(first)
    await first.close()
    const second = await getBrowser()
    expect(second).not.toBe(first)
    expect(second.isConnected()).toBe(true)
    await second.close()

    // A "browser" that exits after a second: the first caller's launch fails; a second
    // caller who arrived while it was pending sees the failure, tries again and fails
    // too. Neither failure is remembered.
    const bogus = join(mkdtempSync(join(tmpdir(), 'bogus-')), 'chrome')
    writeFileSync(bogus, '#!/bin/sh\nsleep 1\nexit 1\n', { mode: 0o755 })
    await withVariable('CHROMIUM_PATH', bogus, async () => {
      const early = getBrowser()
      await new Promise((r) => setTimeout(r, 300))
      const late = getBrowser()
      expect((await Promise.allSettled([early, late])).map((r) => r.status)).toEqual(['rejected', 'rejected'])
    })
    const recovered = await getBrowser()
    expect(recovered.isConnected()).toBe(true)
  }, 60_000)
})
