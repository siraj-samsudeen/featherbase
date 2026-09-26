import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import type { SearchHit } from '../src/search'
import { test } from './pg-test'
import { createUserWithRole, grantRole, makeTable, type TableRef } from './fixtures'

const search = (client: TestClient, query: string) =>
  client.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`)

async function setupSensitiveTitle(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ table: TableRef; basicUser: TestClient; elevatedUser: TestClient }> {
  const table = await makeTable(admin, {
    name: 'Gs Sensitive Customer',
    id_pattern: 'prompt',
    title_column: 'secret_name',
    columns: [
      'city',
      { column_name: 'secret_name', column_type: 'Data', tier: 'restricted' },
    ],
  })
  const basicUser = await createUserWithRole(admin, createUser, {
    role: 'Gs Sensitive Basic Role',
    table: table.name,
    can_read: true,
  })
  await grantRole(admin, {
    role: 'Gs Sensitive Title Role',
    table: table.name,
    tier: 'restricted',
    can_read: true,
  })
  const elevatedUser = await createUser({
    roles: ['Gs Sensitive Basic Role', 'Gs Sensitive Title Role'],
  })
  await admin.post(table.url, {
    row_id: 'visible-customer-id',
    city: 'Chennai',
    secret_name: 'gs-secret-customer-name',
  })
  return { table, basicUser, elevatedUser }
}

describe('global search permissions', () => {
  test('own-row limits protect both ID and title matches', async ({ admin, createUser }) => {
    const table = await makeTable(admin, {
      name: 'Gs Own Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: ['customer_name'],
    })
    const alice = await createUserWithRole(admin, createUser, {
      role: 'Gs Own Customer Role',
      table: table.name,
      own_rows_only: true,
      can_read: true,
      can_create: true,
      can_write: true,
    })
    const bob = await createUser({ roles: ['Gs Own Customer Role'] })

    expect(await admin.get(table.metaUrl)).toMatchObject({ title_column: 'customer_name' })
    await alice.post(table.url, { row_id: 'gs-asymmetric-scope', customer_name: 'Alice' })
    await bob.post(table.url, { row_id: 'bob-customer', customer_name: 'gs-asymmetric-scope' })

    const { results } = await search(alice, 'gs-asymmetric-scope')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      { table: table.name, row_id: 'gs-asymmetric-scope', title: 'Alice' },
    ])
  })

  test('Data Scope protects chosen rows and rows that reference them', async ({
    admin,
    createUser,
  }) => {
    const region = await makeTable(admin, {
      name: 'Gs Search Region',
      id_pattern: 'prompt',
      columns: ['label'],
    })
    const customer = await makeTable(admin, {
      name: 'Gs Scoped Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: [
        'customer_name',
        { column_name: 'region', column_type: 'Reference', reference_table: region.name },
      ],
    })
    const user = await createUserWithRole(admin, createUser, {
      role: 'Gs Scoped Customer Role',
      table: [region.name, customer.name],
      can_read: true,
    })

    await admin.post(region.url, { row_id: 'gs-region-scope-east', label: 'East' })
    await admin.post(region.url, { row_id: 'gs-region-scope-west', label: 'West' })
    await admin.post(customer.url, {
      row_id: 'east-customer',
      customer_name: 'gs-customer-scope East',
      region: 'gs-region-scope-east',
    })
    await admin.post(customer.url, {
      row_id: 'west-customer',
      customer_name: 'gs-customer-scope West',
      region: 'gs-region-scope-west',
    })
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { user: user.user, allow_table: region.name, for_value: 'gs-region-scope-east' },
    })

    const regionResults = (await search(user, 'gs-region-scope')).results.filter(
      (hit) => hit.table === region.name,
    )
    expect(regionResults).toEqual([
      {
        table: region.name,
        row_id: 'gs-region-scope-east',
        title: 'gs-region-scope-east',
      },
    ])

    const customerResults = (await search(user, 'gs-customer-scope')).results.filter(
      (hit) => hit.table === customer.name,
    )
    expect(customerResults).toEqual([
      { table: customer.name, row_id: 'east-customer', title: 'gs-customer-scope East' },
    ])
  })

  test('a sensitive title alone cannot produce a search hit', async ({ admin, createUser }) => {
    const { table, basicUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(basicUser, 'gs-secret-customer-name')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([])
  })

  test('an ID match uses the ID instead of a sensitive title', async ({ admin, createUser }) => {
    const { table, basicUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(basicUser, 'visible-customer-id')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      {
        table: table.name,
        row_id: 'visible-customer-id',
        title: 'visible-customer-id',
      },
    ])
  })

  test('deeper field access can search and display the sensitive title', async ({
    admin,
    createUser,
  }) => {
    const { table, elevatedUser } = await setupSensitiveTitle(admin, createUser)

    const { results } = await search(elevatedUser, 'gs-secret-customer-name')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([
      {
        table: table.name,
        row_id: 'visible-customer-id',
        title: 'gs-secret-customer-name',
      },
    ])
  })

  test('a direct share stays openable by link without widening search', async ({
    admin,
    createUser,
  }) => {
    const table = await makeTable(admin, {
      name: 'Gs Shared Customer',
      id_pattern: 'prompt',
      title_column: 'customer_name',
      columns: ['customer_name'],
    })
    const alice = await createUserWithRole(admin, createUser, {
      role: 'Gs Shared Customer Role',
      table: table.name,
      own_rows_only: true,
      can_read: true,
      can_create: true,
      can_write: true,
    })
    const bob = await createUser({ roles: ['Gs Shared Customer Role'] })
    await alice.post(table.url, { row_id: 'alice-shared-customer', customer_name: 'Alice' })
    await bob.post(table.url, {
      row_id: 'gs-direct-share-hidden',
      customer_name: 'Shared Customer',
    })
    await admin.post('/api/save_row', {
      table: 'Share',
      row: {
        share_table: table.name,
        share_name: 'gs-direct-share-hidden',
        user: alice.user,
        read: true,
      },
    })

    expect((await alice.fetch(table.rowUrl('gs-direct-share-hidden'))).status).toBe(200)
    const { results } = await search(alice, 'gs-direct-share-hidden')
    expect(results.filter((hit) => hit.table === table.name)).toEqual([])
  })
})
