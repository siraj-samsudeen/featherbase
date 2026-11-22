// Public page tests: every fetch dispatches to the real Hono server
// inside the shared SQLSandbox. No canned report, API or database responses: the one stand-in is
// MotherDuck's embed API, the network boundary the server calls to open a Dive.
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { app } from '../../../../apps/server/src/index'
import { test as sandboxed, isTestDatabaseOpen } from '../../../../apps/server/test/pg-test-shared'
import { sql } from '../../../../apps/server/src/db'
import { withNamedVariable } from '../../../../apps/server/src/env'
import { tableRelation } from '../../../../apps/server/src/table-engine'
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
/** MotherDuck's embed API refuses every session while set. */
let motherDuckRefuses = false
/** A request to this path fails on the way, before any server answers (#1391). */
let failOnTheWay: string | undefined
let dom: InstanceType<typeof JSDOM>
const originals = new Map<string, PropertyDescriptor | undefined>()

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/dash/' })
  const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, history: dom.window.history,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string, init?: RequestInit) => {
      if (!isTestDatabaseOpen()) throw new Error('Dash fetch outside SQLSandbox refused')
      // The server opening a Dive: MotherDuck mints a made-up session, or refuses.
      if (String(input).startsWith('https://api.motherduck.com/'))
        return motherDuckRefuses ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ session: 'made-up-session' }), { status: 200 })
      if (!input.startsWith('/api/')) throw new Error(`Unexpected external fetch: ${input}`)
      if (input === failOnTheWay) throw new TypeError('Failed to fetch')
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
    motherDuckRefuses = false
    failOnTheWay = undefined
    requests.length = 0
    dom.reconfigure({ url: 'http://localhost/dash/' })
    history.replaceState(null, '', '/dash/')
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
    history.replaceState(null, '', '/dash/?store=9901')
    await use(dash)
  },
})

async function open() {
  // Mount the public page; main.tsx stays in the denominator even though this
  // component harness owns the root so it can unmount before sandbox rollback.
  const { createRoot } = await import('react-dom/client')
  const { Dash } = await import('../src/app')
  root = createRoot(document.getElementById('root')!)
  await act(async () => root!.render(<Dash />))
}

async function waitForText(text: string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!document.body.textContent?.includes(text) && Date.now() < deadline)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(document.body.textContent).toContain(text)
}

/** The report's Dive is on show. */
async function waitForDive(timeout = 5000) {
  const view = () => document.querySelector('[data-testid=dash]')?.getAttribute('data-view')
  const deadline = Date.now() + timeout
  while (view() !== 'dive' && Date.now() < deadline)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(view()).toBe('dive')
}

describe('Dash against the real platform', () => {
  test('offers a sign-in link preserving the report address after the server refuses anonymous reads', async () => {
    history.replaceState(null, '', '/dash/?store=9901')
    await open()
    await waitForText('Sign in to open your report.')
    expect(document.querySelector('[data-testid=signed-out] a')?.getAttribute('href')).toBe('/featherbase/login?next=%2Fdash%2F%3Fstore%3D9901')
    expect(requests.filter(r => r.path.includes('/app_reads/')).every(r => r.status === 401)).toBe(true)
    expect(requests.length).toBeGreaterThanOrEqual(3)
  })

  test('gives an instance manager with no store the health link and local setup command', async ({ admin }) => {
    token = admin.token
    await open()
    await waitForText('it has no report to show you')
    expect([...document.querySelectorAll('[data-testid=manager-no-store] a')].map(a => a.getAttribute('href'))).toEqual(['?view=access', '/featherbase/admin/instance-health'])
    expect(document.querySelector('code')?.textContent).toBe('pnpm dev jeyarama/dash --made-up-data')
    const once = (path: string) => requests.filter(r => r.path === path)
    expect(['/api/app_reads/dash/embed_session', '/api/app_reads/dash/report', '/api/instance-health', '/api/whoami'].map(path => once(path).map(r => r.status)))
      .toEqual([[403], [403], [200], [200]])
    // Nothing else reaches past the reads that say why.
    expect([...new Set(requests.map(r => r.path))].filter(path => /stores|months/.test(path))).toEqual([])
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
      expect(document.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('no_access')
      expect(document.body.textContent).toContain('Opening your report…')
      expect(document.querySelector('[data-testid=dash] a')).toBeNull()
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
    await waitForText("You don't have a report to open yet.")
    expect(document.querySelector('[data-testid=dash] a[href*=instance-health]')).toBeNull()
    expect([...new Set(requests.map(r => r.path))].sort()).toEqual([
      '/api/app_reads/dash/approvals', '/api/app_reads/dash/buyer_section_approvals', '/api/app_reads/dash/department_approvals', '/api/app_reads/dash/embed_session', '/api/app_reads/dash/holds_department_job', '/api/app_reads/dash/holds_master_data',
      '/api/app_reads/dash/manages_access', '/api/app_reads/dash/manages_area', '/api/app_reads/dash/manages_roles', '/api/app_reads/dash/reach_problem', '/api/app_reads/dash/report', '/api/app_reads/dash/reports', '/api/whoami',
    ])
  })

  installed("opens the reader's store's Dive under its heading, and writes the open to the Access Log (#1366)", async ({ dash }) => {
    await open()
    await waitForDive()
    expect(document.querySelector('[data-testid=report-frame]')?.getAttribute('src')).toBe('https://embed-motherduck.com/sandbox/#session=made-up-session')
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Lakeside · Sarees')
    expect(await sql`select ref_table from access_log where "user" = ${dash.reader.user} and operation = 'view_report'`).toEqual([{ ref_table: 'dash.embed_session' }])

    // Repeated bar choices and history addresses must not reset a loaded
    // report; unrelated/malformed events and foreign frame messages do nothing.
    const count = requests.length
    await act(async () => {
      for (const detail of [undefined, { key: 'other', value: '9902' }, { key: 'store', value: '' }, { key: 'store', value: '9901' }])
        window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail }))
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
      history.replaceState(null, '', '/dash/')
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
      window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://untrusted.example', data: { type: 'dash:dive-ready' } }))
      window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://embed-motherduck.com', data: { type: 'dash:dive-ready' } }))
    })
    expect(requests.length).toBe(count)
    expect(document.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('dive')

    // An actual deployment-input failure, not a synthetic API rejection:
    // remove the app's required secret, reload, then repair it and retry.
    await act(async () => root!.unmount())
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await open()
      await waitForText("This report couldn't open.")
      expect(requests.slice(-2).map(r => r.status)).toEqual([409, 409])
    })
    await act(async () => (document.querySelector('[data-testid=failed] button') as HTMLButtonElement).click())
    await waitForDive()
  })

  for (const example of [
    { job: 'Team Leader', acting: false, sentence: 'You see Sarees at Lakeside because you are their Team Leader.' },
    { job: 'Team Leader', acting: true, sentence: 'You see Sarees at Lakeside because you are their acting Team Leader.' },
    { job: 'Staff', acting: false, sentence: 'You see Sarees at Lakeside because you work in them.' },
    { job: 'Staff', acting: true, sentence: 'You see Sarees at Lakeside because you work in them.' },
  ]) {
    installed(`names a ${example.acting ? 'temporary ' : ''}${example.job}'s section and reason without a store code`, async ({ dash, createUser }) => {
      const person = await createUser({ email: 'dash-section-reader@example.test', roles: ['Dash Reader'] })
      await dash.job(person.user!, example.job, { acting: example.acting, section: dash.section.row_id })
      token = person.token
      await open()
      await waitForDive()
      expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Lakeside · Sarees')
      expect(document.querySelector('[data-testid=why-line]')?.textContent).toBe(example.sentence)
      expect(document.body.textContent).not.toMatch(/9901|010101001/)
    })
  }

  installed('lists combined leadership and staff reasons in title order for the same reader', async ({ dash }) => {
    await dash.save('Cluster', { code: 'NORTH', name: 'North' })
    const [site] = await sql`select updated_at from ${sql(await tableRelation('Site'))} where row_id = 'LKS'`
    await dash.save('Site', { row_id: 'LKS', updated_at: site.updated_at, cluster: 'NORTH' })
    await dash.job(dash.reader.user!, 'Store Manager')
    await dash.job(dash.reader.user!, 'Cluster Manager')
    await dash.job(dash.reader.user!, 'Staff', { section: dash.section.row_id })
    await open()
    await waitForDive()
    expect(document.querySelector('[data-testid=why-line]')?.textContent)
      .toBe('You see Lakeside because you are its Store Manager, Cluster Manager and Team Leader of Sarees and work in Sarees.')
  })

  /** The page has its reports, so it has started what the report on show needs. */
  async function reportsAnswered() {
    const deadline = Date.now() + 5000
    while (requests.filter(r => r.path.endsWith('/reports')).length < 2 && Date.now() < deadline)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }

  installed('a slow store check offers retry without ever reading the unchecked store', async ({ dash: _dash }) => {
    // The real read, its answer held past the check's deadline.
    let release!: () => void
    delayedResponse = { path: '/api/app_reads/dash/stores', untilReleased: new Promise<void>(resolve => { release = resolve }), release: () => release() }
    await open()
    await waitForText("Couldn't reach Dash. Check your connection, then Try Again.", 12000)
    expect(requests.filter(r => /\/(report|embed_session)$/.test(r.path))).toEqual([])
    expect(document.querySelector('table')).toBeNull()
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click())
    await act(async () => { release() })
    await waitForDive()
    expect(requests.filter(r => r.path.endsWith('/stores'))).toHaveLength(2)
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
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
    expect(requests.filter(r => /\/(report|embed_session|stores)$/.test(r.path))).toEqual([])
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
    expect(requests).toEqual([{ path: '/api/app_reads/dash/me', status: 200 }])
  })

  for (const count of [2, 3, 4]) {
    installed(`names ${count} covered sections in a staff reader's heading without widening to the whole store`, async ({ dash, createUser }) => {
      const person = await createUser({ email: 'dash-multiple-sections@example.test', roles: ['Dash Reader'] })
      const names = ['Alpha', 'Beta', 'Gamma', 'Omega'].slice(0, count)
      for (const [index, section_name] of names.entries()) {
        const section = await dash.addSection(`LKS-${section_name}`, section_name)
        const subcategory = `02000000${index}`
        await dash.place(subcategory, section.row_id)
        await dash.job(person.user!, 'Staff', { section: section.row_id })
      }
      token = person.token
      await open()
      await waitForDive()
      expect(document.querySelector('[data-testid=heading-title]')?.textContent)
        .toBe(count > 3 ? 'Lakeside · 4 sections' : `Lakeside · ${names.join(' · ')}`)
      expect(document.querySelector('[data-testid=why-line]')?.textContent)
        .toBe(`You see ${count === 2 ? 'Alpha and Beta' : count === 3 ? 'Alpha, Beta and Gamma' : '4 sections'} at Lakeside because you work in them.`)
      expect(document.body.textContent).not.toContain('Sarees')
    })
  }

  installed('a reader with staff and team-lead jobs sees one ordered explanation for both sections', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-two-jobs@example.test', roles: ['Dash Reader'] })
    const section = await dash.addSection('LKS-Cotton', 'Cotton')
    await dash.place('020202002', section.row_id)
    await dash.job(person.user!, 'Staff', { section: section.row_id })
    await dash.job(person.user!, 'Team Leader', { section: dash.section.row_id })
    token = person.token
    await open()
    await waitForDive()
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Lakeside · Cotton · Sarees')
    expect(document.querySelector('[data-testid=why-line]')?.textContent)
      .toBe('You see Cotton and Sarees at Lakeside because you are Team Leader of Sarees and work in Cotton.')
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
      if (signedIn) await waitForDive()
      else await waitForText("You don't have a report to open yet.")
      expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
      expect(requests.filter(r => r.path.endsWith('/embed_session'))).toHaveLength(1)
      // Someone with no reports has no store to check: the report is opened at once, and refused.
      expect(requests.filter(r => r.path.endsWith('/stores'))).toHaveLength(signedIn ? 1 : 0)
      if (!signedIn) {
        expect(document.querySelector('[data-testid=dash] a[href*=instance-health]')).toBeNull()
        expect([...new Set(requests.filter(r => r.path.includes('/app_reads/')).map(r => r.status))]).toEqual([403])
      }
    })
  }

  installed("a report-read database deadline says Dash couldn't be reached, stays so when late answers arrive, then Try Again opens the Dive", async ({ dash: _dash }) => {
    history.replaceState(null, '', '/dash/')
    await open()
    await reportsAnswered()
    const busy = sql`select pg_sleep(16)`.execute()
    const reads = () => requests.filter(r => /\/(report|embed_session)$/.test(r.path))
    await act(async () => window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9901' } })))
    await waitForText("Couldn't reach Dash. Check your connection, then Try Again.", 17000)
    expect(reads()).toEqual([])
    await act(async () => {
      await busy
      while (inFlight.size) await Promise.all([...inFlight])
    })
    expect(reads().map(r => r.status)).toEqual([200, 200])
    expect(document.querySelector('[data-testid=dash]')?.getAttribute('data-view')).toBe('offline')
    expect(document.querySelector('table')).toBeNull()
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click())
    await waitForDive()
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(2)
      }, 25000)

  for (const missing of [false, true]) {
    installed(`a hosted manager sees ${missing ? 'missing setup guidance' : 'no-store guidance'} without a local-machine command`, async ({ dash: _dash, admin }) => {
      token = admin.token
      dom.reconfigure({ url: 'https://dash.example.test/dash/' })
      await withNamedVariable('MOTHERDUCK_TOKEN', missing ? undefined : 'made-up-local-ui-test-token', async () => {
        await open()
        await waitForText(missing ? "Dash isn't set up on this instance yet" : 'it has no report to show you')
        expect(document.querySelector('code')).toBeNull()
        expect(document.body.textContent).not.toContain('this machine')
        expect([...document.querySelectorAll('[data-testid=dash] a')].map(a => a.getAttribute('href')).filter(href => href !== '?view=access')).toEqual(['/featherbase/admin/instance-health'])
      })
    })
  }

  installed("bar and history store changes replace the old store's heading with the new store's and back again", async ({ dash }) => {
    await dash.job(dash.reader.user!, 'Store Manager', { site: 'HIL' })
    await open()
    await waitForDive()
    await act(async () => {
      history.pushState(null, '', '?store=9902')
      window.dispatchEvent(new dom.window.CustomEvent('featherbase:bar-change', { detail: { key: 'store', value: '9902' } }))
    })
    await waitForText('Hillview')
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Hillview')
    await act(async () => {
      history.replaceState(null, '', '?store=9901')
      window.dispatchEvent(new dom.window.PopStateEvent('popstate'))
    })
    await waitForText('Lakeside · Sarees')
    expect(document.body.textContent).not.toContain('Hillview')
  })

  installed('an address outside the real reader scope waits for correction, then opens only their default store', async ({ dash: _dash }) => {
    history.replaceState(null, '', '/dash/?store=9909')
    await open()
    await waitForDive()
    expect(requests.filter(r => r.path.endsWith('/stores'))).toEqual([
      { path: '/api/app_reads/dash/stores', status: 200 },
    ])
    expect(requests.filter(r => r.path.endsWith('/report'))).toHaveLength(1)
    expect(document.querySelector('[data-testid=heading-title]')?.textContent).toBe('Lakeside · Sarees')
        expect(document.body.textContent).not.toContain('9909')
  })

  // #967's UI checklist, against the real reads.
  installed('lists the reports in the sidebar, marks the one on show, and keeps the store in each address', async ({ dash: _dash }) => {
    history.replaceState(null, '', '/dash/?store=9901&report=sales')
    await open()
    await waitForDive()
    const links = [...document.querySelectorAll('[data-testid=report-link]')]
    expect(links.map(a => [a.textContent, a.getAttribute('aria-current'), a.getAttribute('href')])).toEqual([
      ['Sales versus target', 'page', '?store=9901&report=sales'],
      // The reader is a Team Leader: the whole-stores report isn't theirs to open, so it isn't listed (#967 point 1).
      ['Vendor sales by city', null, '?store=9901&report=vendor_sales'],
    ])
  })

  installed("tells a Team Leader a whole-stores report isn't available for their job", async ({ dash: _dash }) => {
    history.replaceState(null, '', '/dash/?report=store_target')
    await open()
    await waitForText("This report covers whole stores, so it isn't available for your job.")
    expect(document.body.textContent).not.toMatch(/9901|010101001/)
  })

  installed("says a report couldn't open, with Try Again, when MotherDuck refuses its Dive", async ({ dash: _dash }) => {
    motherDuckRefuses = true
    history.replaceState(null, '', '/dash/?report=vendor_sales')
    await open()
    await waitForText("This report couldn't open.")
    expect(document.querySelector('[data-testid=failed] button')?.textContent).toBe('Try Again')
    expect(document.querySelector('[data-testid=offline]')).toBeNull()
  })

  // #1391: the reader's request never reached the server: the page says so, not that the report failed.
  installed("says Dash couldn't be reached when the Dive's request fails on the way, and Try Again opens it", async ({ dash: _dash }) => {
    failOnTheWay = '/api/app_reads/dash/embed_session'
    await open()
    await waitForText("Couldn't reach Dash. Check your connection, then Try Again.")
    expect(document.querySelector('[data-testid=failed]')).toBeNull()
    failOnTheWay = undefined
    await act(async () => (document.querySelector('[data-testid=offline] button') as HTMLButtonElement).click())
    await waitForDive()
  })

  installed('shows no-access for a report that does not exist', async ({ dash: _dash }) => {
    history.replaceState(null, '', '/dash/?report=nope')
    await open()
    // #967 point 7: the reader has other reports, so the page says this one isn't theirs.
    await waitForText("You can't open this report. Choose one of your reports from the list.")
  })

  installed('tells Staff with no section why, with a link to Your sections', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-no-section@example.test', roles: ['Dash Reader'] })
    await dash.job(person.user!, 'Staff')
    token = person.token
    history.replaceState(null, '', '/dash/')
    await open()
    await waitForText("You aren't set against a section yet")
    expect(document.querySelector('[data-testid=fix-link]')?.getAttribute('href')).toBe('?view=sections')
  })

  installed('asks a Department Manager to set up their department (#1195)', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-department@example.test', roles: ['Dash Reader'] })
    await dash.job(person.user!, 'Department Manager')
    token = person.token
    history.replaceState(null, '', '/dash/')
    await open()
    await waitForText('Set up your department to open your report')
    expect(document.querySelector('[data-testid=department-link]')?.getAttribute('href')).toBe('?view=department')
  })

  // #1172: Dash opens for Head office staff (a Dash role) and says why there is no store report.
  installed('tells Head office staff why there is no store report', async ({ dash, createUser }) => {
    const person = await createUser({ email: 'dash-head-office@example.test', roles: ['Dash Reader'] })
    await dash.save('Site', { code: 'HOF', name: 'Head Office', is_store: false })
    await dash.job(person.user!, 'Head office staff', { site: 'HOF' })
    token = person.token
    history.replaceState(null, '', '/dash/')
    await open()
    await waitForText('Your job is in head office, so no store report is set against it.')
    expect(document.querySelector('[data-testid=no-access]')).toBeNull()
  })
})
