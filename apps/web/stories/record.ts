// Records what the real server answers for a screen, so its story replays the
// same data without a server (MSW). Run against a dev instance (./init.sh):
//
//   pnpm --filter web exec tsx stories/record.ts
//
// It seeds the tables a story needs through the API, opens the screen as the
// Administrator in a headless browser, and writes every /api answer to
// stories/recordings/<name>.json. Re-run it when a screen's API changes.
import { chromium, request as apiRequest } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tableSlug } from 'shared'

const BASE = process.env.WEB_URL ?? 'http://localhost:5173'
const ADMIN = { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }
const CHROMIUM = process.env.CHROMIUM_PATH

export interface Recording {
  url: string
  /** method + path + query → status and JSON body, in the order first seen. */
  answers: { method: string; path: string; status: number; body: unknown }[]
}

// The same two tables list-one-line.spec.ts seeds: a wide list linking to a cluster.
const TARGET = 'Story One Line Cluster'
const WIDE = 'Story One Line Wide'
const EXTRA = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']
const LONG_NOTE = 'The site sits beside the old canal road and takes deliveries at the north gate before nine in the morning, while the south gate is kept for staff. '.repeat(4).trim()

async function seed() {
  const ctx = await apiRequest.newContext({ baseURL: BASE })
  const login = await ctx.post('/api/login', { data: ADMIN })
  const { token } = (await login.json()) as { token: string }
  const headers = { Authorization: `Bearer ${token}` }
  const def = async (body: Record<string, unknown>) => {
    const res = await ctx.post('/api/table_def', { headers, data: body })
    if (!res.ok() && !/exists/i.test(await res.text())) throw new Error(`table ${String(body.name)}: ${res.status()}`)
  }
  const row = async (table: string, row: Record<string, unknown>) => {
    const res = await ctx.post('/api/save_row', { headers, data: { table, row } })
    if (!res.ok() && !/exists/i.test(await res.text())) throw new Error(`row in ${table}: ${res.status()} ${await res.text()}`)
  }
  await def({ name: TARGET, id_pattern: 'prompt', title_column: 'cluster_name', columns: [{ column_name: 'cluster_name', column_type: 'Data', label: 'Cluster name', in_list_view: true }] })
  await row(TARGET, { row_id: 'C1', cluster_name: 'The Northern Coastal Cluster' })
  await def({
    name: WIDE,
    title_column: 'site_name',
    columns: [
      { column_name: 'site_name', column_type: 'Data', label: 'Name', in_list_view: true },
      { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Tamil Nadu\nAndhra Pradesh', in_list_view: true },
      { column_name: 'cluster', column_type: 'Reference', reference_table: TARGET, label: 'Cluster', in_list_view: true },
      { column_name: 'area', column_type: 'Data', label: 'Area', in_list_view: true },
      { column_name: 'note', column_type: 'Long Text', label: 'Note', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'A very long column label that must not make the header row any taller than one line', in_list_view: true },
      ...EXTRA.map((c) => ({ column_name: c, column_type: 'Int', label: `Column ${c}`, in_list_view: true })),
    ],
  })
  const existing = (await (await ctx.get(`/api/table/${encodeURIComponent(WIDE)}?limit_page_length=1`, { headers })).json()) as { data: unknown[] }
  if (!existing.data.length)
    for (let i = 0; i < 3; i++)
      await row(WIDE, {
        site_name: `Site ${i}`,
        state: i % 2 ? 'Andhra Pradesh' : 'Tamil Nadu',
        cluster: 'C1',
        area: 'Tamil Nadu',
        note: i === 0 ? LONG_NOTE : i === 1 ? 'first line\nsecond line\nthird line' : 'short',
        qty: i,
        ...Object.fromEntries(EXTRA.map((c) => [c, 1000 + i])),
      })
  await ctx.dispose()
}

async function record(name: string, url: string, settle: (page: import('@playwright/test').Page) => Promise<void>) {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${BASE}/featherbase/login?next=${encodeURIComponent(url)}`)
  await page.getByLabel('Email or username').fill(ADMIN.usr)
  await page.getByLabel('Password').fill(ADMIN.pwd)
  const answers: Recording['answers'] = []
  page.on('response', async (res) => {
    const u = new URL(res.url())
    if (!u.pathname.startsWith('/api/') || u.pathname === '/api/login') return
    const body = await res.json().catch(() => undefined)
    if (body !== undefined) answers.push({ method: res.request().method(), path: u.pathname + u.search, status: res.status(), body })
  })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((u) => u.pathname === url.split('?')[0])
  await settle(page)
  await page.waitForLoadState('networkidle')
  const out = fileURLToPath(new URL(`./recordings/${name}.json`, import.meta.url))
  writeFileSync(out, JSON.stringify({ url, answers } satisfies Recording, null, 1) + '\n')
  console.log(`recorded ${answers.length} answers for ${url} → stories/recordings/${name}.json`)
  await browser.close()
}

await seed()
await record('wide-list', `/featherbase/admin/table/${tableSlug(WIDE)}`, async (page) => {
  await page.getByTestId('list-total').filter({ hasText: '3 total' }).waitFor()
  // The link filter's values and the Compact layout are part of the screen's story.
  await page.getByRole('group', { name: 'List layout' }).getByRole('button', { name: 'Compact' }).click()
  await page.getByRole('group', { name: 'List layout' }).getByRole('button', { name: 'Table' }).click()
})
