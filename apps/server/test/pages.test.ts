// #1410: pages below the scenarios (test/scenarios/runtime-pages.test.ts):
// who may open one, what the save check adds to the shared checker, and the
// page tools of /mcp.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { PAGE_EXAMPLE, type PagePart } from 'shared'
import { test } from './pg-test'
import { expectRefused, makeTable, patchDoc } from './fixtures'
import { connectAgent, issueToken } from './agent-driver'

const PAGE = '/api/table/Page'
type Opened = { name: string; title: string; module: string; status: string; description: string | null; definition: { components: PagePart[] }; updated_at: string }
type Listing = { pages: { name: string; title: string; module: string; status: string }[] }
type Home = { pages: { row_id: string; label: string; module: string | null; pages: { name: string; title: string; status: string }[] }[] }

const definition = (parts: PagePart[] = [{ id: 'hello', component: 'Text', text: 'What to reorder next month' }], more: Record<string, unknown> = {}) => ({
  version: '1.0',
  components: [{ id: 'root', component: 'Page', title: 'Reorder Plan', children: parts.map((part) => part.id) }, ...parts],
  ...more,
})
const page = (name: string, more: Record<string, unknown> = {}) => ({ row_id: name, title: 'Reorder Plan', module: 'Reorder', definition: definition(), ...more })
const fieldsOf = async (call: Promise<unknown>) => ((await expectRefused(call, 417)) as unknown as { fields: Record<string, string> }).fields
const reorderLine = (admin: TestClient) =>
  makeTable(admin, { name: 'Reorder Line', module: 'Reorder', columns: ['item', 'category', 'month', 'sold_qty:Int', 'sold_value:Int', 'returned_qty:Int', 'returned_value:Int', 'suggested_qty:Int', 'suggested_value:Int', 'planned_qty:Int'] })
const text = (result: { content: { text: string }[] }) => result.content.map((c) => c.text).join('\n')

describe('#1410 who may open a page', () => {
  test('a Published page opens for anyone signed in; a Draft only for someone who may build, and is otherwise not there', async ({ admin, createUser }) => {
    await admin.post(PAGE, page('reorder-plan', { status: 'Published', description: 'Next month, by category' }))
    await admin.post(PAGE, page('reorder-draft', { title: 'Reorder Draft' }))
    const viewer = await createUser()

    expect(await viewer.get<Opened>('/api/pages/reorder-plan')).toMatchObject({
      name: 'reorder-plan', title: 'Reorder Plan', module: 'Reorder', status: 'Published', description: 'Next month, by category',
      definition: { version: '1.0', components: [{ id: 'root' }, { id: 'hello' }] },
    })
    await expectRefused(viewer.get('/api/pages/reorder-draft'), 404, 'There is no page "reorder-draft"')
    await expectRefused(viewer.get('/api/pages/nowhere'), 404, 'There is no page "nowhere"')
    await expectRefused(admin.get('/api/pages/nowhere'), 404, 'There is no page "nowhere"')
    expect((await admin.get<Opened>('/api/pages/reorder-draft')).status).toBe('Draft')

    expect((await viewer.get<Listing>('/api/pages')).pages).toEqual([{ name: 'reorder-plan', title: 'Reorder Plan', module: 'Reorder', status: 'Published', description: 'Next month, by category' }])
    expect((await admin.get<Listing>('/api/pages')).pages.map((p) => [p.name, p.status])).toEqual([['reorder-draft', 'Draft'], ['reorder-plan', 'Published']])
  })

  test('the Page Table itself stays closed: a viewer reads no row of it, published or not', async ({ admin, createUser }) => {
    await admin.post(PAGE, page('reorder-plan', { status: 'Published' }))
    const viewer = await createUser()
    await expectRefused(viewer.get(`${PAGE}/reorder-plan`), 403)
    await expectRefused(viewer.get(PAGE), 403)
  })

  test('a retired page is not there, and is in nobody\'s list', async ({ admin }) => {
    await admin.post(PAGE, page('reorder-plan', { status: 'Published' }))
    await admin.post(`${PAGE}/reorder-plan:retire`, { reason: 'replaced' })
    await expectRefused(admin.get('/api/pages/reorder-plan'), 404)
    expect((await admin.get<Listing>('/api/pages')).pages).toEqual([])
  })

  test('the version a page is opened with is the one its save takes', async ({ admin }) => {
    await admin.post(PAGE, page('reorder-plan'))
    const opened = await admin.get<Opened>('/api/pages/reorder-plan')
    await patchDoc(admin, `${PAGE}/reorder-plan`, { status: 'Published', updated_at: opened.updated_at })
    expect((await admin.get<Opened>('/api/pages/reorder-plan'))).toMatchObject({ status: 'Published', definition: { components: [{ id: 'root' }, { id: 'hello' }] } })
    await expectRefused(patchDoc(admin, `${PAGE}/reorder-plan`, { title: 'Stale', updated_at: opened.updated_at }), 409, 'has been modified after you loaded it')
  })

  test('anyone signed in reads what a page can be made of', async ({ createUser }) => {
    const catalog = await (await createUser()).get<{ parts: Record<string, unknown>; version: string }>('/api/page_catalog')
    expect(catalog.version).toBe('1.0')
    expect(Object.keys(catalog.parts)).toContain('Table')
  })
})

describe('#1410 a module\'s home page lists its pages', () => {
  test('beside its Tables: Published pages for everyone, Drafts too for someone who may build', async ({ admin, createUser }) => {
    await reorderLine(admin)
    await admin.post(PAGE, page('reorder-plan', { status: 'Published' }))
    await admin.post(PAGE, page('reorder-draft', { title: 'Reorder Draft' }))
    await admin.post(PAGE, page('elsewhere', { title: 'Elsewhere', module: 'Stock', status: 'Published' }))
    const group = async (client: TestClient, module: string) => (await client.get<Home>('/api/home_pages')).pages.find((p) => p.module === module)

    expect((await group(admin, 'Reorder'))?.pages).toEqual([{ name: 'reorder-draft', title: 'Reorder Draft', status: 'Draft' }, { name: 'reorder-plan', title: 'Reorder Plan', status: 'Published' }])
    expect((await group(await createUser(), 'Reorder'))?.pages).toEqual([{ name: 'reorder-plan', title: 'Reorder Plan', status: 'Published' }])
    // A module that holds only a page still gets its home page, so the page is never lost from navigation.
    expect(await group(admin, 'Stock')).toMatchObject({ label: 'Stock', pages: [{ name: 'elsewhere', title: 'Elsewhere', status: 'Published' }] })
    // Every home page says which pages it has, even when it has none.
    expect((await admin.get<Home>('/api/home_pages')).pages.filter((p) => p.module !== 'Reorder' && p.module !== 'Stock').every((p) => p.pages.length === 0)).toBe(true)
  })

  test('deleting a page leaves its module\'s home page as it is', async ({ admin }) => {
    await admin.post(PAGE, page('reorder-plan'))
    await admin.delete(`${PAGE}/reorder-plan`)
    const homes = (await admin.get<Home>('/api/home_pages')).pages
    expect(homes.filter((p) => p.module === 'Reorder')).toHaveLength(1)
    expect(homes.some((p) => p.label === 'undefined')).toBe(false)
  })
})

describe('#1410 what the save check adds', () => {
  test('a name that is not an address, a module that is the platform\'s own, and a definition that is not JSON are each named', async ({ admin }) => {
    expect(await fieldsOf(admin.post(PAGE, page('Reorder Plan', { module: 'System', definition: '{"version":' })))).toEqual({
      row_id: 'A page\'s name is its address: lower-case words joined by hyphens, such as "reorder-plan"',
      module: '"System" is the platform\'s own module. Put this page in another module.',
      definition: 'The definition is not valid JSON',
    })
  })

  test('a definition that arrives as text is stored as the object it is', async ({ admin }) => {
    await admin.post(PAGE, page('reorder-plan', { definition: JSON.stringify(definition()) }))
    expect((await admin.get<Opened>('/api/pages/reorder-plan')).definition.components.map((part) => part.id)).toEqual(['root', 'hello'])
  })

  test('the worked example is right once its Table is there, and wrong without it', async ({ admin }) => {
    expect(await fieldsOf(admin.post(PAGE, page('reorder-plan', { definition: PAGE_EXAMPLE })))).toEqual({
      'data.lines.table': 'There is no Table "Reorder Line"',
      'components.plan_save.action.event.context.table': 'There is no Table "Reorder Line"',
      'components.plan_accept.action.event.context.table': 'There is no Table "Reorder Line"',
    })
    await reorderLine(admin)
    await admin.post(PAGE, page('reorder-plan', { definition: PAGE_EXAMPLE }))
    expect((await admin.get<Opened>('/api/pages/reorder-plan')).definition.components).toHaveLength(PAGE_EXAMPLE.components.length)
  })

  test('a column a page filters by, orders by or writes that the Table does not have is named where it is used', async ({ admin }) => {
    await reorderLine(admin)
    const button: PagePart = { id: 'go', component: 'Button', label: 'Add', action: { event: { name: 'create_row', context: { table: 'Reorder Line', values: { item: 'Notebook A5', planed_qty: 760 } } } } }
    const data = { lines: { table: 'Reorder Line', filters: [['mnth', '=', '2026-12']], order_by: 'catgory asc', columns: ['item', 'row_id', 'updated_at', 'created_at'] } }
    expect(await fieldsOf(admin.post(PAGE, page('reorder-plan', { definition: definition([button], { data }) })))).toEqual({
      'data.lines.filters.0': '"Reorder Line" has no column "mnth"',
      'data.lines.order_by': '"Reorder Line" has no column "catgory"',
      'components.go.action.event.context.values.planed_qty': '"Reorder Line" has no column "planed_qty"',
    })
  })

  test('changing only a page\'s status checks the definition it already has', async ({ admin }) => {
    await reorderLine(admin)
    await admin.post(PAGE, page('reorder-plan', { definition: PAGE_EXAMPLE }))
    const { updated_at } = await admin.get<Opened>('/api/pages/reorder-plan')
    expect(await patchDoc(admin, `${PAGE}/reorder-plan`, { status: 'Published', updated_at })).toMatchObject({ status: 'Published' })
  })
})

describe('#1410 the page tools of /mcp', () => {
  test('an agent lists the pages its person may open, and reads one', async ({ admin, createUser }) => {
    await admin.post(PAGE, page('reorder-plan', { status: 'Published' }))
    await admin.post(PAGE, page('reorder-draft', { title: 'Reorder Draft' }))
    const viewer = await connectAgent(await issueToken(await createUser()))
    expect((await viewer.ok<Listing>('list_pages')).pages.map((p) => p.name)).toEqual(['reorder-plan'])
    expect(await viewer.ok<Opened>('get_page', { name: 'reorder-plan' })).toMatchObject({ title: 'Reorder Plan', definition: { version: '1.0' } })
    const hidden = await viewer.call('get_page', { name: 'reorder-draft' })
    expect(hidden.isError).toBe(true)
    expect(text(hidden)).toBe('NotFoundError: There is no page "reorder-draft"')
  })

  test('save_page changes a page that exists only with the version get_page gave, and only what it names', async ({ admin, createUser }) => {
    const agent = await connectAgent(await issueToken(await createUser({ roles: ['System Manager'] })))
    await agent.ok('save_page', { name: 'reorder-plan', title: 'Reorder Plan', module: 'Reorder', description: 'Next month', definition: definition() })

    const blind = await agent.call('save_page', { name: 'reorder-plan', status: 'Published' })
    expect(text(blind)).toBe('ValidationError: This page exists. Read it first (get_page) and pass the updated_at it gave')

    const { updated_at } = await agent.ok<Opened>('get_page', { name: 'reorder-plan' })
    expect(await agent.ok('save_page', { name: 'reorder-plan', status: 'Published', updated_at })).toMatchObject({ name: 'reorder-plan', address: '/featherbase/admin/page/reorder-plan', title: 'Reorder Plan', module: 'Reorder', status: 'Published' })
    expect(await admin.get<Opened>('/api/pages/reorder-plan')).toMatchObject({ description: 'Next month', status: 'Published' })

    const stale = await agent.call('save_page', { name: 'reorder-plan', title: 'Stale', updated_at })
    expect(text(stale)).toMatch(/^ConflictError: Page reorder-plan has been modified after you loaded it/)
  })

  test('a wrong page is refused with one line per mistake, each saying where it is, and nothing is saved', async ({ admin, createUser }) => {
    const agent = await connectAgent(await issueToken(await createUser({ roles: ['System Manager'] })))
    const refused = await agent.call('save_page', { name: 'reorder-plan', title: 'Reorder Plan', definition: definition([{ id: 'spark', component: 'Sparkline' }, { id: 'hello', component: 'Text', text: 'Hello', varient: 'heading' }]) })
    expect(refused.isError).toBe(true)
    expect(text(refused).split('\n')).toEqual([
      'ValidationError: The page has 2 mistakes. Nothing was saved.',
      'components.spark.component: There is no part "Sparkline". The parts are: Page, Stack, Row, Text, Notice, RecordLink, Table, Toggle, Input, Button',
      'components.hello.varient: Text has no setting "varient". Its settings: text, variant',
    ])
    expect((await admin.get<Listing>('/api/pages')).pages).toEqual([])
  })

  test('adding a row whose id is taken tells someone who may not add rows only that, never that the id is in use', async ({ admin, createUser }) => {
    await admin.post(PAGE, page('reorder-plan'))
    const viewer = await createUser()
    await expectRefused(viewer.post(PAGE, page('reorder-plan')), 403)
    await expectRefused(viewer.post(PAGE, page('another-plan')), 403)
    await expectRefused(admin.post(PAGE, page('reorder-plan')), 409, 'Page reorder-plan already exists')
  })

  test('an agent whose person may not build is refused, whether or not a Draft of that name exists', async ({ admin, createUser }) => {
    await admin.post(PAGE, page('reorder-plan'))
    const agent = await connectAgent(await issueToken(await createUser()))
    for (const name of ['reorder-plan', 'another-plan']) {
      const refused = await agent.call('save_page', { name, title: 'Reorder Plan', definition: definition() })
      expect(refused.isError).toBe(true)
      expect(text(refused)).toMatch(/^PermissionError: /)
    }
    expect((await admin.get<Listing>('/api/pages')).pages.map((p) => p.name)).toEqual(['reorder-plan'])
  })
})
