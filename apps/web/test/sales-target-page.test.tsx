// The sales-target report page (#3783): one report on the page, not two. When the live MotherDuck
// Dive is embedded, the cached table folds away behind a line naming its age; when the Dive is not
// there, the cached table is the report and stays open. Server in-process; MotherDuck stubbed.
import { afterEach, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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
    ['Store Manager', { store_code: '1501', employee_code: 'RR-10104', full_name: 'Zainulabudeen K S', email: 'sm.atk@jeyarama.com' }],
  ] as const)
    await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table, row }) })
  const doc = (await (await admin.fetch('/api/table/User/test_employee_2')).json()) as { updated_at: string }
  await admin.fetch('/api/table/User/test_employee_2', {
    method: 'PATCH', body: JSON.stringify({ employee_code: 'RR-10104', updated_at: doc.updated_at }),
  })

  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_2', pwd: 'pw-2' }) })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: 'test_employee_2' } as never)
  await waitFor(() => expect(screen.getByTestId('identity-sub')).toHaveTextContent('Store Manager'))
  expect(screen.getByTestId('identity')).toHaveTextContent('1501 · Kurti')
})
