import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// DEL-J1 / DEL-J2 — docs/specs/0003-table-deletion.md, in the feather-testing
// DSL. Isolation: journey-owned names, pre-cleaned through the capability
// under test and deleted again by the walk itself — self-cleaning by
// construction, no skip path exists.

const DT = 'Journey Delete Zones'
const REF = 'Journey Delete Bookings'
const ENC = encodeURIComponent(DT)
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function adminToken(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await login.json()) as { token: string }).token
}

test('DEL-J1: delete an unwanted Table — counted confirmation, then gone everywhere', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  // Referrer first, then referent — the refusal path is why order matters.
  await deleteTableIfExists(request, token, REF)
  await deleteTableIfExists(request, token, DT)

  // The residue an import leaves: the Table, rows through the import
  // contract, and the Import Log entry J1.5 checks for afterwards.
  const created = await request.post('/api/doctype', {
    headers,
    data: { name: DT, columns: [{ column_name: 'zone_name', column_type: 'Data' }] },
  })
  expect(created.status()).toBe(201)
  const imported = await request.post(`/api/table/${ENC}:import`, {
    headers,
    data: {
      rows: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].map(
        (zone_name) => ({ zone_name }),
      ),
      context: { file_name: 'journey-delete-zones.csv' },
    },
  })
  expect(imported.status()).toBe(201)

  // J1.1 — the manager button row carries Delete Table (positive complement:
  // Naming and Permissions are there too — the row rendered, Delete joined it)
  await signIn(session)
  await session
    .visit(`/admin/${ENC}`)
    .assertHas('[data-testid="open-naming"]')
    .assertHas('[data-testid="open-permissions"]')
    .assertHas('[data-testid="delete-table"]')

  // Metadata gating: a system table's list view renders the same manager
  // row WITHOUT the deletion affordance (DEL-R3's system refusal, at the UI).
  await session
    .visit('/admin/User')
    .assertHas('[data-testid="open-naming"]')
    .refuteHas('[data-testid="delete-table"]')

  // J1.2 — the confirmation names the Table and its LIVE row count
  await session
    .visit(`/admin/${ENC}`)
    .clickButton('Delete Table')
    .assertHas('[data-testid="delete-table-dialog"]')
    .assertText(`Delete ${DT}?`)
    .assertText('8 rows will be permanently deleted')
    .assertText('This cannot be undone')

  // Branch at J1.2 — cancel: the list is untouched (DEL-I2 at the UI boundary)
  await session
    .clickButton('Cancel')
    .refuteHas('[data-testid="delete-table-dialog"]')
    .assertHas('[data-testid="list-total"]', { text: '8 total' })

  // J1.3 — confirm: landed on All tables, the Table absent everywhere
  await session.clickButton('Delete Table').assertHas('[data-testid="delete-table-dialog"]')
  await session.step('J1.3: confirm the deletion', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-table-confirm').click()
  })
  await session
    .assertPath('/admin/all-tables')
    .assertHas('[data-testid="all-tables-page"]')
  await session.step('J1.3: the Table is gone from every module group', async ({ page }: { page: Page }) => {
    await expect(page.getByTestId('doctype-nav')).toBeVisible()
    await expect(page.getByTestId('doctype-nav').getByText(DT)).toHaveCount(0)
  })

  // J1.4 — the direct URL is a not-found, never an empty list
  await session.visit(`/admin/${ENC}`).assertText(`Cannot load ${DT}`)

  // J1.5 — no Import Log entry names the deleted Table (swept, DEL-R4);
  // witnessed at the contract tier where the whole log is visible unpaginated.
  const log = await request.get(
    `/api/table/${encodeURIComponent('Import Log')}:count?filters=${encodeURIComponent(
      JSON.stringify([['ref_table', '=', DT]]),
    )}`,
    { headers },
  )
  expect(((await log.json()) as { count: number }).count).toBe(0)
  // And the definition is truly gone at the contract tier too.
  expect((await request.get(`/api/table/${ENC}:meta`, { headers })).status()).toBe(404)
})

test('DEL-J2: refused while referenced — the refusal names the blocker; unblocked, it succeeds', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, REF)
  await deleteTableIfExists(request, token, DT)

  for (const [name, columns] of [
    [DT, [{ column_name: 'zone_name', column_type: 'Data' }]],
    [REF, [{ column_name: 'zone', column_type: 'Reference', reference_table: DT }]],
  ] as const) {
    const res = await request.post('/api/doctype', { headers, data: { name, columns } })
    expect(res.status()).toBe(201)
  }

  // J2.2′ — the refusal names the referencing Table and column, in place
  await signIn(session)
  await session
    .visit(`/admin/${ENC}`)
    .clickButton('Delete Table')
    .assertHas('[data-testid="delete-table-dialog"]')
  await session.step('J2.2′: confirm — and read the refusal', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-table-confirm').click()
    await expect(page.getByTestId('delete-table-error')).toContainText(`${REF}.zone`)
  })
  // Nothing changed: the Table still answers (DEL-I2).
  expect((await request.get(`/api/table/${ENC}:meta`, { headers })).status()).toBe(200)

  // J2.3′ — remove the blocker, retry: deletion now goes through as J1.3
  const unblock = await request.delete(`/api/doctype/${encodeURIComponent(REF)}`, { headers })
  expect(unblock.status()).toBe(200)
  await session.step('J2.3′: retry the confirmation', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-table-confirm').click()
  })
  await session.assertPath('/admin/all-tables')
  expect((await request.get(`/api/table/${ENC}:meta`, { headers })).status()).toBe(404)
})
