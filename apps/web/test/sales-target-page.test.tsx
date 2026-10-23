// The sales-target report page (#3783): one report on the page, not two. When the live MotherDuck
// Dive is embedded, the cached table folds away behind a line naming its age; when the Dive is not
// there, the cached table is the report and stays open. Server in-process; MotherDuck stubbed.
import { afterEach, beforeEach, vi } from 'vitest'
import type { Sql } from 'postgres'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setEmbedFetch, seedSalesTarget } from 'server/src/sales-target'
import { _setSourceReader } from 'server/src/datasets/sales-target-mtd'
import { test, expect, renderApp } from './pg-test'

const saved = { ...process.env }
beforeEach(() => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  process.env.MOTHERDUCK_TOKEN = 'page-test-token'
  process.env.DIVE_ID = 'dive-under-test'
  process.env.DIVE_VERSION = '10'
  process.env.SERVICE_ACCOUNT = 'svc'
  process.env.SALES_TARGET_SHARED_ENV = '/nonexistent/sales-target.env'
  _setSourceReader(async () => [])
  _setEmbedFetch(async () => Response.json({ session: 'stub-session' }))
})
afterEach(() => {
  _setEmbedFetch(null)
  _setSourceReader(null)
  for (const k of ['SALES_TARGET_TODAY', 'MOTHERDUCK_TOKEN', 'DIVE_ID', 'DIVE_VERSION', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV'])
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
})

async function personId(admin: { fetch: (path: string, init?: RequestInit) => Promise<Response> }, username: string): Promise<string> {
  const filters = encodeURIComponent(JSON.stringify([['username', '=', username]]))
  const found = (await (await admin.fetch(`/api/table/Person?filters=${filters}`)).json()) as { data: { row_id: string }[] }
  return found.data[0].row_id
}

async function viewer(admin: { fetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001'] },
  ])
}

test('with the live Dive on the page, the cached table is folded away and says it is the cache', async ({ admin, api }) => {
  await viewer(admin)
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_1' } as never)
  expect(await screen.findByTestId('report-frame')).toBeInTheDocument()
  const quick = await screen.findByTestId('snapshot-quick')
  expect((quick as HTMLDetailsElement).open).toBe(false)
  expect(quick).toHaveTextContent('Quick table from the cache')
  expect(quick).toContainElement(screen.getByTestId('snapshot-report'))
})

test('with no Dive configured, the cached table is the report and stays open', async ({ admin, api }) => {
  await viewer(admin)
  delete process.env.DIVE_ID
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_1' } as never)
  await waitFor(() => expect(screen.getByTestId('embed-state')).toHaveAttribute('data-state', 'not-configured'))
  expect(screen.queryByTestId('snapshot-quick')).not.toBeInTheDocument()
  expect(screen.getByTestId('snapshot-report')).toBeVisible()
})

// #3783: the page says WHY the reader sees these figures; a Store Manager is told so.
test('a Store Manager is told they see the whole store as Store Manager', async ({ admin, api }) => {
  await viewer(admin)
  for (const [name, columns] of [
    ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
    ['Store Manager', ['store_code', 'employee_code', 'full_name', 'email']],
  ] as const)
    await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name, module: 'Store Sections', columns: columns.map((c) => ({ column_name: c, column_type: 'Data' })) }),
    })
  for (const [table, row] of [
    ['Section Merchandise Map', { store_code: '1501', material_group: '010505001', mch_subcategory: 'Kurti', section_name: 'Kurti' }],
    ['Store Manager', { store_code: '1501', employee_code: 'RR-0104', full_name: 'A. Kumar', email: 'sm.atk@jeyarama.com' }],
  ] as const)
    await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table, row }) })
  // person-rename: the account's id is minted; find it by its username.
  const id = await personId(admin, 'test_employee_2')
  const doc = (await (await admin.fetch(`/api/table/Person/${id}`)).json()) as { updated_at: string }
  await admin.fetch(`/api/table/Person/${id}`, {
    method: 'PATCH', body: JSON.stringify({ employee_code: 'RR-0104', updated_at: doc.updated_at }),
  })

  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_2', pwd: 'pw-2' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_2' } as never)
  await waitFor(() => expect(screen.getByTestId('identity-sub')).toHaveTextContent('Store Manager'))
  expect(screen.getByTestId('identity')).toHaveTextContent('1501 · Kurti')
})

// A Store Manager runs every Section; naming 57 of them buries the figures. Up to three are named,
// more are counted, and the full list stays one hover away.
test('more than three Sections are counted, not listed; a Store Manager reads "Whole store"', async ({ admin, api }) => {
  await viewer(admin)
  for (const [name, columns] of [
    ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name']],
    ['Store Manager', ['store_code', 'employee_code', 'full_name', 'email']],
  ] as const)
    await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name, module: 'Store Sections', columns: columns.map((c) => ({ column_name: c, column_type: 'Data' })) }),
    })
  for (const [mg, section] of [['010505001', 'Kurti'], ['010101001', 'Boys Tops'], ['010102003', 'Boys Bottoms'], ['010501001', 'Silk Saree']])
    await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Section Merchandise Map', row: { store_code: '1501', material_group: mg, mch_subcategory: section, section_name: section } }),
    })
  await admin.fetch('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({ table: 'Store Manager', row: { store_code: '1501', employee_code: 'RR-0104', full_name: 'Z', email: 'sm.atk@jeyarama.com' } }),
  })
  // person-rename: the account's id is minted; find it by its username.
  const id = await personId(admin, 'test_employee_2')
  const doc = (await (await admin.fetch(`/api/table/Person/${id}`)).json()) as { updated_at: string }
  await admin.fetch(`/api/table/Person/${id}`, {
    method: 'PATCH', body: JSON.stringify({ employee_code: 'RR-0104', updated_at: doc.updated_at }),
  })
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_2', pwd: 'pw-2' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_2' } as never)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('1501 · Whole store · 4 Sections'))
  expect(screen.getByTestId('identity-section-list')).not.toBeVisible()
  // The full list is a tap or a key press away — no hover, so phones and keyboards get it too.
  const toggle = screen.getByText('Whole store · 4 Sections', { selector: 'summary' })
  expect(screen.getByTestId('identity-sections')).not.toHaveAttribute('open')
  await userEvent.click(toggle)
  expect(screen.getByTestId('identity-sections')).toHaveAttribute('open')
  expect(screen.getByTestId('identity-section-list')).toBeVisible()
  expect(screen.getByTestId('identity-section-list')).toHaveTextContent('Boys Bottoms · Boys Tops · Kurti · Silk Saree')
})

test('three Sections or fewer are named outright, with nothing to expand', async ({ admin, api }) => {
  await viewer(admin)
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_1' } as never)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('1501 — ATK'))
  expect(screen.queryByTestId('identity-sections')).not.toBeInTheDocument()
})

// A person who has no username is shown by name; the opaque id is never put on the screen (#405).
test('the header never shows the opaque person id', async ({ admin, createUser }) => {
  await viewer(admin)
  const nobody = await createUser({ email: 'no.username@example.com', fullName: 'Asha Nair', roles: ['Sales Target Viewer'] })
  expect(nobody.user).toMatch(/^psn_/)
  await renderApp('/featherbase/sales-target', nobody)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('Asha Nair'))
  expect(screen.getByTestId('identity-sub')).not.toHaveTextContent('psn_')
  expect(screen.getByTestId('identity-sub')).not.toHaveTextContent('Signed in as')
})

test('a person with no viewer role is told plainly, with no API wording and no id', async ({ createUser }) => {
  const outsider = await createUser({ email: 'outsider.page@example.com' })
  await renderApp('/featherbase/sales-target', outsider)
  const note = await screen.findByTestId('embed-state')
  await waitFor(() => expect(note).toHaveTextContent("You don't have access to this report"))
  expect(note).not.toHaveTextContent('Requires the')
  expect(note).not.toHaveTextContent('session could not be created')
})

// #404: a two-store account gets the server's sentence in a neutral card, not the red developer frame.
test('a person set up for two stores sees the server\'s sentence, not "Report unavailable"', async ({ admin, createUser }) => {
  await viewer(admin)
  const reader = await createUser({ email: 'two.stores@example.com', roles: ['Sales Target Viewer'] })
  for (const [plant, group] of [['1501', '010101003'], ['1515', '010101002']])
    await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Sales Target Assignment', row: { employee: reader.user, plant_code: plant, store_label: 'S', material_group: group } }),
    })
  await renderApp('/featherbase/sales-target', reader)
  const note = await screen.findByTestId('embed-refused')
  expect(note).toHaveTextContent('more than one store (1501, 1515)')
  expect(note).toHaveTextContent('Ask your administrator')
  expect(screen.queryByText('Report unavailable')).not.toBeInTheDocument()
  expect(screen.queryByText(/This is not a sales figure/)).not.toBeInTheDocument()
  expect(screen.getByTestId('identity')).not.toHaveTextContent('Opening your report')
})

// Only the two-store refusal gets the neutral card; any other validation failure keeps the generic "unavailable" frame.
test('another validation refusal keeps the generic frame, not the neutral card', async ({ admin, createUser }) => {
  await viewer(admin)
  const reader = await createUser({ email: 'other.refusal@example.com', roles: ['Sales Target Viewer'] })
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('/api/sales_target/me'))
      return Response.json({ error: { type: 'ValidationError', message: 'internal detail psn_secretid' } }, { status: 417 })
    return real(input, init)
  })
  try {
    await renderApp('/featherbase/sales-target', reader)
    await screen.findByText('Report unavailable')
    expect(screen.queryByTestId('embed-refused')).not.toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

// The role is deleted right after /me succeeded: the report calls answer 403 and the page shows the plain no-access card.
test('a role taken away mid-session shows the no-access card and no cached table', async ({ admin, createUser, db }) => {
  await viewer(admin)
  const reader = await createUser({ email: 'role.revoked@example.com', roles: ['Sales Target Viewer'] })
  const id = reader.user!
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    // The jsdom AbortSignal is not the one the bridge expects; the page's own fetches drop it here.
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit
    const res = await real(input, rest)
    if (String(input).includes('/api/sales_target/me'))
      await (db as Sql)`delete from has_role where parent = ${id} and role = 'Sales Target Viewer'`
    return res
  })
  try {
    await renderApp('/featherbase/sales-target', reader)
    expect(await screen.findByText("You don't have access to this report")).toBeInTheDocument()
    expect(screen.queryByTestId('snapshot-report')).not.toBeInTheDocument()
    expect(screen.queryByText(/Numbers unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByText('Report unavailable')).not.toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

// Only /report answers 403 here (embed_session never answers): its refusal alone must produce the plain card, never the red "Numbers unavailable".
test('a 403 from /report alone shows the no-access card', async ({ admin, createUser, db }) => {
  await viewer(admin)
  const reader = await createUser({ email: 'report.only@example.com', roles: ['Sales Target Viewer'] })
  const id = reader.user!
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit
    if (String(input).includes('/api/sales_target/embed_session')) return new Promise<Response>(() => {})
    const res = await real(input, rest)
    if (String(input).includes('/api/sales_target/me'))
      await (db as Sql)`delete from has_role where parent = ${id} and role = 'Sales Target Viewer'`
    return res
  })
  try {
    await renderApp('/featherbase/sales-target', reader)
    expect(await screen.findByText("You don't have access to this report")).toBeInTheDocument()
    expect(screen.queryByText(/Numbers unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('snapshot-error')).not.toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

test('a person with no full name is shown by email, never by id, in the header', async ({ admin, createUser, db }) => {
  await viewer(admin)
  const nobody = await createUser({ email: 'no.fullname@example.com', roles: ['Sales Target Viewer'] })
  await (db as Sql)`update person set full_name = null where row_id = ${nobody.user!}`
  await renderApp('/featherbase/sales-target', nobody)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('no.fullname@example.com'))
  expect(screen.getByTestId('identity')).not.toHaveTextContent('psn_')
})

test('a person with no viewer role gets a neutral header, not "Opening your report"', async ({ createUser }) => {
  const outsider = await createUser({ email: 'outsider.header@example.com' })
  await renderApp('/featherbase/sales-target', outsider)
  await screen.findByText("You don't have access to this report")
  expect(screen.getByTestId('identity')).not.toHaveTextContent('Opening your report')
})
