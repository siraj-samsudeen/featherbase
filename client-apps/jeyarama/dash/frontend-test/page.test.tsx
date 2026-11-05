// Public page tests: every fetch dispatches to the real Hono server
// inside the shared SQLSandbox. No canned report, API or database responses.
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { app } from '../../../../apps/server/src/index'
import { test as sandboxed, isTestDatabaseOpen } from '../../../../apps/server/test/pg-test-shared'
import { sql } from '../../../../apps/server/src/db'
import { withNamedVariable } from '../../../../apps/server/src/env'
import { setupDash } from './dash'

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => {
  window: Window & typeof globalThis; reconfigure(options: { url: string }): void
} }
const inFlight = new Set<Promise<unknown>>()
const requests: { path: string; status: number }[] = []
let requestTail: Promise<unknown> = Promise.resolve()
let token: string | null | undefined
let delayedResponse: { path: string; untilReleased: Promise<void>; release(): void } | undefined
let root: Root | undefined
let dom: InstanceType<typeof JSDOM>
const originals = new Map<string, PropertyDescriptor | undefined>()

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/feather_dash/' })
  const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, history: dom.window.history,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string, init?: RequestInit) => {
      if (!isTestDatabaseOpen()) throw new Error('Dash fetch outside SQLSandbox refused')
      if (!input.startsWith('/api/')) throw new Error(`Unexpected external fetch: ${input}`)
      const headers = new Headers(init?.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      // One sandbox connection cannot interleave independent request savepoints.
      // Queue real requests; do not replace either the API or its SQL results.
      const work = requestTail.then(() => app.request(input, { ...init, headers }))
      requestTail = work.catch(() => {})
      inFlight.add(work)
      try {
        const response = await work
        requests.push({ path: input, status: response.status })
        // Delay delivery of an already-produced real response, not its body,
        // for navigation and sign-out races between separate HTTP requests.
        if (delayedResponse?.path === input) await delayedResponse.untilReleased
        return response
      } finally { inFlight.delete(work) }
    },
  }
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})
afterAll(() => {
  for (const [key, original] of originals)
    if (original) Object.defineProperty(globalThis, key, original)
    else Reflect.deleteProperty(globalThis, key)
  dom.window.close()
})

const test = sandboxed.extend<{ browser: void }>({
  browser: [async ({ db: _db }, use) => {
    token = undefined
    requests.length = 0
    dom.reconfigure({ url: 'http://localhost/feather_dash/' })
    history.replaceState(null, '', '/feather_dash/')
    document.body.innerHTML = '<div id="root"></div>'
    await use()
    await act(async () => root?.unmount())
    root = undefined
    delayedResponse?.release()
    delayedResponse = undefined
    while (inFlight.size) await Promise.all([...inFlight])
  }, { auto: true }],
})

const installed = test.extend<{ dash: Awaited<ReturnType<typeof setupDash>> }>({
  dash: async ({ admin, createUser, browser: _browser }, use) => {
    const dash = await setupDash(admin, createUser)
    token = dash.reader.token
    history.replaceState(null, '', '/feather_dash/?store=9901')
    await use(dash)
  },
})

async function open() {
  // Mount the public page; main.tsx stays in the denominator even though this
  // component harness owns the root so it can unmount before sandbox rollback.
  const { createRoot } = await import('react-dom/client')
  const { FeatherDash } = await import('../src/app')
  root = createRoot(document.getElementById('root')!)
  await act(async () => root!.render(<FeatherDash />))
}

async function waitForText(text: string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!document.body.textContent?.includes(text) && Date.now() < deadline)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(document.body.textContent).toContain(text)
}

/** The cached table is on show (#950: it has no title of its own to wait for). */
async function waitForQuickView(timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!document.querySelector('[data-testid=quick-view]') && Date.now() < deadline)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(document.querySelector('[data-testid=quick-view]')).not.toBeNull()
}

describe('Feather Dash against the real platform', () => {
  test('offers a sign-in link preserving the report address after the server refuses anonymous reads', async () => {
    history.replaceState(null, '', '/feather_dash/?store=9901')
    await open()
    await waitForText('Sign in to open your report.')
    expect(document.querySelector('[data-testid=signed-out] a')?.getAttribute('href')).toBe('/featherbase/login?next=%2Ffeather_dash%2F%3Fstore%3D9901')
    expect(requests.filter(r => r.path.includes('/app_reads/')).every(r => r.status === 401)).toBe(true)
    expect(requests.length).toBeGreaterThanOrEqual(3)
  })

  test('gives an instance manager with no store the health link and local setup command', async ({ admin }) => {
    token = admin.token
    await open()
    await waitForText('your account covers no store')
    expect(document.querySelector('[data-testid=manager-no-store] a')?.getAttribute('href')).toBe('/featherbase/admin/instance-health')
    expect(document.querySelector('code')?.textContent).toBe('pnpm dev jeyarama/dash --made-up-data')
    expect([...requests].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: '/api/app_reads/feather_dash/embed_session', status: 403 },
      { path: '/api/app_reads/feather_dash/report', status: 403 },
      { path: '/api/instance-health', status: 200 },
      { path: '/api/whoami', status: 200 },
    ])
  })

  for (const path of ['/api/whoami', '/api/instance-health']) {
    test(`access guidance waits for the real ${path} response and leaving keeps the page empty`, async ({ admin }) => {
      token = admin.token
      let release!: () => void
      delayedResponse = { path, untilReleased: new Promise<void>(resolve => { release = resolve }), release: () => release() }
      await open()
      const deadline = Date.now() + 5000
      while (!requests.some(r => r.path === path) && Date.now() < deadline)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(requests.find(r => r.path === path)?.status).toBe(200)
      expect(document.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('no_access')
      expect(document.body.textContent).toContain('Opening your report…')
      expect(document.querySelector('[data-testid=feather-dash] a')).toBeNull()
      await act(async () => root!.unmount())
      root = undefined
      await act(async () => {
        release()
        await expect.poll(() => requests.find(r => r.path === '/api/instance-health')?.status).toBe(200)
        while (inFlight.size) await Promise.all([...inFlight])
      })
      // This is the public loading/leaving contract, not guard-specific
      // proof: React also ignores state updates on an unmounted root.
      expect(document.getElementById('root')?.childElementCount).toBe(0)
      expect(requests.find(r => r.path === '/api/instance-health')?.status).toBe(200)
      expect(requests.filter(r => r.path === '/api/whoami')).toHaveLength(1)
      expect(requests.filter(r => r.path === '/api/instance-health')).toHaveLength(1)
    })
  }

  test('a real sign-out between manager identity and health fails closed without inventing missing setup', async ({ admin }) => {
    token = admin.token
    let release!: () => void
    delayedResponse = { path: '/api/whoami', untilReleased: new Promise<void>(resolve => { release = resolve }), release: () => release() }
    const { accessFacts } = await import('../src/api')
    const facts = accessFacts()
    await expect.poll(() => requests.find(r => r.path === '/api/whoami')?.status).toBe(200)
    // whoami really authenticated this session. Sign out through the public
    // server route before delivering that response and asking for health.
    const signedOut = await admin.fetch('/api/logout', { method: 'POST' })
    expect(signedOut.status).toBe(200)
    expect(await signedOut.json()).toEqual({ ok: true })
    release()
    expect(await facts).toEqual({ manages: true, missing: undefined, fix: null })
    expect(requests).toEqual([
      { path: '/api/whoami', status: 200 },
      { path: '/api/instance-health', status: 401 },
    ])
  })

  test('tells an ordinary signed-in reader to ask their Store Manager without exposing instance health', async ({ createUser }) => {
    token = (await createUser({ email: 'dash-ui-reader@example.test' })).token
    await open()
    await waitForText('Ask your Store Manager')
    expect(document.querySelector('[data-testid=feather-dash] a')).toBeNull()
    expect(requests.map(r => r.path).sort()).toEqual([
      '/api/app_reads/feather_dash/embed_session', '/api/app_reads/feather_dash/report', '/api/whoami',
    ])
  })

  installed('renders real cached sales with exact totals and lets the reader reveal and hide quiet subcategories', async ({ dash: _dash }) => {
    await open()
    await waitForQuickView()
    expect(document.body.textContent).toContain('Silk')
    expect(document.body.textContent).not.toContain('Quiet cotton')
    expect(document.querySelector('tfoot')?.textContent).toContain('₹1,000')
    const toggle = document.querySelector('[data-testid=toggle-quiet]') as HTMLButtonElement
    await act(async () => toggle.click())
    expect(document.body.textContent).toContain('Quiet cotton')
    expect(toggle.textContent).toBe('Hide 1 with no target and no sales')
    await act(async () => toggle.click())
    expect(document.body.textContent).not.toContain('Quiet cotton')

    // Repeated bar choices and history addresses must not reset a loaded
    // report; unrelated/malformed events and foreign frame messages do nothing.
    const count = requests.length
    await act(async () => {
      for (const detail of [undefined, { key: 'other', value: '9902' }, { key: 'store', value: '' }, { key: 'store', value: '9901' }])
        window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail }))
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
      history.replaceState(null, '', '/feather_dash/')
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
      window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://untrusted.example', data: { type: 'feather-dash:dive-ready' } }))
      window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://embed-motherduck.com', data: { type: 'feather-dash:dive-ready' } }))
    })
    expect(requests.length).toBe(count)
    expect(document.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('quick')

    // An actual deployment-input failure, not a synthetic API rejection:
    // remove the app's required secret, reload, then repair it and retry.
    await act(async () => root!.unmount())
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await open()
      await waitForText("Your report couldn't load.")
      expect(requests.slice(-2).map(r => r.status)).toEqual([409, 409])
    })
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click())
    await waitForQuickView()
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
  })

  for (const state of ['not_built', 'no_data_yet', 'unconfirmed', 'no_sections'] as const) {
    installed(`explains ${state} without presenting missing figures as zero`, async ({ dash }) => {
      if (state === 'not_built')
        await sql`update dataset_snapshot set state = 'superseded' where dataset = 'feather_dash.sales_to_date'`
      if (state === 'no_data_yet') await dash.snapshot([dash.fact('010101001', { period_start: '2020-01-01', data_through: '2020-01-15' })])
      if (state === 'unconfirmed') {
        await dash.snapshot([])
        await dash.snapshot([], 'sales_month')
      }
      if (state === 'no_sections') {
        await dash.save('store_rollout', { store: '9902', live_since: '2026-01-01' })
        await dash.save('job_assignment', { person: dash.reader.user, job: 'Store Manager', store: '9902', starts_on: '2026-01-01' })
        await dash.snapshot([dash.fact('010101001', { store_code: '9902' })])
        history.replaceState(null, '', '/feather_dash/?store=9902')
      }
      await open()
      const text = state === 'no_data_yet' ? "This month's figures haven't arrived yet."
        : state === 'no_sections' ? 'This store has no sections set up yet'
        : 'The figures are being prepared.'
      await waitForText(text)
      expect(document.querySelector('table')).toBeNull()
      expect(document.querySelector('[data-testid=report-heading]')?.textContent).toContain('Sales before tax, net of returns')
      expect(document.body.textContent).not.toContain('₹0')
    })
  }

  for (const example of [
    { name: 'sales without a recorded target', values: { target: null, actual: 100 }, cells: ['—', '₹100.00', '—', '—'], total: 'Total—₹100.00——' },
    { name: 'a target without recorded sales', values: { target: 100, actual: null, days_with_actual: 0 }, cells: ['₹100.00', '—', '—', '—'], total: 'Total₹100.00———' },
    { name: 'a positive gap with Indian grouping and paise', values: { target: 1234567.5, actual: 1235000 }, cells: ['₹12,34,567.50', '₹12,35,000.00', '+₹432.50', '100%'], total: 'Total₹12,34,567.50₹12,35,000.00+₹432.50100%' },
    { name: 'sales while monthly targets are unavailable', values: { target: 100, actual: 80, targets_available: false }, cells: ['—', '₹80.00', '—', '—'], total: 'Total—₹80.00——' },
  ]) {
    installed(`distinguishes ${example.name} in the row and exact total`, async ({ dash }) => {
      await dash.snapshot([dash.fact('010101001', example.values)])
      await open()
      await waitForQuickView()
      const row = [...document.querySelectorAll('tbody tr')].find(r => r.querySelector('th')?.textContent === 'Silk')!
      expect([...row.querySelectorAll('td')].map(c => c.textContent)).toEqual(example.cells)
      expect(document.querySelector('tfoot')?.textContent).toBe(example.total)
      if (example.values.targets_available === false)
        expect(document.body.textContent).toContain("Targets for this month aren't available yet; sales are shown.")
      if (example.cells.includes('—')) expect(document.querySelector('[data-testid=blank-note]')?.textContent)
        .toContain(example.values.targets_available === false ? '3 subcategories have' : '1 subcategory has')
    })
  }

  installed('shows an all-quiet section as nothing recorded until Show is clicked, including unnamed rows', async ({ dash }) => {
    await dash.snapshot([dash.fact('010101001', { target: 0, actual: 0 })])
    await open()
    await waitForText('Nothing recorded this month for your section yet.')
    expect(document.querySelector('table')).toBeNull()
    const button = document.querySelector('[data-testid=toggle-quiet]') as HTMLButtonElement
    expect(button.textContent).toBe('Show 3 with no target and no sales')
    await act(async () => button.click())
    expect(document.querySelector('table')?.textContent).toContain('Unnamed subcategory')
    expect(document.querySelector('[data-testid=blank-note]')?.textContent).toContain('2 subcategories have')
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹0.00₹0.00₹0.00—')
  })

  installed('includes unplaced sales under No section with their own subtotal', async ({ dash }) => {
    await dash.snapshot([...dash.facts, dash.fact('010909009', { subcategory: 'Unplaced silk', target: 50, actual: 80 })])
    await open()
    await waitForQuickView()
    const group = [...document.querySelectorAll('tbody')].find(body => body.textContent?.includes('Unplaced silk'))!
    expect(group.querySelector('[scope=rowgroup]')?.textContent).toBe('No section')
    expect(group.querySelector('.fd-subtotal')?.textContent).toBe('No\u00a0section total₹50.00₹80.00+₹30.00160%')
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,050.00₹980.00−₹70.0093.3%')
  })

  for (const example of [
    { job: 'Team Leader', acting: false, sentence: 'You see Sarees at LKS because you are their Team Leader.' },
    { job: 'Team Leader', acting: true, sentence: 'You see Sarees at LKS because you are their acting Team Leader.' },
    { job: 'Staff', acting: false, sentence: 'You see Sarees at LKS because you work in them.' },
    { job: 'Staff', acting: true, sentence: 'You see Sarees at LKS because you work in them.' },
  ]) {
    installed(`names a ${example.acting ? 'temporary ' : ''}${example.job}'s section and reason without a store code`, async ({ dash, createUser }) => {
      const person = await createUser({ email: 'dash-section-reader@example.test', roles: ['Feather Dash Reader'] })
      await dash.save('job_assignment', { person: person.user, job: example.job, acting: example.acting,
        store: '9901', section: dash.section.row_id, starts_on: '2026-01-01' })
      token = person.token
      await open()
      await waitForQuickView()
      expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('LKS · Sarees')
      expect(document.querySelector('[data-testid=why-line]')?.textContent).toBe(example.sentence)
      expect(document.body.textContent).not.toMatch(/9901|010101001/)
    })
  }

  installed('lists combined leadership and staff reasons in title order for the same reader', async ({ dash }) => {
    await dash.save('job_assignment', { person: dash.reader.user, job: 'Cluster Manager', cluster: 'DEMO-NORTH', store: '9901', starts_on: '2026-01-01' })
    await dash.save('job_assignment', { person: dash.reader.user, job: 'Team Leader', store: '9901', section: dash.section.row_id, starts_on: '2026-01-01' })
    await dash.save('job_assignment', { person: dash.reader.user, job: 'Staff', store: '9901', section: dash.section.row_id, starts_on: '2026-01-01' })
    await open()
    await waitForQuickView()
    expect(document.querySelector('[data-testid=why-line]')?.textContent)
      .toBe('You see LKS because you are its Store Manager, Cluster Manager and Team Leader of Sarees and work in Sarees.')
  })

  installed('a slow real database offers store-check retry without ever reading the unchecked store', async ({ dash: _dash }) => {
    // Occupy the real sandbox connection, rather than mocking stores or
    // manufacturing a rejected promise. Its queued HTTP read must still finish.
    const busy = sql`select pg_sleep(11)`.execute()
    await open()
    await waitForText("Your report couldn't load.", 12000)
    expect(requests).toEqual([])
    expect(document.querySelector('table')).toBeNull()
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click())
    await act(async () => { await busy })
    await waitForQuickView()
    expect(requests.filter(r => r.path.endsWith('/stores'))).toHaveLength(2)
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
  }, 25000)

  installed('leaving while a real address check is pending prevents a late refusal from starting report reads', async ({ dash: _dash, createUser }) => {
    token = (await createUser({ email: 'dash-leaving-no-role@example.test' })).token
    const busy = sql`select pg_sleep(0.3)`.execute()
    await open()
    expect(requests).toEqual([])
    await act(async () => root!.unmount())
    root = undefined
    await act(async () => {
      await busy
      while (inFlight.size) await Promise.all([...inFlight])
    })
    expect(requests).toEqual([{ path: '/api/app_reads/feather_dash/stores', status: 403 }])
    expect(document.getElementById('root')?.childElementCount).toBe(0)
  })

  installed('explains missing instance setup to a manager, not a reader access problem', async ({ dash: _dash, admin }) => {
    token = admin.token
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await open()
      await waitForText("Dash isn't set up on this instance yet")
      expect(document.querySelector('[data-testid=setup-missing]')?.textContent).toContain('secret MOTHERDUCK_TOKEN')
      expect(document.body.textContent).toContain('Set each setting in the instance settings file')
      expect(document.querySelector('[data-testid=next-command]')?.textContent).toBe('pnpm dev jeyarama/dash --made-up-data')
      expect(document.querySelector('[data-testid=not-set-up] a')?.getAttribute('href')).toBe('/featherbase/admin/instance-health')
    })
  })

  test('public access facts fail closed for an expired or absent session on the real server', async () => {
    const { accessFacts } = await import('../src/api')
    expect(await accessFacts()).toEqual({ manages: false })
    expect(requests).toEqual([{ path: '/api/whoami', status: 401 }])
  })

  installed('the public identity read uses the installed version and session without a payload override', async ({ dash }) => {
    const { read } = await import('../src/api')
    expect(await read('me')).toEqual({ user: dash.reader.user })
    expect(requests).toEqual([{ path: '/api/app_reads/feather_dash/me', status: 200 }])
  })

  for (const count of [2, 3, 4]) {
    installed(`names ${count} covered sections in a staff reader's heading without widening to the whole store`, async ({ dash, createUser }) => {
      const person = await createUser({ email: 'dash-multiple-sections@example.test', roles: ['Feather Dash Reader'] })
      const names = ['Alpha', 'Beta', 'Gamma', 'Omega'].slice(0, count)
      const facts = []
      for (const [index, section_name] of names.entries()) {
        const section = await dash.save('section', { store: '9901', section_name })
        const subcategory = `02000000${index}`
        await dash.save('section_subcategory', { store: '9901', subcategory, section: section.row_id, starts_on: '2026-01-01' })
        await dash.save('job_assignment', { person: person.user, job: 'Staff', store: '9901', section: section.row_id, starts_on: '2026-01-01' })
        facts.push(dash.fact(subcategory, { subcategory: `${section_name} cloth` }))
      }
      await dash.snapshot(facts)
      token = person.token
      await open()
      await waitForQuickView()
      expect(document.querySelector('[data-testid=heading-title]')?.textContent)
        .toBe(count > 3 ? 'LKS · 4 sections' : `LKS · ${names.join(' · ')}`)
      expect(document.querySelector('[data-testid=why-line]')?.textContent)
        .toBe(`You see ${count === 2 ? 'Alpha and Beta' : count === 3 ? 'Alpha, Beta and Gamma' : '4 sections'} at LKS because you work in them.`)
      expect(document.querySelectorAll('tbody')).toHaveLength(count)
      expect(document.body.textContent).not.toContain('Sarees')
    })
  }

  installed('a reader with staff and team-lead jobs sees one ordered explanation for both sections', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-two-jobs@example.test', roles: ['Feather Dash Reader'] })
    const section = await dash.save('section', { store: '9901', section_name: 'Cotton' })
    await dash.save('section_subcategory', { store: '9901', subcategory: '020202002', section: section.row_id, starts_on: '2026-01-01' })
    await dash.save('job_assignment', { person: person.user, job: 'Staff', store: '9901', section: section.row_id, starts_on: '2026-01-01' })
    await dash.save('job_assignment', { person: person.user, job: 'Team Leader', store: '9901', section: dash.section.row_id, starts_on: '2026-01-01' })
    await dash.snapshot([...dash.facts, dash.fact('020202002', { subcategory: 'Cotton shirts' })])
    token = person.token
    await open()
    await waitForQuickView()
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('LKS · Cotton · Sarees')
    expect(document.querySelector('[data-testid=why-line]')?.textContent)
      .toBe('You see Cotton and Sarees at LKS because you are Team Leader of Sarees and work in Cotton.')
  })

  installed('legacy explicit assignments explain unplaced subcategories without claiming a section job', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-legacy-assigned@example.test', roles: ['Feather Dash Reader'] })
    await dash.save('Sales Target Assignment', { employee: person.user, plant_code: '9902', material_group: '020202002' })
    await dash.snapshot([dash.fact('020202002', { store_code: '9902', store_name: null, short_code: null, subcategory: 'Assigned cloth' })])
    await dash.snapshot([], 'sales_month')
    token = person.token
    history.replaceState(null, '', '/feather_dash/?store=9902')
    await open()
    await waitForQuickView()
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Your store')
    expect(document.querySelector('[data-testid=why-line]')?.textContent)
      .toBe('You see these subcategories at your store because they are assigned to you.')
    expect(document.querySelector('[scope=rowgroup]')?.textContent).toBe('No section')
    expect(document.body.textContent).toContain('Assigned cloth')
  })

  for (const signedIn of [true, false]) {
    installed(`a late ${signedIn ? 'successful' : 'refused'} address check never replaces a bar choice`, async ({ dash: _dash, createUser }) => {
      if (!signedIn) token = (await createUser({ email: 'dash-no-role@example.test' })).token
      const busy = sql`select pg_sleep(0.3)`.execute()
      await open()
      expect(requests).toEqual([])
      await act(async () => {
        window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9901' } }))
        await busy
      })
      await waitForText(signedIn ? 'Quick view' : 'Ask your Store Manager')
      expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
      expect(requests.filter(r => r.path.endsWith('/embed_session'))).toHaveLength(1)
      expect(requests.filter(r => r.path.endsWith('/stores'))).toHaveLength(1)
      if (signedIn) expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
      else {
        expect(document.querySelector('[data-testid=feather-dash] a')).toBeNull()
        expect(requests.filter(r => r.path.includes('/app_reads/')).map(r => r.status)).toEqual([403, 403, 403])
      }
    })
  }

  installed('a cached-read database deadline stays failed when late answers arrive, then Try again loads fresh totals', async ({ dash: _dash }) => {
    history.replaceState(null, '', '/feather_dash/')
    const busy = sql`select pg_sleep(16)`.execute()
    await open()
    await act(async () => window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9901' } })))
    await waitForText("Your report couldn't load.", 17000)
    expect(requests).toEqual([])
    await act(async () => {
      await busy
      while (inFlight.size) await Promise.all([...inFlight])
    })
    expect(requests.map(r => r.status)).toEqual([200, 200])
    expect(document.querySelector('[data-testid=feather-dash]')?.getAttribute('data-view')).toBe('failed')
    expect(document.querySelector('table')).toBeNull()
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click())
    await waitForQuickView()
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(2)
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
  }, 25000)

  for (const missing of [false, true]) {
    installed(`a hosted manager sees ${missing ? 'missing setup guidance' : 'no-store guidance'} without a local-machine command`, async ({ dash: _dash, admin }) => {
      token = admin.token
      dom.reconfigure({ url: 'https://dash.example.test/feather_dash/' })
      await withNamedVariable('MOTHERDUCK_TOKEN', missing ? undefined : 'made-up-local-ui-test-token', async () => {
        await open()
        await waitForText(missing ? "Dash isn't set up on this instance yet" : 'your account covers no store')
        expect(document.querySelector('code')).toBeNull()
        expect(document.body.textContent).not.toContain('this machine')
        expect(document.querySelector('[data-testid=feather-dash] a')?.getAttribute('href')).toBe('/featherbase/admin/instance-health')
      })
    })
  }

  installed('bar and history store changes replace old figures with the new store empty state and back again', async ({ dash }) => {
    await dash.save('store_rollout', { store: '9902', live_since: '2026-01-01' })
    await dash.save('job_assignment', { person: dash.reader.user, job: 'Store Manager', store: '9902', starts_on: '2026-01-01' })
    await open()
    await waitForQuickView()
    await act(async () => {
      history.pushState(null, '', '?store=9902')
      window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9902' } }))
    })
    await waitForText('This store has no sections set up yet')
    expect(document.querySelector('table')).toBeNull()
    expect(document.body.textContent).not.toContain('Silk')
    await act(async () => {
      history.replaceState(null, '', '?store=9901')
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    })
    await waitForQuickView()
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
  })

  installed('an address outside the real reader scope waits for correction, then opens only their default store', async ({ dash: _dash }) => {
    history.replaceState(null, '', '/feather_dash/?store=9909')
    await open()
    await waitForQuickView()
    expect(requests.filter(r => r.path.endsWith('/stores'))).toEqual([
      { path: '/api/app_reads/feather_dash/stores', status: 200 },
    ])
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('LKS · Sarees')
    expect(document.querySelector('tfoot')?.textContent).toBe('Total₹1,000.00₹900.00−₹100.0090%')
    expect(document.body.textContent).not.toContain('9909')
  })

  for (const role of ['staff', 'leader', 'manager']) {
    installed(`a legacy ${role} with explicit assignments sees both reasons without suggesting a new org-chart job`, async ({ dash, createUser }) => {
      const person = await createUser({ email: 'dash-legacy-combined@example.test', roles: ['Feather Dash Reader'] })
      // The real roster input, as in platform-test/provider.test.ts; this
      // identifier system is managed by roster sync rather than edited in Admin.
      await sql`insert into person_identifier (id, person_id, system, assigner, value, valid, verified, one_holder, source, recorded_by)
        values ('pid_dash_frontend_legacy', ${person.user}, 'stylehr-employee-code', 'firm-a', 'EMP-UI', daterange('2024-01-01', null, '[)'), true, true, 'test', 'test')`
      await dash.save('Sales Target Assignment', { employee: person.user, plant_code: '9902', material_group: '020202001' })
      await dash.save('Section Merchandise Map', { store_code: '9902', material_group: '020202002', mch_subcategory: 'Cotton shirts', section_name: 'Cotton' })
      if (role === 'staff') await dash.save('Employee Section Map', { store_code: '9902', employee_code: 'EMP-UI', subcategory: 'Cotton shirts' })
      if (role === 'leader') await dash.save('Section Ownership', { store_code: '9902', section_name: 'Cotton', tl_employee_code: 'EMP-UI' })
      if (role === 'manager') await dash.save('Store Manager', { store_code: '9902', employee_code: 'EMP-UI' })
      await dash.snapshot(['020202001', '020202002'].map(code => dash.fact(code, { store_code: '9902', subcategory: `Cloth ${code}` })))
      await dash.snapshot([], 'sales_month')
      token = person.token
      history.replaceState(null, '', '/feather_dash/?store=9902')
      await open()
      await waitForQuickView()
      expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('LKS · Cotton')
      expect(document.querySelector('[data-testid=why-line]')?.textContent).toBe(role === 'staff'
        ? 'You see Cotton at LKS because you work in Cotton and have other subcategories assigned to you.'
        : role === 'leader' ? 'You see Cotton at LKS because you are Team Leader of Cotton and have other subcategories assigned to you.'
        : 'You see LKS because you are its Store Manager and have other subcategories assigned to you.')
      expect(document.querySelector('tfoot')?.textContent).toBe('Total₹2,000.00₹1,600.00−₹400.0080%')
      expect(document.querySelectorAll('tbody')).toHaveLength(2)
    })
  }
})
