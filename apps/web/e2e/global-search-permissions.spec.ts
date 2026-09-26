import {
  anonymousTest as test,
  expect,
  adminAuth,
  loginAs,
  tokenFor,
} from './fixtures'
import type { APIRequestContext, APIResponse } from '@playwright/test'

const TABLE = 'Gs Browser Customer'
const ROLE = 'Gs Browser Customer Role'
const ALICE = 'gs-browser-alice@example.com'
const BOB = 'gs-browser-bob@example.com'
const PASSWORD = 'gs-browser-password'
const ALICE_ID = 'gs-browser-visible-id'
const ALICE_SECRET = 'gs-browser-alice-secret'
const BOB_ID = 'bob-customer-id'

async function expectStatus(response: APIResponse, expected: number, label: string) {
  if (response.status() !== expected)
    throw new Error(`${label}: ${response.status()} ${await response.text()}`)
}

async function expectCreatedRow(response: APIResponse, rowId: string, label: string) {
  await expectStatus(response, 201, label)
  const row = (await response.json()) as { row_id?: string }
  expect(row.row_id).toBe(rowId)
}

async function expectPersistedRow(
  request: APIRequestContext,
  headers: { Authorization: string },
  rowId: string,
  secretName: string,
) {
  const response = await request.get(
    `/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(rowId)}`,
    { headers },
  )
  await expectStatus(response, 200, `read ${rowId}`)
  expect(await response.json()).toMatchObject({ row_id: rowId, secret_name: secretName })
}

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const table = await request.post('/api/table_def', {
    headers,
    data: {
      name: TABLE,
      id_pattern: 'prompt',
      title_column: 'secret_name',
      columns: [
        { column_name: 'secret_name', column_type: 'Data', tier: 'restricted' },
      ],
    },
  })
  await expectStatus(table, 201, 'create Table')

  const role = await request.post('/api/save_row', {
    headers,
    data: { table: 'Role', row: { row_id: ROLE } },
  })
  await expectCreatedRow(role, ROLE, 'create Role')
  const basicPermission = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Permission',
      row: {
        ref_table: TABLE,
        role: ROLE,
        tier: 'basic',
        own_rows_only: true,
        can_read: true,
        can_create: true,
      },
    },
  })
  await expectStatus(basicPermission, 201, 'create basic Permission')
  // The fixture users can supply the sensitive title but cannot read it.
  const restrictedPermission = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Permission',
      row: { ref_table: TABLE, role: ROLE, tier: 'restricted', can_write: true },
    },
  })
  await expectStatus(restrictedPermission, 201, 'create restricted Permission')

  for (const user of [ALICE, BOB]) {
    const createdUser = await request.post('/api/save_row', {
      headers,
      data: {
        table: 'User',
        row: { row_id: user, email: user, enabled: true, roles: [{ role: ROLE }] },
      },
    })
    await expectCreatedRow(createdUser, user, `create User ${user}`)
    const password = await request.post('/api/set_password', {
      headers,
      data: { user, password: PASSWORD },
    })
    await expectStatus(password, 200, `set password for ${user}`)
  }

  const aliceToken = await tokenFor(request, ALICE, PASSWORD)
  const aliceRow = await request.post(`/api/table/${encodeURIComponent(TABLE)}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
    data: { row_id: ALICE_ID, secret_name: ALICE_SECRET },
  })
  await expectCreatedRow(aliceRow, ALICE_ID, 'create Alice row')
  const bobToken = await tokenFor(request, BOB, PASSWORD)
  const bobRow = await request.post(`/api/table/${encodeURIComponent(TABLE)}`, {
    headers: { Authorization: `Bearer ${bobToken}` },
    data: { row_id: BOB_ID, secret_name: ALICE_ID },
  })
  await expectCreatedRow(bobRow, BOB_ID, 'create Bob row')

  await expectPersistedRow(request, headers, ALICE_ID, ALICE_SECRET)
  await expectPersistedRow(request, headers, BOB_ID, ALICE_ID)
})

test('search shows only an allowed row ID and never its sensitive title', async ({ session }) => {
  await session.step('sign in as the row-limited user', async ({ page }) => {
    await loginAs(page, ALICE, PASSWORD, /\/admin/)
  })
  await session.visit('/admin')

  await session
    .fillIn('Search or type a command…', ALICE_ID)
    .assertHas('[data-testid="awesomebar-doc"]', { count: 1 })
    .within('[data-testid="awesomebar-doc"]', (row) =>
      row
        .assertExactText(`${ALICE_ID}row in ${TABLE}`)
        .refuteText(ALICE_SECRET)
        .refuteText(BOB_ID),
    )
})
