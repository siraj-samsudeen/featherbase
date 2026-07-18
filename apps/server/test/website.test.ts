import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { renderWebPage } from '../src/website'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// WEB-001: published Web Pages render publicly at /web/<route>; unpublished or
// missing routes 404, and no session is required.

async function makePage(admin: TestClient, doc: Record<string, unknown>) {
  await admin.post('/api/save_doc', { doctype: 'Web Page', doc })
}

// Each test creates its pages inside its own sandbox transaction.
async function setup(admin: TestClient) {
  await makePage(admin, {
    name: 'srv-pub-pg',
    title: 'Public',
    route: 'srv-pub',
    content: '<h1>Hello Public</h1>',
    published: true,
  })
  await makePage(admin, {
    name: 'srv-draft-pg',
    title: 'Draft',
    route: 'srv-draft',
    content: '<h1>Secret</h1>',
    published: false,
  })
}

describe('WEB-001: web pages', () => {
  test('renders a published page with its content and title', async ({ admin }) => {
    await setup(admin)
    const page = await renderWebPage('srv-pub')
    expect(page.found).toBe(true)
    expect(page.html).toContain('<title>Public</title>')
    expect(page.html).toContain('<h1>Hello Public</h1>')
  })

  test('does not render an unpublished page', async ({ admin }) => {
    await setup(admin)
    const page = await renderWebPage('srv-draft')
    expect(page.found).toBe(false)
    expect(page.html).not.toContain('Secret')
  })

  test('serves published pages over HTTP with NO session (200) and 404s others', async ({
    admin,
    api,
  }) => {
    await setup(admin)
    const pub = await api.fetch('/web/srv-pub')
    expect(pub.status).toBe(200)
    expect(pub.headers.get('content-type')).toContain('text/html')
    expect(await pub.text()).toContain('Hello Public')

    expect((await api.fetch('/web/srv-draft')).status).toBe(404)
    expect((await api.fetch('/web/does-not-exist')).status).toBe(404)
  })

  test('escapes the title but renders authored HTML content', async ({ admin }) => {
    await setup(admin)
    await sql`delete from tab_web_page where route = 'srv-pub'`
    await makePage(admin, {
      name: 'srv-pub-pg2',
      title: 'A & B <x>',
      route: 'srv-pub',
      content: '<p class="c">ok</p>',
      published: true,
    })
    const page = await renderWebPage('srv-pub')
    expect(page.html).toContain('A &amp; B &lt;x&gt;')
    expect(page.html).toContain('<p class="c">ok</p>')
  })
})
