// Moved from e2e/sales-target.spec.ts (#3755, #1080): what the report page does
// across sign-ins on one device — landing from the sign-in form, the guarded
// address, a shared tablet changing hands, and an embed answer that arrives
// for the person who already left. Server in-process; MotherDuck's embed API
// is stubbed at its boundary (_setEmbedFetch) with a session naming the
// subcategories it was opened with, so the frame shows whose report it is.
import { afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setEmbedFetch, seedSalesTarget } from 'server/src/sales-target'
import { _setSourceReader } from 'server/src/datasets/sales-target-mtd'
import { test, committedTest, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
type Admin = Parameters<typeof renderApp>[1]
const saved = { ...process.env }
let embedGate: ((codes: string[]) => Promise<void>) | null = null

beforeEach(() => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  process.env.MOTHERDUCK_TOKEN = 'journey-test-token'
  process.env.DIVE_ID = 'dive-under-test'
  process.env.SERVICE_ACCOUNT = 'svc'
  process.env.SALES_TARGET_SHARED_ENV = '/nonexistent/sales-target.env'
  _setSourceReader(async () => [])
  _setEmbedFetch(async (_url, init) => {
    const { initial_state } = JSON.parse(String(init?.body)) as { initial_state: { material_groups: string[] } }
    const codes = [...initial_state.material_groups].sort()
    if (embedGate) await embedGate(codes)
    return Response.json({ session: `s-${codes.join('+')}` })
  })
})
afterEach(() => {
  embedGate = null
  _setEmbedFetch(null)
  _setSourceReader(null)
  vi.restoreAllMocks()
  for (const k of ['SALES_TARGET_TODAY', 'MOTHERDUCK_TOKEN', 'DIVE_ID', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV'])
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
})

const E1 = ['010101001', '010101003']
const E2 = ['010102001', '010102002']

async function seed(admin: Admin) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: E1 },
    { username: 'test_employee_2', display_name: 'Employee 2', plant_code: '1501', store_label: 'ATK', material_groups: E2 },
  ])
}

type Router = { state: { location: { pathname: string } } }
const pathOf = (r: { router: unknown }) => (r.router as Router).state.location.pathname
/** The frame's embed session, which names the subcategories it was opened with. */
const frameSession = () =>
  decodeURIComponent(new URL(screen.getByTestId('report-frame').getAttribute('src')!).hash.replace('#session=', ''))

async function signIn(username: string, password: string) {
  await userEvent.type(await screen.findByLabelText('Email or username', {}, { timeout: 8000 }), username)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

async function signOut() {
  await userEvent.click(await screen.findByTestId('session-user', {}, { timeout: 8000 }))
  await userEvent.click(screen.getByTestId('logout'))
}

test('a viewer signing in on the form lands on the report, headed with their name, store and period, and no store choice', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/login', anonymous)
  await signIn('test_employee_1', 'pw-1')
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/sales-target'), { timeout: 8000 })
  await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe('Employee 1 · 1501 — ATK · 01-Sep-2026 to 17-Sep-2026'), { timeout: 8000 })
  expect(document.querySelectorAll('select')).toHaveLength(0)
  await waitFor(() => expect(frameSession()).toBe(`s-${E1.join('+')}`))
})

test('signed out, the report address goes to sign in and opens no report', async () => {
  const r = await renderApp('/featherbase/sales-target', anonymous)
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
  expect(screen.queryByTestId('report-frame')).not.toBeInTheDocument()
})

test('on a shared tablet, the next person to sign in sees only their own report', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp('/featherbase/login', anonymous)
  await signIn('test_employee_1', 'pw-1')
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('Employee 1 · 1501 — ATK'), { timeout: 8000 })
  await waitFor(() => expect(frameSession()).toBe(`s-${E1.join('+')}`))

  await signOut()
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
  await signIn('test_employee_2', 'pw-2')
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('Employee 2 · 1501 — ATK'), { timeout: 8000 })
  await waitFor(() => expect(frameSession()).toBe(`s-${E2.join('+')}`))
  expect(document.body).not.toHaveTextContent('Employee 1')
})

test('a fresh load keeps the person signed in on the report; signing out removes it and guards the address again', async ({ admin }) => {
  await seed(admin)
  const first = await renderApp('/featherbase/login', anonymous)
  await signIn('test_employee_2', 'pw-2')
  await waitFor(() => expect(pathOf(first)).toBe('/featherbase/sales-target'), { timeout: 8000 })
  first.unmount()

  // A reload: the page starts again from the address and what the browser stored.
  const token = localStorage.getItem('fc_token')
  expect(token).toEqual(expect.any(String))
  const r = await renderApp('/featherbase/sales-target', { token, user: null } as never)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('Employee 2 · 1501 — ATK'), { timeout: 8000 })
  await signOut()
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
  expect(screen.queryByTestId('report-frame')).not.toBeInTheDocument()
  r.unmount()

  const again = await renderApp('/featherbase/sales-target', anonymous)
  await waitFor(() => expect(pathOf(again)).toBe('/featherbase/login'))
})

// Committed: the held embed request would otherwise hold the sandbox's one
// connection, and the sign-out behind it could never run (docs/TESTING.md).
committedTest("an embed answer for the person who signed out is never shown to the next person", async ({ admin }) => {
  await seed(admin)
  let release!: () => void
  const late = new Promise<void>((resolve) => { release = resolve })
  let firstAsked!: () => void
  const asked = new Promise<void>((resolve) => { firstAsked = resolve })
  embedGate = async (codes) => {
    if (codes.join('+') !== E1.join('+')) return
    firstAsked()
    await late
  }
  // A held request must not outlive the test, or the sandbox cannot close.
  try {
    const r = await renderApp('/featherbase/login', anonymous)
    await signIn('test_employee_1', 'pw-1')
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('Employee 1'), { timeout: 8000 })
    await asked // Employee 1's embed request is in flight

    await signOut()
    await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
    await signIn('test_employee_2', 'pw-2')
    await waitFor(() => expect(frameSession()).toBe(`s-${E2.join('+')}`), { timeout: 8000 })

    release()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.getAllByTestId('report-frame')).toHaveLength(1)
    expect(frameSession()).toBe(`s-${E2.join('+')}`)
    expect(document.body).not.toHaveTextContent('010101001')
  } finally {
    release()
  }
})
