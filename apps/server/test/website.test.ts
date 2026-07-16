import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { renderWebPage } from '../src/website'
import { areq } from './helpers'

// WEB-001: published Web Pages render publicly at /web/<route>; unpublished or
// missing routes 404, and no session is required.

async function cleanup() {
  await sql`delete from tab_web_page where route in ('srv-pub', 'srv-draft')`
}

async function makePage(doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Web Page', doc }),
  })
  if (res.status !== 201) throw new Error(`create web page: ${res.status} ${await res.text()}`)
}

beforeAll(async () => {
  await cleanup()
  await makePage({ name: 'srv-pub-pg', title: 'Public', route: 'srv-pub', content: '<h1>Hello Public</h1>', published: true })
  await makePage({ name: 'srv-draft-pg', title: 'Draft', route: 'srv-draft', content: '<h1>Secret</h1>', published: false })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('WEB-001: web pages', () => {
  it('renders a published page with its content and title', async () => {
    const page = await renderWebPage('srv-pub')
    expect(page.found).toBe(true)
    expect(page.html).toContain('<title>Public</title>')
    expect(page.html).toContain('<h1>Hello Public</h1>')
  })

  it('does not render an unpublished page', async () => {
    const page = await renderWebPage('srv-draft')
    expect(page.found).toBe(false)
    expect(page.html).not.toContain('Secret')
  })

  it('serves published pages over HTTP with NO session (200) and 404s others', async () => {
    const pub = await app.request('/web/srv-pub')
    expect(pub.status).toBe(200)
    expect(pub.headers.get('content-type')).toContain('text/html')
    expect(await pub.text()).toContain('Hello Public')

    expect((await app.request('/web/srv-draft')).status).toBe(404)
    expect((await app.request('/web/does-not-exist')).status).toBe(404)
  })

  it('escapes the title but renders authored HTML content', async () => {
    await sql`delete from tab_web_page where route = 'srv-pub'`
    await makePage({ name: 'srv-pub-pg2', title: 'A & B <x>', route: 'srv-pub', content: '<p class="c">ok</p>', published: true })
    const page = await renderWebPage('srv-pub')
    expect(page.html).toContain('A &amp; B &lt;x&gt;')
    expect(page.html).toContain('<p class="c">ok</p>')
  })
})
