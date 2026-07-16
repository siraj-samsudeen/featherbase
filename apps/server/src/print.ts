import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getMeta } from './meta'
import { getDoc } from './document'
import { sql } from './db'

// Server-side print rendering (PRN-003). Produces the same HTML the browser
// print view shows — either an interpolated Print Format template or a
// metadata auto-layout — then Chromium turns it into a PDF.

const FRAMEWORK_CHILD_COLS = new Set([
  'name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx',
  'parent', 'parenttype', 'parentfield',
])

type Doc = Record<string, unknown>

function esc(v: unknown): string {
  if (v == null) return ''
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

function fmt(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return esc(v)
}

function interpolate(template: string, doc: Doc): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = doc[key]
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return esc(v)
  })
}

// PRN-004: resolve the Letter Head applied to a print. Precedence:
//   1. an explicit choice (`letterHead` arg; the literal 'none' suppresses it);
//   2. a Letter Head named on the chosen Print Format;
//   3. the Letter Head marked `is_default`.
// The header/footer HTML is interpolated with the same {{ field }} syntax as a
// Print Format template, so a letterhead can echo document fields.
async function resolveLetterHead(
  doctype: string,
  format: string | undefined,
  letterHead: string | undefined,
): Promise<{ header: string; footer: string } | null> {
  if (letterHead === 'none') return null
  let name = letterHead
  if (!name && format && format !== 'standard') {
    const [pf] = await sql`
      select letter_head from tab_print_format where name = ${format} and doc_type = ${doctype}`
    if (pf?.letter_head) name = String(pf.letter_head)
  }
  if (!name) {
    const [def] = await sql`
      select name from tab_letter_head where is_default = true limit 1`
    if (def?.name) name = String(def.name)
  }
  if (!name) return null
  const [lh] = await sql`
    select header_html, footer_html from tab_letter_head where name = ${name}`
  if (!lh) return null
  return { header: String(lh.header_html ?? ''), footer: String(lh.footer_html ?? '') }
}

// PRN-003: resolve the document + chosen format and return a full HTML page.
export async function renderPrintHtml(
  doctype: string,
  name: string,
  user: string,
  format?: string,
  letterHead?: string,
): Promise<string> {
  const meta = await getMeta(doctype)
  const doc = (await getDoc(doctype, name, user)) as Doc

  let body: string
  if (format && format !== 'standard') {
    const [pf] = await sql`
      select template from tab_print_format where name = ${format} and doc_type = ${doctype}`
    body = pf ? interpolate(String(pf.template ?? ''), doc) : ''
  } else if (format === undefined) {
    const [def] = await sql`
      select template from tab_print_format
      where doc_type = ${doctype} and is_default = true limit 1`
    body = def ? interpolate(String(def.template ?? ''), doc) : autoLayout(meta, doc)
  } else {
    body = autoLayout(meta, doc)
  }

  const lh = await resolveLetterHead(doctype, format, letterHead)
  const header = lh?.header
    ? `<header class="letter-head">${interpolate(lh.header, doc)}</header>`
    : ''
  const footer = lh?.footer
    ? `<footer class="letter-foot">${interpolate(lh.footer, doc)}</footer>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,system-ui,sans-serif;color:#1c2126;padding:32px;font-size:13px}
    h1{font-size:22px;margin:0 0 2px} .docname{color:#6c7680;font-size:12px;margin:0 0 16px}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:6px 32px}
    dt{font-size:10px;text-transform:uppercase;color:#6c7680} dd{margin:0 0 6px;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #d1d8dd;padding:4px 8px;text-align:left} th{background:#f7f7f8}
    .letter-head{border-bottom:2px solid #1c2126;padding-bottom:12px;margin-bottom:20px}
    .letter-foot{border-top:1px solid #d1d8dd;padding-top:12px;margin-top:24px;
      color:#6c7680;font-size:11px}
  </style></head><body>${header}${body}${footer}</body></html>`
}

function autoLayout(meta: Awaited<ReturnType<typeof getMeta>>, doc: Doc): string {
  const scalar = meta.fields.filter(
    (f) => !['Table', 'Section Break', 'Column Break'].includes(f.fieldtype) && !f.hidden,
  )
  const tables = meta.fields.filter((f) => f.fieldtype === 'Table' && !f.hidden)
  const rows = scalar
    .map((f) => `<dt>${esc(f.label ?? f.fieldname)}</dt><dd>${fmt(doc[f.fieldname])}</dd>`)
    .join('')
  const tableHtml = tables
    .map((tf) => {
      const list = (doc[tf.fieldname] as Doc[] | undefined) ?? []
      const cols = list.length ? Object.keys(list[0]).filter((k) => !FRAMEWORK_CHILD_COLS.has(k)) : []
      const head = cols.map((c) => `<th>${esc(c)}</th>`).join('')
      const bodyRows = list
        .map((r) => `<tr>${cols.map((c) => `<td>${fmt(r[c])}</td>`).join('')}</tr>`)
        .join('')
      return `<h2>${esc(tf.label ?? tf.fieldname)}</h2><table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>`
    })
    .join('')
  return `<h1>${esc(meta.name)}</h1><p class="docname">${esc(String(doc.name))}</p><dl>${rows}</dl>${tableHtml}`
}

// Resolve the Chromium binary. This environment installs browsers under
// /opt/pw-browsers but does not always export PLAYWRIGHT_BROWSERS_PATH to
// the server process, so locate the chrome binary directly.
function resolveChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH))
    return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  try {
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const d of dirs) {
      const bin = join(root, d, 'chrome-linux', 'chrome')
      if (existsSync(bin)) return bin
    }
  } catch {
    // fall through — let Playwright try its own resolution
  }
  return undefined
}

// Chromium is launched lazily and reused across requests.
let browserPromise: Promise<import('playwright').Browser> | null = null
export async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import('playwright')
    const bin = resolveChromium()
    browserPromise = chromium.launch(bin ? { executablePath: bin } : {})
  }
  return browserPromise
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    return await page.pdf({ format: 'A4', printBackground: true })
  } finally {
    await page.close()
  }
}
