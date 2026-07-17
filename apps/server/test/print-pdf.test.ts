import { createRequire } from 'node:module'
import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { renderPdf, renderPrintHtml } from '../src/print'
import { createDocType } from '../src/doctype-engine'
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
  await createDocType({
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'customer', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Int' },
    ],
  })
  await saveDoc(DT, { name: 'srv-1', customer: 'Umbrella Corp', amount: 9876 }, 'Administrator')
}

describe('PRN-003: server-side PDF', () => {
  test('auto-layout PDF contains the field values', async () => {
    await setup()
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'standard')
    const text = await pdfText(html)
    expect(text).toContain('Umbrella Corp')
    expect(text).toContain('9876')
  }, 30_000)

  test('a Print Format template is interpolated into the PDF', async () => {
    await setup()
    await sql`
      insert into tab_print_format (name, owner, modified_by, doc_type, is_default, template)
      values ('Pdf Srv Format', 'Administrator', 'Administrator', ${DT}, false,
        '<h1>RECEIPT</h1><p>Paid by {{ customer }} — {{ amount }} USD</p>')`
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'Pdf Srv Format')
    const text = await pdfText(html)
    expect(text).toContain('RECEIPT')
    expect(text).toContain('Paid by Umbrella Corp')
    expect(text).toContain('9876')
  }, 30_000)
})
