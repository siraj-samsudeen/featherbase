// Every row of experiments/issue_3755/shared/acceptance.md (data-warehouse
// repo) bound to the running Featherbase host — candidate A of issue #3755.
//
// Mode (SALES_TARGET_EMBED):
//   live (default) — the API server posts to the real api.motherduck.com with
//     MOTHERDUCK_TOKEN from the environment and the page frames the real
//     embed-motherduck.com sandbox.
//   stub — the API server is pointed (MOTHERDUCK_API_BASE) at the in-process
//     stub from ./sales-target-stub.ts, whose "sandbox" page echoes the
//     initial_state it received and NEVER renders amounts. The page frames the
//     same stub (MOTHERDUCK_EMBED_ORIGIN). Proves the host contract only.
//
// Checks that need the real report skip with an explicit BLOCKED reason when
// no live embed session can be minted — a skip is reported, never a pass.
//
// Deliberate deep links: /sales-target and the embed route are visited
// directly without a session to prove they refuse an anonymous browser.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { anonymousTest as test, expect, adminAuth, type Page } from './fixtures'
import { startStub, type Stub } from './sales-target-stub'

const MODE = process.env.SALES_TARGET_EMBED === 'stub' ? 'stub' : 'live'
const SHARED_ENV =
  process.env.SALES_TARGET_SHARED_ENV ??
  '/home/user/data-warehouse/experiments/issue_3755/shared/.env.local'
const SHARED_DIR = path.dirname(SHARED_ENV)
const EVIDENCE = process.env.SALES_TARGET_EVIDENCE_DIR ?? path.resolve(SHARED_DIR, '../featherbase/evidence')
const TABLE = 'Sales Target Assignment'
const TABLE_URL = `/api/table/${encodeURIComponent(TABLE)}`

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2]
  }
  return out
}
// The shared inputs live in the sibling data-warehouse checkout and are never
// committed here. Without them there is nothing to seed or compare against, so
// the whole file skips with a reason instead of dying at collection (which took
// the rest of the e2e run down with it on CI).
const SHARED_AVAILABLE = ['assignments.json', 'baseline.csv'].every((f) => existsSync(path.join(SHARED_DIR, f))) && existsSync(SHARED_ENV)
test.skip(
  !SHARED_AVAILABLE,
  `shared experiment inputs not available at ${SHARED_DIR} — set SALES_TARGET_SHARED_ENV to data-warehouse experiments/issue_3755/shared/.env.local`,
)
const env = readEnvFile(SHARED_ENV)
const pw = (n: number) => env[`TEST_EMPLOYEE_${n}_PASSWORD`] ?? ''

interface AssignmentRecord {
  username: string
  display_name: string
  plant_code: string
  store_label: string
  material_groups: string[]
}
const assignments = SHARED_AVAILABLE ? (JSON.parse(readFileSync(path.join(SHARED_DIR, 'assignments.json'), 'utf8')) as AssignmentRecord[]) : []
const A = (n: number) => assignments.find((a) => a.username === `test_employee_${n}`)!

const csv = (name: string) =>
  SHARED_AVAILABLE ? readFileSync(path.join(SHARED_DIR, name), 'utf8').trim().split('\n').map((l) => l.split(',')).slice(1) : []
const baseline = csv('baseline.csv').map(([plant_code, material_group, subcategory, t, a, g, ach]) => ({
  plant_code, material_group, subcategory, mtd_target: +t, mtd_actual: +a, gap: +g, achievement_pct: +ach,
}))
const cell = (plant: string, code: string) => baseline.find((b) => b.plant_code === plant && b.material_group === code)!
const inr = (x: number) =>
  (x < 0 ? '-' : '') + '₹' + Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = (x: number) => Math.round(x * 100) / 100
const pct = (x: number) => `${x.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`
function expectedFor(plant: string, codes: string[]) {
  const rows = codes.map((c) => cell(plant, c))
  const t = r2(rows.reduce((s, r) => s + r.mtd_target, 0))
  const a = r2(rows.reduce((s, r) => s + r.mtd_actual, 0))
  return { rows, total: { target: t, actual: a, gap: r2(a - t), achievement: (100 * a) / t } }
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function login(page: Page, n: number, password = pw(n)) {
  await page.goto('/login')
  await page.fill('input[name=email]', `test_employee_${n}`)
  await page.fill('input[name=password]', password)
  await page.click('button[type=submit]')
}

type Outcome = { kind: 'frame' } | { kind: string; text: string }
async function embedOutcome(page: Page): Promise<Outcome> {
  const frame = page.locator('[data-testid="report-frame"]')
  const settled = page.locator(
    '[data-testid="embed-state"][data-state="no-assignment"], [data-testid="embed-state"][data-state="error"], [data-testid="embed-state"][data-state="not-configured"]',
  )
  await expect(frame.or(settled)).toBeAttached({ timeout: 60_000 })
  if (await frame.count()) return { kind: 'frame' }
  return { kind: (await settled.getAttribute('data-state')) ?? 'unknown', text: await settled.innerText() }
}

async function reportFrame(page: Page) {
  const handle = await page.locator('[data-testid="report-frame"]').elementHandle()
  const frame = (await handle!.contentFrame())!
  if (MODE === 'stub') return frame
  // Live: the Dive renders inside embed-motherduck.com's sandbox, possibly nested; find the frame with the Dive root.
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    for (const f of [frame, ...frame.childFrames(), ...frame.childFrames().flatMap((c) => c.childFrames())]) {
      try {
        if (await f.locator('[data-testid="dive-root"]').count()) return f
      } catch {
        /* frame navigating */
      }
    }
    await page.waitForTimeout(1000)
  }
  throw new Error('Dive root not found inside the embed frame')
}

interface StubState {
  dive_id: string
  username: string
  version: number
  initial_state: { plant_code: string; material_groups: string[]; period_start: string; period_end: string }
  changed?: boolean
}
type Frame = Awaited<ReturnType<typeof reportFrame>>
async function readStub(frame: Frame): Promise<StubState> {
  await frame.locator('[data-testid="stub-state"]').waitFor()
  return JSON.parse((await frame.locator('[data-testid="stub-state"]').textContent()) ?? '{}') as StubState
}

interface DiveRow { code: string; target: string; actual: string; gap: string; achievement: string }
interface Dive { rows: DiveRow[]; total: Omit<DiveRow, 'code'>; header: string }
async function readDive(frame: Frame): Promise<Dive> {
  await frame.locator('[data-testid="total"]').waitFor({ timeout: 120_000 })
  await frame.locator('[data-testid="period"]').filter({ hasText: 'Data through' }).waitFor({ timeout: 60_000 })
  const rows = await frame.locator('[data-testid="row"]').evaluateAll((trs) =>
    trs.map((tr) => {
      const c = (name: string) => tr.querySelector(`[data-col="${name}"]`)?.textContent ?? ''
      return { code: (tr as HTMLElement).dataset.code ?? '', target: c('target'), actual: c('actual'), gap: c('gap'), achievement: c('achievement') }
    }),
  )
  const total = await frame.locator('[data-testid="total"]').evaluate((tr) => {
    const c = (name: string) => tr.querySelector(`[data-col="${name}"]`)?.textContent ?? ''
    return { target: c('target'), actual: c('actual'), gap: c('gap'), achievement: c('achievement') }
  })
  return { rows, total, header: await frame.locator('[data-testid="header"]').innerText() }
}

// Codes the report was opened with, whatever the mode: stub → initial_state; live → the Dive's rendered rows.
async function openedCodes(page: Page) {
  const frame = await reportFrame(page)
  if (MODE === 'stub') {
    const s = await readStub(frame)
    return { plant: s.initial_state.plant_code, codes: s.initial_state.material_groups, stub: s, dive: undefined }
  }
  const d = await readDive(frame)
  return { plant: /\b(\d{4}) —/.exec(d.header)?.[1], codes: d.rows.map((r) => r.code), stub: undefined, dive: d }
}

function assertDiveMatchesBaseline(d: Dive, plant: string, codes: string[]) {
  const e = expectedFor(plant, codes)
  expect(d.rows.map((r) => r.code)).toEqual([...codes].sort())
  for (const b of e.rows) {
    const r = d.rows.find((x) => x.code === b.material_group)!
    expect(r.target).toBe(inr(b.mtd_target))
    expect(r.actual).toBe(inr(b.mtd_actual))
    expect(r.gap).toBe(inr(b.gap))
    expect(r.achievement).toBe(pct(b.achievement_pct))
  }
  expect(d.total.target).toBe(inr(e.total.target))
  expect(d.total.actual).toBe(inr(e.total.actual))
  expect(d.total.gap).toBe(inr(e.total.gap))
  expect(d.total.achievement).toBe(pct(e.total.achievement))
  expect(d.header).toContain('Data through 17-Sep-2026')
  expect(d.header).not.toContain('Store total')
}

// ── setup: seed through the public API; probe once whether a live session can be minted ─────────
let stub: Stub | undefined
// `status` is the host's answer; `upstream` is MotherDuck's, which is what the
// page shows the employee and what the skip reason must quote.
let live: { ok: boolean; status: number | null; upstream: number | null; error: string | null } = { ok: false, status: null, upstream: null, error: null }

test.beforeAll(async ({ request }, workerInfo) => {
  const baseURL = String(workerInfo.project.use.baseURL)
  if (MODE === 'stub') {
    const base = process.env.MOTHERDUCK_API_BASE
    if (!base) throw new Error('stub mode needs MOTHERDUCK_API_BASE=http://127.0.0.1:<port> (the API server must point at the stub)')
    stub = await startStub(Number(new URL(base).port))
  }
  mkdirSync(EVIDENCE, { recursive: true })
  // The seed is the same script an operator runs after ./init.sh; here it
  // targets whichever stack Playwright brought up (the web proxy carries /api).
  execFileSync('pnpm', ['--filter', 'server', 'seed:sales-target'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
    env: { ...process.env, SERVER_URL: baseURL },
    stdio: 'pipe',
  })
  const r = await request.post('/api/login', { data: { usr: 'test_employee_1', pwd: pw(1) } })
  expect(r.status()).toBe(200)
  const { token } = (await r.json()) as { token: string }
  const e = await request.post('/api/sales_target/embed_session', { headers: { Authorization: `Bearer ${token}` } })
  const body = (await e.json()) as { session?: string; error?: { message?: string; upstream_status?: number } }
  live = MODE === 'stub'
    ? { ok: false, status: e.status(), upstream: null, error: 'stub mode renders no amounts' }
    : { ok: e.status() === 200 && typeof body.session === 'string', status: e.status(), upstream: body.error?.upstream_status ?? null, error: body.error?.message ?? null }
  console.log(
    `[sales-target e2e] mode=${MODE} embed-session probe: HTTP ${e.status()}${body.session ? `, session length ${body.session.length}` : `, ${body.error?.message ?? JSON.stringify(body)}`}`,
  )
})
test.afterAll(async () => {
  await stub?.close()
})
const blockedReason = () =>
  `BLOCKED — needs a live embed session; ${MODE === 'stub' ? 'stub mode renders no amounts' : `host answered HTTP ${live.status} — ${live.error}`}`
const needsLive = () => test.skip(!live.ok, blockedReason())
const needsFrame = () => test.skip(!live.ok && MODE === 'live', blockedReason())

// ── 1. Local login ───────────────────────────────────────────────────────────
test.describe('1. Local login', () => {
  for (const n of [1, 2, 3, 4]) {
    test(`test_employee_${n} lands on /sales-target with no selector`, async ({ page }) => {
      await login(page, n)
      await expect(page).toHaveURL(/\/sales-target$/)
      const a = A(n)
      await expect(page.getByTestId('identity')).toHaveText(
        `${a.display_name} · ${a.plant_code} — ${a.store_label} · 01-Sep-2026 to 17-Sep-2026`,
      )
      expect(await page.locator('select').count()).toBe(0)
      const o = await embedOutcome(page)
      if (live.ok || MODE === 'stub') expect(o.kind).toBe('frame')
      else {
        expect(o.kind).toBe('error')
        const text = (o as { text: string }).text
        expect(text).toContain('Report unavailable')
        expect(text).toContain(`HTTP ${live.upstream}`) // the upstream refusal, verbatim — never a zero
        expect(text).not.toMatch(/₹/)
      }
    })
  }
  test('wrong password is refused and no report opens', async ({ page, request }) => {
    await login(page, 2, 'definitely-wrong')
    await expect(page.getByTestId('login-error')).toHaveText('Invalid login credentials')
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.locator('[data-testid="report-frame"]').count()).toBe(0)
    expect((await request.post('/api/sales_target/embed_session')).status()).toBe(401)
  })
  test('unauthenticated report page and embed-session requests are refused', async ({ page, request }) => {
    expect((await request.post('/api/sales_target/embed_session')).status()).toBe(401)
    expect((await request.get('/api/sales_target/me')).status()).toBe(401)
    await page.goto('/sales-target')
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.locator('[data-testid="report-frame"]').count()).toBe(0)
  })
})

// ── 2. Four initial reports ──────────────────────────────────────────────────
test.describe('2. Four initial reports', () => {
  for (const n of [1, 2, 3, 4]) {
    test(`test_employee_${n}: report opened with exactly the assigned store and codes`, async ({ page }) => {
      needsFrame()
      await login(page, n)
      const a = A(n)
      const o = await openedCodes(page)
      expect(o.plant).toBe(a.plant_code)
      expect([...o.codes].sort()).toEqual([...a.material_groups].sort())
      if (o.stub) {
        expect(o.stub.username).toBe(env.SERVICE_ACCOUNT)
        expect(o.stub.version).toBe(Number(env.DIVE_VERSION))
        expect(o.stub.dive_id).toBe(env.DIVE_ID)
        expect(o.stub.initial_state).toEqual({ plant_code: a.plant_code, material_groups: a.material_groups, period_start: '2026-09-01', period_end: '2026-09-17' })
      }
    })
    test(`test_employee_${n}: exact amounts equal baseline.csv`, async ({ page }) => {
      needsLive()
      await login(page, n)
      assertDiveMatchesBaseline(await readDive(await reportFrame(page)), A(n).plant_code, A(n).material_groups)
    })
  }
})

// ── 3. Store separation ──────────────────────────────────────────────────────
test.describe('3. Store separation', () => {
  test('the assignment Table holds exactly one employee per store–subcategory pair, and refuses a second', async ({ request }) => {
    const headers = await adminAuth(request)
    const rows = (await (
      await request.get(`${TABLE_URL}?fields=${encodeURIComponent('["employee","plant_code","material_group","store_subcategory"]')}&limit_page_length=100`, { headers })
    ).json()) as { data: { employee: string; plant_code: string; material_group: string; store_subcategory: string }[] }
    expect(rows.data).toHaveLength(8)
    expect(new Set(rows.data.map((r) => r.store_subcategory)).size).toBe(8)
    const codesOf = (u: string) => rows.data.filter((r) => r.employee === u).map((r) => r.material_group).sort()
    expect(codesOf('test_employee_1')).toEqual(codesOf('test_employee_3'))
    expect(codesOf('test_employee_2')).toEqual(codesOf('test_employee_4'))
    expect(A(1).plant_code).not.toBe(A(3).plant_code)
    const dup = await request.post('/api/save_row', {
      headers,
      data: { table: TABLE, row: { employee: 'test_employee_2', plant_code: '1501', material_group: '010101003' } },
    })
    expect(dup.status()).toBe(417)
  })
  test('Employees 1 and 3: same subcategory names, only their own store’s amounts', async ({ browser }) => {
    needsLive()
    const results: Record<number, Dive> = {}
    for (const n of [1, 3]) {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await login(page, n)
      results[n] = await readDive(await reportFrame(page))
      await ctx.close()
    }
    expect(results[1].rows.map((r) => r.code)).toEqual(results[3].rows.map((r) => r.code))
    expect(results[1].header).toContain('1501 — Attakulangara')
    expect(results[3].header).toContain('1515 — Kattakada')
    assertDiveMatchesBaseline(results[1], '1501', A(1).material_groups)
    assertDiveMatchesBaseline(results[3], '1515', A(3).material_groups)
    expect(results[1].total.target).not.toBe(results[3].total.target)
  })
})

// ── 4. Period and arithmetic ─────────────────────────────────────────────────
test.describe('4. Period and arithmetic', () => {
  test('17 daily source rows for 1501/010101001 sum to the baseline row (independent of the Dive)', () => {
    const daily = csv('daily_1501_010101001.csv')
    expect(daily).toHaveLength(17)
    expect(daily[0][0]).toBe('2026-09-01')
    expect(daily[16][0]).toBe('2026-09-17')
    const t = r2(daily.reduce((s, [, x]) => s + +x, 0))
    const a = r2(daily.reduce((s, [, , y]) => s + +y, 0))
    expect(t).toBe(cell('1501', '010101001').mtd_target)
    expect(a).toBe(cell('1501', '010101001').mtd_actual)
    expect(r2(a - t)).toBe(cell('1501', '010101001').gap)
  })
  test('illustrative table: total achievement is the ratio of sums (100%), not the mean of row percentages (105%)', () => {
    const rows = [{ target: 100000, actual: 90000 }, { target: 50000, actual: 60000 }]
    const t = rows.reduce((s, r) => s + r.target, 0)
    const a = rows.reduce((s, r) => s + r.actual, 0)
    expect(rows.map((r) => (100 * r.actual) / r.target)).toEqual([90, 120])
    expect((100 * a) / t).toBe(100)
    expect(rows.map((r) => r.actual - r.target)).toEqual([-10000, 10000])
  })
  test('the report shows the recomputed row and one shared cutoff for every row', async ({ page }) => {
    needsLive()
    await login(page, 1)
    const d = await readDive(await reportFrame(page))
    const r = d.rows.find((x) => x.code === '010101001')!
    expect(r.target).toBe(inr(644191.37))
    expect(r.actual).toBe(inr(487118.68))
    expect(r.gap).toBe(inr(-157072.69))
    expect(r.achievement).toBe('75.6%')
    expect(d.header).toContain('01-Sep-2026 to 17-Sep-2026 · Data through 17-Sep-2026')
    expect(d.total.achievement).toBe('76.7%') // ratio of sums; the mean of 75.6 and 77.5 would be 76.6
  })
})

// ── 5. Simultaneous viewers ──────────────────────────────────────────────────
test('5. Simultaneous viewers: changing Employee 1’s selection leaves Employee 3 unchanged', async ({ browser }) => {
  needsFrame()
  const c1 = await browser.newContext()
  const c3 = await browser.newContext()
  const p1 = await c1.newPage()
  const p3 = await c3.newPage()
  await login(p1, 1)
  await login(p3, 3)
  const f1 = await reportFrame(p1)
  const f3 = await reportFrame(p3)
  const src1 = await p1.locator('[data-testid="report-frame"]').getAttribute('src')
  const src3 = await p3.locator('[data-testid="report-frame"]').getAttribute('src')
  expect(src1).not.toBe(src3) // each viewer holds its own embed session
  if (MODE === 'stub') {
    const before3 = await readStub(f3)
    await f1.locator('[data-testid="stub-change"]').click()
    expect((await readStub(f1)).changed).toBe(true)
    expect(await readStub(f3)).toEqual(before3)
  } else {
    const before3 = await readDive(f3)
    await f1.locator('[data-testid="picker-toggle"]').click()
    await f1.locator('[data-testid="picker-filter"]').fill('010102001')
    await f1.locator('[data-testid="picker-option"][data-code="010102001"]').check()
    await expect(f1.locator('[data-testid="row"]')).toHaveCount(3)
    expect((await readDive(f1)).rows.map((r) => r.code)).toEqual(['010101001', '010101003', '010102001'])
    await p3.waitForTimeout(3000)
    const after3 = await readDive(f3)
    expect(after3.rows).toEqual(before3.rows)
    expect(after3.total).toEqual(before3.total)
  }
  await c1.close()
  await c3.close()
})

// ── 6. Shared-tablet login change ────────────────────────────────────────────
test('6. Shared tablet: Employee 1 → logout → Employee 2; refresh keeps 2; logout removes the report', async ({ page }) => {
  await login(page, 1)
  await expect(page.getByTestId('identity')).toContainText('Employee 1 · 1501 — ATK')
  await embedOutcome(page)
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, 2)
  await expect(page.getByTestId('identity')).toContainText('Employee 2 · 1501 — ATK')
  await expect(page.locator('body')).not.toContainText('Employee 1')
  if (live.ok || MODE === 'stub') {
    const o = await openedCodes(page)
    expect(o.plant).toBe('1501')
    expect([...o.codes].sort()).toEqual(['010102001', '010102002'])
  }
  await page.reload()
  await expect(page).toHaveURL(/\/sales-target$/)
  await expect(page.getByTestId('identity')).toContainText('Employee 2 · 1501 — ATK')
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.locator('[data-testid="report-frame"]').count()).toBe(0)
  await page.goto('/sales-target')
  await expect(page).toHaveURL(/\/login$/)
})

test('6b. Stale in-flight embed response after an account change is never rendered', async ({ page }) => {
  test.skip(MODE !== 'stub', 'needs the stub’s controllable delay')
  stub!.setDelay(4000)
  await login(page, 1) // Employee 1's embed request is now in flight for 4 s
  await expect(page.getByTestId('identity')).toContainText('Employee 1')
  await page.waitForTimeout(300)
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, 2)
  const o = await openedCodes(page)
  expect(o.plant).toBe('1501')
  expect([...o.codes].sort()).toEqual(['010102001', '010102002'])
  await page.waitForTimeout(4500)
  expect([...(await openedCodes(page)).codes].sort()).toEqual(['010102001', '010102002'])
  await expect(page.locator('body')).not.toContainText('010101001')
  expect(await page.locator('[data-testid="report-frame"]').count()).toBe(1)
})

// ── 7. Assignment transfer ───────────────────────────────────────────────────
test('7. Assignment transfer: 1501/010101003 moves from Employee 1 to Employee 2 via POST /api/save_row; 3 and 4 unchanged; restored', async ({ browser, request }) => {
  needsFrame()
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['store_subcategory', '=', '1501/010101003']]))
  const list = (await (await request.get(`${TABLE_URL}?filters=${filters}&fields=${encodeURIComponent('["row_id"]')}`, { headers })).json()) as { data: { row_id: string }[] }
  const rowId = list.data[0].row_id
  const move = async (to: string) => {
    const current = (await (await request.get(`${TABLE_URL}/${rowId}`, { headers })).json()) as { updated_at: string; employee: string }
    const res = await request.post('/api/save_row', { headers, data: { table: TABLE, row: { row_id: rowId, updated_at: current.updated_at, employee: to } } })
    expect(res.status()).toBe(201)
  }
  const openAs = async (n: number) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, n)
    const o = await openedCodes(page)
    await ctx.close()
    return o
  }
  try {
    await move('test_employee_2')
    const expectedCodes: Record<number, string[]> = { 1: ['010101001'], 2: ['010101003', '010102001', '010102002'], 3: A(3).material_groups, 4: A(4).material_groups }
    for (const n of [1, 2, 3, 4]) {
      const o = await openAs(n)
      expect(o.plant).toBe(A(n).plant_code)
      expect([...o.codes].sort()).toEqual(expectedCodes[n])
      if (o.dive) {
        assertDiveMatchesBaseline(o.dive, A(n).plant_code, expectedCodes[n])
        if (n === 1) { expect(o.dive.total.target).toBe(inr(644191.37)); expect(o.dive.total.actual).toBe(inr(487118.68)) }
        if (n === 2) { expect(o.dive.total.target).toBe(inr(1310160.22)); expect(o.dive.total.actual).toBe(inr(1009532.64)); expect(o.dive.total.achievement).toBe('77.1%') }
      }
    }
  } finally {
    await move('test_employee_1')
  }
  expect([...(await openAs(1)).codes].sort()).toEqual(['010101001', '010101003'])
  expect([...(await openAs(2)).codes].sort()).toEqual(['010102001', '010102002'])
})

// ── 9. Usable live report ────────────────────────────────────────────────────
test('9. Usable report at tablet and desktop sizes; captures contain no credential', async ({ browser }) => {
  const prefix = live.ok ? '' : `${MODE === 'stub' ? 'stub' : 'blocked'}_`
  const secrets = [process.env.MOTHERDUCK_TOKEN, env.SESSION_SECRET, pw(1), pw(2), pw(3), pw(4)].filter((s): s is string => Boolean(s))
  for (const [name, viewport] of [['tablet', { width: 800, height: 1100 }], ['desktop', { width: 1440, height: 900 }]] as const) {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    await page.goto('/login')
    await page.screenshot({ path: path.join(EVIDENCE, `${prefix}${name}_login.png`) })
    await login(page, 1)
    const o = await embedOutcome(page)
    if (live.ok) expect((await readDive(await reportFrame(page))).rows).toHaveLength(2)
    else if (MODE === 'stub') await readStub(await reportFrame(page))
    else expect(o.kind).toBe('error')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(EVIDENCE, `${prefix}${name}_employee_1.png`) })
    const text = await page.content()
    for (const s of secrets) expect(text).not.toContain(s)
    await ctx.close()
  }
})
