// #80: Home Pages — curated navigation. GET /api/home_pages is the sidebar's
// single source: role visibility (presentation scoping, NOT a security
// boundary) and link permission-filtering are computed here, server-side.
// Auto-membership keeps every built table reachable, and the 0060 seeds are
// idempotent.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { up as homePagesUp } from '../migrations/0060_home_pages'

interface Card {
  label: string | null
  links: { label: string; link_to: string }[]
}
interface Page {
  name: string
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
  await admin.post('/api/doctype', {
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
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: { name: 'hp-open', label: 'Open Page' },
    })
    const user = await createUser({ roles: [] })
    expect((await pages(user)).map((p) => p.name)).toContain('hp-open')
  })

  test('a role-restricted page is visible only to holders of one of its roles', async ({
    admin,
    createUser,
  }) => {
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: { name: 'hp-scoped', label: 'Scoped Page', roles: [{ role: ROLE }] },
    })
    const outsider = await createUser({ roles: [] })
    expect((await pages(outsider)).map((p) => p.name)).not.toContain('hp-scoped')
    const holder = await createUser({ roles: [ROLE] })
    expect((await pages(holder)).map((p) => p.name)).toContain('hp-scoped')
  })

  test('Administrator always sees every page, role-restricted or not', async ({ admin }) => {
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: { name: 'hp-scoped', label: 'Scoped Page', roles: [{ role: ROLE }] },
    })
    const names = (await pages(admin)).map((p) => p.name)
    expect(names).toContain('hp-scoped')
    expect(names).toContain('system')
  })

  test('pages come ordered: module pages before the System page', async ({ admin }) => {
    await makeTable(admin)
    const names = (await pages(admin)).map((p) => p.name)
    expect(names.indexOf('hp-mod')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('hp-mod')).toBeLessThan(names.indexOf('system'))
  })
})

describe('GET /api/home_pages: link permission filtering', () => {
  test('a user who cannot read a Table does not see its link (Frappe is_item_allowed)', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: ROLE, can_read: true },
    })
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: {
        name: 'hp-links',
        label: 'Links Page',
        links: [
          { label: 'Stuff', type: 'Card Break' },
          { label: 'Widgets', type: 'Link', link_to: DT },
          { label: 'Users', type: 'Link', link_to: 'User' },
        ],
      },
    })
    const user = await createUser({ roles: [ROLE] })
    const page = (await pages(user)).find((p) => p.name === 'hp-links')!
    expect(page.cards).toEqual([
      { label: 'Stuff', links: [{ label: 'Widgets', link_to: DT }] },
    ])
    // Administrator sees both links.
    const adminPage = (await pages(admin)).find((p) => p.name === 'hp-links')!
    expect(adminPage.cards[0].links.map((l) => l.link_to)).toEqual([DT, 'User'])
  })

  test('a card whose links are all filtered out is dropped, the page survives', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: {
        name: 'hp-empty',
        label: 'Empty For Some',
        links: [
          { label: 'Secret', type: 'Card Break' },
          { label: 'Widgets', type: 'Link', link_to: DT },
        ],
      },
    })
    const user = await createUser({ roles: [] })
    const page = (await pages(user)).find((p) => p.name === 'hp-empty')
    expect(page).toBeDefined()
    expect(page!.cards).toEqual([])
  })

  test('a link to a table that no longer exists is filtered, not broken', async ({ admin }) => {
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: { name: 'hp-dead', label: 'Dead Link Page' },
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
    const page = (await pages(admin)).find((p) => p.name === 'hp-dead')!
    expect(page.cards).toEqual([])
  })

  test('legacy doctype shortcuts get the same read filter; url/dashboard pass through', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Home Page',
      doc: {
        name: 'hp-legacy',
        label: 'Legacy Page',
        shortcuts: JSON.stringify([
          { label: 'Widgets', type: 'doctype', link_to: DT },
          { label: 'Docs', type: 'url', link_to: 'https://example.com' },
        ]),
      },
    })
    const user = await createUser({ roles: [] })
    const page = (await pages(user)).find((p) => p.name === 'hp-legacy')!
    expect(page.shortcuts.map((s) => s.label)).toEqual(['Docs'])
    const adminPage = (await pages(admin)).find((p) => p.name === 'hp-legacy')!
    expect(adminPage.shortcuts.map((s) => s.label)).toEqual(['Widgets', 'Docs'])
  })
})

describe('auto-membership: a built table never vanishes from navigation', () => {
  test('creating a table creates its module page on demand and links the table', async ({
    admin,
  }) => {
    await makeTable(admin, 'HP Crate', 'Warehouse')
    const page = (await pages(admin)).find((p) => p.module === 'Warehouse')
    expect(page).toBeDefined()
    expect(page!.name).toBe('warehouse')
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
    const page = (await pages(admin)).find((p) => p.name === 'home')
    expect(page).toBeDefined()
    expect(page!.label).toBe('Home')
    expect(page!.cards.flatMap((c) => c.links.map((l) => l.link_to))).toContain('HP Zone')
  })

  test('sub-tables get no navigation entry', async ({ admin }) => {
    await admin.post('/api/doctype', {
      name: 'HP Child Row',
      module: 'Warehouse',
      kind: 'sub_table',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const page = (await pages(admin)).find((p) => p.module === 'Warehouse')
    expect(page).toBeUndefined()
  })
})

describe('0060 seeds are idempotent', () => {
  test('re-running the migration duplicates nothing', async ({ admin }) => {
    const before = await pages(admin)
    const beforeLinks = await sql`
      select count(*)::int as n from home_page_link where parent = 'system'`
    await homePagesUp()
    await homePagesUp()
    const after = await pages(admin)
    const afterLinks = await sql`
      select count(*)::int as n from home_page_link where parent = 'system'`
    expect(after.map((p) => p.name)).toEqual(before.map((p) => p.name))
    expect(Number(afterLinks[0].n)).toBe(Number(beforeLinks[0].n))
  })

  test('an emptied System page is reseeded with grouped cards', async ({ admin }) => {
    await sql`delete from home_page_link where parent = 'system'`
    await sql`delete from home_page where row_id = 'system'`
    await homePagesUp()
    const system = (await pages(admin)).find((p) => p.name === 'system')!
    expect(system.cards.map((c) => c.label)).toEqual([
      'Users & Access',
      'Automation',
      'Email',
      'Reports & Dashboards',
      'Website',
      'Platform',
    ])
    // Every non-sub-table platform table has exactly one link on the page.
    const linked = system.cards.flatMap((c) => c.links.map((l) => l.link_to))
    const engine = await sql`
      select name from table_def where system = true and kind in ('table', 'settings')`
    expect(new Set(linked)).toEqual(new Set(engine.map((r) => String(r.name))))
    expect(linked.length).toBe(engine.length)
  })
})
