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
