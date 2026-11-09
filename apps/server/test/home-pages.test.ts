// #80: Home Pages — curated navigation. GET /api/home_pages is the sidebar's
// single source: role visibility (presentation scoping, NOT a security
// boundary) and link permission-filtering are computed here, server-side.
// Auto-membership keeps every built table reachable, and the 0060 seeds are
// idempotent.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'
import { expectStatus, grantRole } from './fixtures'

interface Card {
  label: string | null
  links: { label: string; link_to: string }[]
}
interface Page {
  row_id: string
  label: string
  module: string | null
  cards: Card[]
  shortcuts: { label: string; type?: string; link_to: string }[]
}

async function pages(client: TestClient): Promise<Page[]> {
  return (await client.get<{ pages: Page[] }>('/api/home_pages')).pages
}

const DT = 'HP Widget'
const ROLE = 'HP Viewer Role'

async function makeTable(admin: TestClient, name = DT, module = 'HP Mod') {
  await admin.post('/api/table_def', {
    name,
    module,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
}

describe('GET /api/home_pages: role scoping', () => {
  test('a page with an empty roles list is visible to everyone', async ({
    admin,
    createUser,
  }) => {
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: { row_id: 'hp-open', label: 'Open Page' },
    })
    const user = await createUser({ roles: [] })
    expect((await pages(user)).map((p) => p.row_id)).toContain('hp-open')
  })

  test('a role-restricted page is visible only to holders of one of its roles', async ({
    admin,
    createUser,
  }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: { row_id: 'hp-scoped', label: 'Scoped Page', roles: [{ role: ROLE }] },
    })
    const outsider = await createUser({ roles: [] })
    expect((await pages(outsider)).map((p) => p.row_id)).not.toContain('hp-scoped')
    const holder = await createUser({ roles: [ROLE] })
    expect((await pages(holder)).map((p) => p.row_id)).toContain('hp-scoped')
  })

  test('Administrator always sees every page, role-restricted or not', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: { row_id: 'hp-scoped', label: 'Scoped Page', roles: [{ role: ROLE }] },
    })
    const names = (await pages(admin)).map((p) => p.row_id)
    expect(names).toContain('hp-scoped')
    expect(names).toContain('system')
  })

  test('pages come ordered: module pages before the System page', async ({ admin }) => {
    await makeTable(admin)
    const names = (await pages(admin)).map((p) => p.row_id)
    expect(names.indexOf('hp-mod')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('hp-mod')).toBeLessThan(names.indexOf('system'))
  })
})

describe('Pages are listed Home first, the System page last', () => {
  test('the general Home page comes first, then module pages, then System', async ({ admin }) => {
    await makeTable(admin, 'HP Zone', 'Core')
    await makeTable(admin)
    const names = (await pages(admin)).map((p) => p.row_id)
    expect(names.indexOf('home')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('home')).toBeLessThan(names.indexOf('hp-mod'))
    expect(names.indexOf('hp-mod')).toBeLessThan(names.indexOf('system'))
  })
})

describe('GET /api/home_pages: link permission filtering', () => {
  test('a link to a sub-table, which has no list of its own, is left out', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'HP Child Row', module: 'Warehouse', kind: 'sub_table',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'hp-sub', label: 'Sub Link Page' } })
    await sql`insert into home_page_link ${sql({
      row_id: 'hp-sub-link', parent: 'hp-sub', parenttype: 'Home Page', parentfield: 'links',
      position: 1, label: 'Rows', type: 'Link', link_to: 'HP Child Row',
    })}`
    const page = (await pages(admin)).find((p) => p.row_id === 'hp-sub')!
    expect(page.cards).toEqual([])
  })

  test('a user who cannot read a Table does not see its link (Frappe is_item_allowed)', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await grantRole(admin, { table: DT, role: ROLE, can_read: true })
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: {
        row_id: 'hp-links',
        label: 'Links Page',
        links: [
          { label: 'Stuff', type: 'Card Break' },
          { label: 'Widgets', type: 'Link', link_to: DT },
          { label: 'People', type: 'Link', link_to: 'Person' },
        ],
      },
    })
    const user = await createUser({ roles: [ROLE] })
    const page = (await pages(user)).find((p) => p.row_id === 'hp-links')!
    expect(page.cards).toEqual([
      { label: 'Stuff', links: [{ label: 'Widgets', link_to: DT }] },
    ])
    // Administrator sees both links.
    const adminPage = (await pages(admin)).find((p) => p.row_id === 'hp-links')!
    expect(adminPage.cards[0].links.map((l) => l.link_to)).toEqual([DT, 'Person'])
  })

  test('a card whose links are all filtered out is dropped, the page survives', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: {
        row_id: 'hp-empty',
        label: 'Empty For Some',
        links: [
          { label: 'Secret', type: 'Card Break' },
          { label: 'Widgets', type: 'Link', link_to: DT },
        ],
      },
    })
    const user = await createUser({ roles: [] })
    const page = (await pages(user)).find((p) => p.row_id === 'hp-empty')
    expect(page).toMatchObject({ row_id: 'hp-empty', label: 'Empty For Some' })
    expect(page!.cards).toEqual([])
  })

  test('a link to a table that no longer exists is filtered, not broken', async ({ admin }) => {
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: { row_id: 'hp-dead', label: 'Dead Link Page' },
    })
    // Simulate a table dropped after being linked (e.g. app uninstall) —
    // the Reference validation forbids saving this shape over the API.
    await sql`insert into home_page_link ${sql({
      row_id: 'hp-dead-link',
      parent: 'hp-dead',
      parenttype: 'Home Page',
      parentfield: 'links',
      position: 1,
      label: 'Ghost',
      type: 'Link',
      link_to: 'Ghost Table',
    })}`
    const page = (await pages(admin)).find((p) => p.row_id === 'hp-dead')!
    expect(page.cards).toEqual([])
  })

  test('legacy table shortcuts get the same read filter; url/dashboard pass through', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_row', {
      table: 'Home Page',
      row: {
        row_id: 'hp-legacy',
        label: 'Legacy Page',
        shortcuts: JSON.stringify([
          { label: 'Widgets', type: 'table', link_to: DT },
          { label: 'Docs', type: 'url', link_to: 'https://example.com' },
        ]),
      },
    })
    const user = await createUser({ roles: [] })
    const page = (await pages(user)).find((p) => p.row_id === 'hp-legacy')!
    expect(page.shortcuts.map((s) => s.label)).toEqual(['Docs'])
    const adminPage = (await pages(admin)).find((p) => p.row_id === 'hp-legacy')!
    expect(adminPage.shortcuts.map((s) => s.label)).toEqual(['Widgets', 'Docs'])
  })
})

describe('auto-membership: a built table never vanishes from navigation', () => {
  test('creating a table creates its module page on demand and links the table', async ({
    admin,
  }) => {
    await makeTable(admin, 'HP Crate', 'Warehouse')
    const page = (await pages(admin)).find((p) => p.module === 'Warehouse')
    expect(page).toMatchObject({ module: 'Warehouse' })
    expect(page!.row_id).toBe('warehouse')
    expect(page!.label).toBe('Warehouse')
    expect(page!.cards.flatMap((c) => c.links.map((l) => l.link_to))).toContain('HP Crate')
  })

  test('a second table in the same module appends to the same page', async ({ admin }) => {
    await makeTable(admin, 'HP Crate', 'Warehouse')
    await makeTable(admin, 'HP Pallet', 'Warehouse')
    const all = await pages(admin)
    const warehousePages = all.filter((p) => p.module === 'Warehouse')
    expect(warehousePages).toHaveLength(1)
    expect(warehousePages[0].cards.flatMap((c) => c.links.map((l) => l.link_to))).toEqual([
      'HP Crate',
      'HP Pallet',
    ])
  })

  test("a user table filed under 'Core' lands on the 'Home' page", async ({ admin }) => {
    await makeTable(admin, 'HP Zone', 'Core')
    const page = (await pages(admin)).find((p) => p.row_id === 'home')
    expect(page).toMatchObject({ row_id: 'home' })
    expect(page!.label).toBe('Home')
    expect(page!.cards.flatMap((c) => c.links.map((l) => l.link_to))).toContain('HP Zone')
  })

  test('sub-tables get no navigation entry', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'HP Child Row',
      module: 'Warehouse',
      kind: 'sub_table',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const page = (await pages(admin)).find((p) => p.module === 'Warehouse')
    expect(page).toBeUndefined()
  })
})

describe('module pages never collide with the System page', () => {
  test('a user module named System gets its own page, not the platform one', async ({ admin }) => {
    await makeTable(admin, 'HP Sys Thing', 'System')
    const all = await pages(admin)
    const mine = all.find((p) => p.module === 'System')!
    expect(mine.row_id).not.toBe('system')
    expect(mine.cards.flatMap((c) => c.links.map((l) => l.link_to))).toContain('HP Sys Thing')
    expect(all.find((p) => p.row_id === 'system')!.module).toBeNull()
  })

  test('a home page whose shortcuts are unreadable still opens, with no shortcuts', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'hp-bad-shortcuts', label: 'Bad Shortcuts' } })
    await sql`update home_page set shortcuts = ${'{not json'} where row_id = 'hp-bad-shortcuts'`
    const page = (await pages(admin)).find((p) => p.row_id === 'hp-bad-shortcuts')!
    expect(page.shortcuts).toEqual([])
  })
})

describe('System membership comes from the current catalogue', () => {
  test('every standalone system Table appears exactly once', async ({ admin }) => {
    const catalogue = await sql`select name from table_def where system and kind != 'sub_table'`
    const system = (await pages(admin)).find((p) => p.row_id === 'system')!
    expect(system.cards.flatMap((c) => c.links.map((l) => l.link_to)).sort())
      .toEqual(catalogue.map((t) => t.name).sort())
  })

  test('an unlinked system Table appears on the next fetch', async ({ admin }) => {
    await pages(admin)
    await createTable({ name: 'HP New Engine', system: true, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const system = (await pages(admin)).find((p) => p.row_id === 'system')!
    expect(system.cards.find((c) => c.label === 'Platform')!.links)
      .toContainEqual({ label: 'HP New Engine', link_to: 'HP New Engine' })
    expect(await sql`select 1 from home_page_link where link_to = 'HP New Engine'`).toHaveLength(0)
  })

  test('missing placement hints fall back to one name-ordered Platform card', async ({ admin }) => {
    await sql`delete from home_page_link where parent = 'system' and parenttype = 'Home Page'`
    const catalogue = await sql`select name from table_def where system and kind != 'sub_table'`
    const names = catalogue.map((t) => String(t.name)).sort()
    const system = (await pages(admin)).find((p) => p.row_id === 'system')!
    expect(system.cards).toEqual([
      { label: 'Platform', links: names.map((name) => ({ label: name, link_to: name })) },
    ])
  })

  test('placement hints cannot change eligible membership', async ({ admin }) => {
    await createTable({ name: 'HP Not Engine', columns: [{ column_name: 'title', column_type: 'Data' }] })
    const before = await sql`select label from home_page_link
      where parent = 'system' and type = 'Card Break' order by position, row_id`
    for (const [i, target] of ['Person', 'HP Not Engine', 'Column', 'HP Gone'].entries()) {
      await sql`insert into home_page_link ${sql({
        row_id: `hp-system-hint-${i}`, parent: 'system', parenttype: 'Home Page', parentfield: 'links',
        position: 100 + i, label: 'Stale label', type: 'Link', link_to: target,
      })}`
    }
    const system = (await pages(admin)).find((p) => p.row_id === 'system')!
    expect(system.cards.map((c) => c.label)).toEqual(before.map((c) => c.label))
    expect(system.cards[0].links.filter((l) => l.link_to === 'Person'))
      .toEqual([{ label: 'Person', link_to: 'Person' }])
    const catalogue = await sql`select name from table_def where system and kind != 'sub_table'`
    expect(system.cards.flatMap((c) => c.links.map((l) => l.link_to)).sort())
      .toEqual(catalogue.map((t) => t.name).sort())
    const platform = system.cards.find((c) => c.label === 'Platform')!
    const unplaced = platform.links.filter((l) => ['Data Source', 'Sign In Method', 'App Setting'].includes(l.link_to))
    expect(unplaced.map((l) => l.link_to)).toEqual(['App Setting', 'Data Source', 'Sign In Method'])
  })

  test('a legacy disallowed override leaves System navigation available', async ({ admin }) => {
    // Persisted before the allowlist: cover hinted/discovered links and both
    // override scopes, including #774's permitted-properties diagnostic suffix.
    for (const name of ['Person', 'Sign In Method']) {
      await sql`insert into metadata_override ${sql({
        row_id: `hp-legacy-${name}`, table_name: name,
        column_name: name === 'Person' ? 'email' : null, property: 'system', value: 'false',
      })}`
      invalidateMeta(name)
    }
    const system = (await pages(admin)).find((p) => p.row_id === 'system')!
    const links = system.cards.flatMap((c) => c.links)
    expect(links).toContainEqual({ label: 'Person', link_to: 'Person' })
    expect(links).toContainEqual({ label: 'Sign In Method', link_to: 'Sign In Method' })
    // Navigation resilience does not relax the metadata validation policy.
    await expectStatus(await admin.fetch('/api/table/Person:meta'), 417)
  })

  test('System label resolution preserves unrelated metadata refusals', async ({ admin }) => {
    // Migration-owned settings metadata remains while its namespace is unavailable.
    // This is not an app-manifest fixture: apps cannot declare system Tables.
    await sql`insert into table_def ${sql({
      name: 'hp_unavailable.Settings', kind: 'settings', system: true, label: 'Unavailable settings',
    })}`
    const response = await admin.fetch('/api/home_pages')
    await expectStatus(response, 403)
    expect(await response.json()).toEqual({ error: {
      type: 'PermissionError', message: 'App hp_unavailable is disabled or unavailable',
    } })
  })

  test('generated links use effective labels after the viewer passes visibility checks', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await grantRole(admin, { table: 'Sign In Method', role: ROLE, can_read: true, own_rows_only: true })
    await grantRole(admin, { table: 'Person', role: ROLE, can_read: true })
    await admin.post('/api/table/Metadata%20Override', {
      row_id: 'hp-sign-in-label', table_name: 'Sign In Method', property: 'label', value: 'Sign-in providers',
    })
    await admin.post('/api/table/Metadata%20Override', {
      row_id: 'hp-person-label', table_name: 'Person', property: 'label', value: 'People',
    })
    const reader = await createUser({ roles: [ROLE] })
    const system = (await pages(reader)).find((p) => p.row_id === 'system')!
    expect(system.cards).toEqual([
      { label: 'Users & Access', links: [{ label: 'People', link_to: 'Person' }] },
      { label: 'Platform', links: [
        { label: 'Glossary Term', link_to: 'Glossary Term' },
        { label: 'Sign-in providers', link_to: 'Sign In Method' },
      ] },
    ])
    // No read grant on Table or Home Page is required. Page roles still apply.
    await sql`insert into home_page_role ${sql({
      row_id: 'hp-system-role', parent: 'system', parenttype: 'Home Page', parentfield: 'roles', role: 'System Manager',
    })}`
    expect((await pages(reader)).some((p) => p.row_id === 'system')).toBe(false)
    const manager = await createUser({ roles: ['System Manager'] })
    expect((await pages(manager)).find((p) => p.row_id === 'system')!.cards.flatMap((c) => c.links))
      .toContainEqual({ label: 'Sign-in providers', link_to: 'Sign In Method' })
    expect((await pages(admin)).some((p) => p.row_id === 'system')).toBe(true)
  })
})
