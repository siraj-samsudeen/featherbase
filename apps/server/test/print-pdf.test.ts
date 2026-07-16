import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { renderPdf, renderPrintHtml } from '../src/print'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse') as {
  PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> }
}

// PRN-003: the print pipeline produces a valid PDF whose text includes the
// document's field values, for both the auto layout and a Print Format.

const DT = 'Pdf Srv DT'

async function pdfText(html: string): Promise<string> {
  const pdf = await renderPdf(html)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  return (await parser.getText()).text
}

beforeAll(async () => {
  await sql`delete from tab_print_format where doc_type = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_pdf_srv_dt')
  const { createDocType } = await import('../src/doctype-engine')
  await createDocType({
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'customer', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Int' },
    ],
  })
  const { saveDoc } = await import('../src/document')
  await saveDoc(DT, { name: 'srv-1', customer: 'Umbrella Corp', amount: 9876 }, 'Administrator')
})

afterAll(async () => {
  await sql`delete from tab_print_format where doc_type = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_pdf_srv_dt')
})

describe('PRN-003: server-side PDF', () => {
  it('auto-layout PDF contains the field values', async () => {
    const html = await renderPrintHtml(DT, 'srv-1', 'Administrator', 'standard')
    const text = await pdfText(html)
    expect(text).toContain('Umbrella Corp')
    expect(text).toContain('9876')
  }, 30_000)

  it('a Print Format template is interpolated into the PDF', async () => {
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
