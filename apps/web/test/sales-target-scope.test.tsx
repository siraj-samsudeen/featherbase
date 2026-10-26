// The sales-target page tells a roster-derived reader why they see these figures and how many
// Sections that is (sales-target-report: "Leader who is also rostered on subcategories", "A
// Department Manager with five Sections"). The server derives the scope from the Store Sections
// maps and the roster (apps/server/test/sales-target.test.ts); here the page shows it.
// Server in-process; MotherDuck stubbed.
import { afterEach, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setEmbedFetch, seedSalesTarget } from 'server/src/sales-target'
import { _setSourceReader } from 'server/src/datasets/sales-target-mtd'
import { applySeedPack } from 'server/src/seed-packs'
import { test, expect, renderApp } from './pg-test'

type Client = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

const saved = { ...process.env }
const ENV_KEYS = ['SALES_TARGET_TODAY', 'MOTHERDUCK_TOKEN', 'DIVE_ID', 'DIVE_VERSION', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV']
beforeEach(() => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  process.env.MOTHERDUCK_TOKEN = 'scope-test-token'
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
  for (const k of ENV_KEYS)
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
})

const post = (admin: Client, path: string, body: unknown) => admin.fetch(path, { method: 'POST', body: JSON.stringify(body) })

/** The viewer accounts, the Store Sections maps and the roster, all empty of rows. */
async function seedTables(admin: Client) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001'] },
  ])
  for (const [name, columns] of [
    ['Section Merchandise Map', [['store_code', 'Data'], ['material_group', 'Data'], ['mch_subcategory', 'Data'], ['section_name', 'Data']]],
    ['Employee Section Map', [['store_code', 'Data'], ['employee_code', 'Data'], ['subcategory', 'Data'], ['section_name', 'Data']]],
    ['Section Ownership', [['store_code', 'Data'], ['section_name', 'Data'], ['tl_employee_code', 'Data'], ['dm_name', 'Data'], ['dm_employee_code', 'Data'], ['effective_from', 'Date']]],
  ] as const)
    await post(admin, '/api/table_def', { name, module: 'Store Sections', columns: columns.map(([c, t]) => ({ column_name: c, column_type: t })) })
}

/** Section name → its subcategory and material group, all at store 1501. */
async function sections(admin: Client, rows: [section: string, subcategory: string, mg: string][]) {
  for (const [section_name, mch_subcategory, material_group] of rows)
    await post(admin, '/api/save_row', { table: 'Section Merchandise Map', row: { store_code: '1501', material_group, mch_subcategory, section_name } })
}

async function signInWithCode(admin: Client, api: Client, username: string, password: string, code: string) {
  await applySeedPack('jeyarama')
  const filters = encodeURIComponent(JSON.stringify([['username', '=', username]]))
  const found = (await (await admin.fetch(`/api/table/Person?filters=${filters}`)).json()) as { data: { row_id: string }[] }
  const res = await post(admin, `/api/people/${found.data[0].row_id}/identifiers`, { system: 'stylehr-employee-code', value: code, note: 'Joiner, HR mail' })
  expect(res.status).toBe(201)
  const login = await post(api, '/api/login', { usr: username, pwd: password })
  const { token } = (await login.json()) as { token: string }
  await renderApp('/featherbase/sales-target', { token, user: username } as never)
}

test('a Team Leader who is also rostered on a subcategory of another Section is told both reasons', async ({ admin, api }) => {
  await seedTables(admin)
  await sections(admin, [['Kurti', 'Kurti', '010505001'], ['Boys Bottoms', 'Boys Jeans', '010102003']])
  // RR-70001 leads Kurti, and is personally rostered on Boys Jeans in Boys Bottoms.
  await post(admin, '/api/save_row', {
    table: 'Section Ownership',
    row: { store_code: '1501', section_name: 'Kurti', tl_employee_code: 'RR-70001', dm_name: 'Dee', dm_employee_code: 'RR-80001', effective_from: '2026-09-01' },
  })
  await post(admin, '/api/save_row', {
    table: 'Employee Section Map', row: { store_code: '1501', employee_code: 'RR-70001', subcategory: 'Boys Jeans', section_name: 'Boys Bottoms' },
  })

  await signInWithCode(admin, api, 'test_employee_2', 'pw-2', 'RR-70001')
  await waitFor(() => expect(screen.getByTestId('identity-sub')).toHaveTextContent('Team Leader · Section staff'))
  expect(screen.getByTestId('identity')).toHaveTextContent('1501 · Boys Bottoms · Kurti')
})

test('a Department Manager whose scope is five Sections reads "5 Sections", and tapping it lists them', async ({ admin, api }) => {
  await seedTables(admin)
  const five: [string, string, string][] = [
    ['Kurti', 'Kurti', '010505001'],
    ['Boys Tops', 'Boys Casual Shirt', '010101001'],
    ['Boys Bottoms', 'Boys Jeans', '010102003'],
    ['Silk Saree', 'Silk Saree', '010501001'],
    ['Girls Frocks', 'Girls Frock', '010201001'],
  ]
  await sections(admin, five)
  for (const [section_name] of five)
    await post(admin, '/api/save_row', {
      table: 'Section Ownership',
      row: { store_code: '1501', section_name, tl_employee_code: 'RR-70001', dm_name: 'Dee', dm_employee_code: 'RR-80001', effective_from: '2026-09-01' },
    })

  await signInWithCode(admin, api, 'test_employee_3', 'pw-3', 'RR-80001')
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('1501 · 5 Sections'))
  expect(screen.getByTestId('identity')).not.toHaveTextContent('Whole store')
  expect(screen.getByTestId('identity-sub')).toHaveTextContent('Department Manager')
  expect(screen.getByTestId('identity-section-list')).not.toBeVisible()

  await userEvent.click(screen.getByText('5 Sections', { selector: 'summary' }))
  expect(screen.getByTestId('identity-section-list')).toBeVisible()
  expect(screen.getByTestId('identity-section-list')).toHaveTextContent('Boys Bottoms · Boys Tops · Girls Frocks · Kurti · Silk Saree')
})
