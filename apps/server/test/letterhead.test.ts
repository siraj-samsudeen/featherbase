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

// PRN-004: a Letter Head's header/footer is applied to printed documents —
// picked up as the default, named on a Print Format, or chosen explicitly, and
// interpolated with {{ field }} the same way a Print Format template is.
// (The Chromium instance is a process-wide singleton — never closed here.)

const DT = 'Lh Srv DT'

async function pdfText(html: string): Promise<string> {
  const pdf = await renderPdf(html)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  return (await parser.getText()).text
}

// Each test builds its DocType, document, and letterheads inside its own
// sandbox transaction.
async function setup() {
  await createDocType({
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'company', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Int' },
    ],
  })
  await saveDoc(DT, { name: 'lh-1', company: 'Umbrella Corp', amount: 4200 }, 'Administrator')

  // Two letterheads; only Lh Corp is the default.
  await saveDoc(
    'Letter Head',
    {
      name: 'Lh Corp',
      is_default: true,
      header_html: '<div>ACME GLOBAL — invoice for {{ company }}</div>',
      footer_html: '<div>Thank you for your business</div>',
    },
    'Administrator',
  )
  await saveDoc(
    'Letter Head',
    {
      name: 'Lh Branch',
      is_default: false,
      header_html: '<div>ACME BRANCH OFFICE</div>',
      footer_html: '<div>Branch footer line</div>',
    },
    'Administrator',
  )
}

describe('PRN-004: letterheads', () => {
  test('the default letterhead is applied when none is named, with field interpolation', async () => {
    await setup()
    const html = await renderPrintHtml(DT, 'lh-1', 'Administrator', 'standard')
    expect(html).toContain('ACME GLOBAL — invoice for Umbrella Corp')
    expect(html).toContain('Thank you for your business')
    const text = await pdfText(html)
    expect(text).toContain('ACME GLOBAL')
    expect(text).toContain('Umbrella Corp')
    expect(text).toContain('Thank you for your business')
  }, 30_000)

  test('an explicitly chosen letterhead overrides the default', async () => {
    await setup()
    const html = await renderPrintHtml(DT, 'lh-1', 'Administrator', 'standard', 'Lh Branch')
    expect(html).toContain('ACME BRANCH OFFICE')
    expect(html).not.toContain('ACME GLOBAL')
  })

  test("'none' suppresses the letterhead entirely", async () => {
    await setup()
    const html = await renderPrintHtml(DT, 'lh-1', 'Administrator', 'standard', 'none')
    expect(html).not.toContain('ACME')
    expect(html).not.toContain('<header class="letter-head">')
    expect(html).not.toContain('<footer class="letter-foot">')
  })

  test('a Print Format can name the letterhead it prints with', async () => {
    await setup()
    await sql`
      insert into tab_print_format (name, owner, modified_by, doc_type, is_default, letter_head, template)
      values ('Lh Fmt', 'Administrator', 'Administrator', ${DT}, false, 'Lh Branch',
        '<h1>RECEIPT</h1><p>{{ company }}</p>')`
    const html = await renderPrintHtml(DT, 'lh-1', 'Administrator', 'Lh Fmt')
    expect(html).toContain('RECEIPT')
    expect(html).toContain('ACME BRANCH OFFICE') // named on the format
    expect(html).not.toContain('ACME GLOBAL') // not the default
  })
})
