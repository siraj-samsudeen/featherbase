// runtime-pages' scenarios a person reads on screen (#1410). Each test is one
// fenced scenario of the runtime-pages spec, step by step, rendered in jsdom
// against the real in-process server; the rest (who may save, what a wrong
// page is told, an agent) are in apps/server/test/scenarios/. Made-up data: a
// shop that plans next month's reorder.
import { screen, within } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { PAGE_EXAMPLE, pageHref, type PageDefinition, type PagePart } from 'shared'
import { scenarioFor } from 'server/test/scenario'
import { grantRole, makeTable, tableRef } from 'server/test/fixtures'
import { test, expect, renderSession } from '../pg-test'

const scenario = scenarioFor(test, 'runtime-pages')

const PAGE = 'reorder-plan'
const LINE = tableRef('Reorder Line')
type Line = { row_id: string; item: string; planned_qty: number | null }
type CreateUser = (opts?: { roles?: string[] }) => Promise<TestClient>

/** A definition: the heading "Reorder Plan" over `children`, with `parts` to draw them from. */
const definition = (children: string[], parts: PagePart[], more: Partial<PageDefinition> = {}): PageDefinition => ({
  version: '1.0',
  components: [{ id: 'root', component: 'Page', title: 'Reorder Plan', children }, ...parts],
  ...more,
})
/** A part of the worked example every agent reads (shared PAGE_EXAMPLE). */
const example = (id: string) => PAGE_EXAMPLE.components.find((part) => part.id === id)!
/** The worked example, headed "Reorder Plan": sold as a quantity or a value, grouped by category, with a plan to save. */
const WORKED_EXAMPLE: PageDefinition = {
  ...PAGE_EXAMPLE,
  components: PAGE_EXAMPLE.components.map((part) => (part.id === 'root' ? { ...part, title: 'Reorder Plan' } : part)),
}
const LINES = { lines: { table: 'Reorder Line', order_by: 'item asc' } }
/** A plain list of the lines: each item as a link, and what was sold. */
const LIST_PARTS: PagePart[] = [
  {
    id: 'plan', component: 'Table', caption: 'Reorder plan', rows: { '@path': '/data/lines' },
    columns: [{ id: 'item', header: 'Item', cell: 'item_link' }, { id: 'sold', header: 'Sold', align: 'end', format: 'number', value: { '@path': 'sold_qty' } }],
  },
  example('item_link'),
]
const LIST = definition(['plan'], LIST_PARTS, { data: LINES })

const savePage = (admin: TestClient, def: PageDefinition, status: 'Draft' | 'Published' = 'Published') =>
  admin.post('/api/table/Page', { row_id: PAGE, title: 'Reorder Plan', module: 'Reorder', status, definition: def })
const open = (as: TestClient, address = pageHref(PAGE)) => renderSession(address, as)

/** The Table "Reorder Line" with December's lines: Stationery is Notebook A5 and Gel Pen. */
async function reorderLines(admin: TestClient): Promise<Record<string, string>> {
  await makeTable(admin, {
    name: 'Reorder Line', module: 'Reorder', title_column: 'item',
    columns: ['item', 'category', 'month', 'sold_qty:Int', 'sold_value:Int', 'returned_qty:Int', 'returned_value:Int', 'suggested_qty:Int', 'suggested_value:Int', 'planned_qty:Int'],
  })
  const ids: Record<string, string> = {}
  for (const [item, category, sold_qty, sold_value, suggested_qty] of [
    ['Notebook A5', 'Stationery', 820, 16400, 760],
    ['Gel Pen', 'Stationery', 690, 6900, 640],
    ['Salted Crisps', 'Snacks', 300, 9000, 320],
  ] as const)
    ids[item] = (await admin.post<Line>(LINE.url, { item, category, month: '2026-12', sold_qty, sold_value, returned_qty: 10, returned_value: 200, suggested_qty, suggested_value: suggested_qty * 20 })).row_id
  return ids
}
const planned = async (admin: TestClient, id: string) => (await admin.get<Line>(LINE.rowUrl(id))).planned_qty

/** Someone who can use the Admin and nothing more than `grants` says: a viewer, who may not build Tables. */
async function viewer(admin: TestClient, createUser: CreateUser, grants: Record<string, unknown> & { table: string }): Promise<TestClient> {
  await grantRole(admin, { role: 'Shop Floor', can_read: true, ...grants })
  return createUser({ roles: ['Shop Floor'] })
}
/** A Table that has nothing to do with the reorder plan: reading it opens the Admin to a viewer. */
const shopNotes = (admin: TestClient) => makeTable(admin, { name: 'Shop Note', module: 'Shop', columns: ['note'] })

// No Session verb scopes to a table's row by the record it names, so a row is found with Testing Library.
const row = (name: string) => screen.findByRole('row', { name: new RegExp(name) }, { timeout: 8000 })
const rowNames = () => screen.getAllByRole('row').map((each) => within(each).queryByRole('rowheader')?.textContent ?? '')

describe('runtime-pages', () => {
  scenario('The saved page opens with its heading', async ({ admin }, step) => {
    await step('the user may build Tables', () => {})
    await step('the user saves a page titled "Reorder Plan" that holds one line of text', () =>
      savePage(admin, definition(['hello'], [{ id: 'hello', component: 'Text', text: 'What to reorder next month' }])))
    await step('opening the page shows the heading "Reorder Plan" and that line of text', async () => {
      const { session } = await open(admin)
      await session.within('h1', (heading) => heading.assertExactText('Reorder Plan')).assertText('What to reorder next month')
    })
  })

  scenario('A viewer sees the rows they may read', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a published page "Reorder Plan" that lists the rows of "Reorder Line"', async () => {
      await reorderLines(admin)
      await savePage(admin, LIST)
    })
    await step('a viewer who may read "Reorder Line"', async () => {
      reader = await viewer(admin, createUser, { table: 'Reorder Line' })
    })
    await step('the viewer opens the page', async () => {
      ({ session } = await open(reader))
    })
    await step('the viewer sees the item "Notebook A5"', () => session.assertText('Notebook A5'))
  })

  scenario('The heading shows without the rows', async ({ admin, createUser }, step) => {
    let stranger!: TestClient
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a published page "Reorder Plan" that lists the rows of "Reorder Line"', async () => {
      await reorderLines(admin)
      await savePage(admin, LIST)
    })
    await step('a viewer who may not read "Reorder Line"', async () => {
      await shopNotes(admin)
      stranger = await viewer(admin, createUser, { table: 'Shop Note' })
    })
    await step('the viewer opens the page', async () => {
      ({ session } = await open(stranger))
    })
    await step('the viewer sees the heading "Reorder Plan"', () => session.within('h1', (heading) => heading.assertExactText('Reorder Plan')))
    await step('the viewer is told they may not see those rows', () => session.assertText('You don\'t have read permission on Reorder Line'))
    await step('the viewer does not see the item "Notebook A5"', () => session.refuteText('Notebook A5'))
  })

  scenario('Sold shows as a value', async ({ admin }, step) => {
    let opened!: Awaited<ReturnType<typeof open>>
    await step('a published page "Reorder Plan" that shows what was sold as a quantity or as a value', async () => {
      await reorderLines(admin)
      const sold = (example('plan').columns as { id: string }[]).find((column) => column.id === 'sold')!
      await savePage(admin, {
        version: '1.0',
        state: { measure: 'quantity' },
        data: LINES,
        components: [
          { id: 'root', component: 'Page', title: 'Reorder Plan', actions: ['measure'], children: ['plan'] },
          example('measure'),
          { ...LIST_PARTS[0]!, columns: [{ id: 'item', header: 'Item', cell: 'item_link' }, sold] },
          example('item_link'),
        ],
      })
      opened = await open(admin)
      expect(await row('Notebook A5')).toHaveTextContent('820')
    })
    await step('the user chooses to see it as a value', () => opened.session.clickButton('Value'))
    await step('the item "Notebook A5" shows 16,400 sold', async () => {
      await opened.session.until('the row follows the choice', async () => (await row('Notebook A5')).textContent!.includes('16,400'))
    })
    await step('opening the same address again shows "Notebook A5" with 16,400 sold', async () => {
      const address = (opened.router.state as { location: { href: string } }).location.href
      expect(address).toBe(`${pageHref(PAGE)}?measure=value`)
      opened.unmount()
      await open(admin, address)
      expect(await row('Notebook A5')).toHaveTextContent('16,400')
    })
  })

  scenario('Stationery opens to show its items', async ({ admin }, step) => {
    let opened!: Awaited<ReturnType<typeof open>>
    await step('a published page "Reorder Plan" that groups the rows of "Reorder Line" by category', async () => {
      await reorderLines(admin)
      await savePage(admin, WORKED_EXAMPLE)
    })
    await step('the user opens the page', async () => {
      opened = await open(admin)
    })
    await step('the group "Stationery" shows 1,510 sold', async () => {
      expect(within(await row('Stationery')).getAllByRole('cell')[0]).toHaveTextContent(/^1,510$/)
    })
    await step('the item "Notebook A5" is not shown', () => opened.session.refuteText('Notebook A5'))
    await step('the user opens the group "Stationery"', () => opened.session.clickButton('Stationery'))
    await step('the item "Notebook A5" is shown under it', async () => {
      await row('Notebook A5')
      const names = rowNames()
      const group = names.findIndex((name) => name.startsWith('Stationery'))
      expect(names.slice(group + 1, group + 3).sort()).toEqual(['Gel Pen', 'Notebook A5'])
    })
    await step('opening the same address again shows "Notebook A5"', async () => {
      const address = (opened.router.state as { location: { href: string } }).location.href
      expect(address).toBe(`${pageHref(PAGE)}?open=Stationery`)
      opened.unmount()
      const again = await open(admin, address)
      await again.session.assertText('Notebook A5')
    })
  })

  scenario('Notebook A5 shows 760 planned', async ({ admin }, step) => {
    let ids!: Record<string, string>
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a published page "Reorder Plan" where "Notebook A5" has 760 suggested and nothing planned', async () => {
      ids = await reorderLines(admin)
      await savePage(admin, WORKED_EXAMPLE)
      ;({ session } = await open(admin, `${pageHref(PAGE)}?open=Stationery`))
      expect(await planned(admin, ids['Notebook A5']!)).toBeNull()
    })
    await step('the user accepts the suggestion for "Notebook A5"', async () => {
      await within(await row('Notebook A5')).findByRole('button', { name: 'Accept Suggested' }).then((button) => button.click())
    })
    await step('the page says the change was saved', () => session.assertText('Saved'))
    await step('the row "Notebook A5" of "Reorder Line" has 760 planned', async () => {
      expect(await planned(admin, ids['Notebook A5']!)).toBe(760)
      await session.until('the page shows the saved value', async () => within(await row('Notebook A5')).getByLabelText<HTMLInputElement>('Planned quantity').value === '760')
    })
  })

  scenario('Typing alone changes nothing', async ({ admin }, step) => {
    let ids!: Record<string, string>
    await step('a published page "Reorder Plan" where "Notebook A5" has nothing planned', async () => {
      ids = await reorderLines(admin)
      await savePage(admin, WORKED_EXAMPLE)
    })
    await step('the user types 700 planned for "Notebook A5" and does not save', async () => {
      const { session } = await open(admin, `${pageHref(PAGE)}?open=Stationery`)
      await row('Notebook A5')
      await session.within(`tr[data-row="${ids['Notebook A5']}"]`, (line) => line.fillIn('Planned quantity', '700').assertValue('Planned quantity', '700'))
    })
    await step('the row "Notebook A5" of "Reorder Line" still has nothing planned', async () => expect(await planned(admin, ids['Notebook A5']!)).toBeNull())
  })

  scenario('A viewer who may not change the row is told so', async ({ admin, createUser }, step) => {
    let ids!: Record<string, string>
    let reader!: TestClient
    let session!: Awaited<ReturnType<typeof open>>['session']
    const line = () => `tr[data-row="${ids['Notebook A5']}"]`
    await step('a published page "Reorder Plan" where "Notebook A5" has nothing planned', async () => {
      ids = await reorderLines(admin)
      await savePage(admin, WORKED_EXAMPLE)
    })
    await step('a viewer who may read "Reorder Line" but not change it', async () => {
      reader = await viewer(admin, createUser, { table: 'Reorder Line' })
    })
    await step('the viewer saves 700 planned for "Notebook A5"', async () => {
      ({ session } = await open(reader, `${pageHref(PAGE)}?open=Stationery`))
      await row('Notebook A5')
      await session.within(line(), (scoped) => scoped.fillIn('Planned quantity', '700').clickButton('Save'))
    })
    await step('the page says the viewer may not change it', () => session.assertText('You don\'t have write permission on Reorder Line.'))
    await step('the page still holds the 700 the viewer typed', () => session.within(line(), (scoped) => scoped.assertValue('Planned quantity', '700')))
    await step('the row "Notebook A5" of "Reorder Line" still has nothing planned', async () => expect(await planned(admin, ids['Notebook A5']!)).toBeNull())
  })

  scenario('A page of sample rows says so', async ({ admin }, step) => {
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a published page "Reorder Plan" that shows sample rows of its own', () =>
      savePage(admin, definition(['plan'], [{
        id: 'plan', component: 'Table', caption: 'Reorder plan', rows: { '@path': '/data/lines' },
        columns: [{ id: 'item', header: 'Item', value: { '@path': 'item' } }, { id: 'sold', header: 'Sold', align: 'end', format: 'number', value: { '@path': 'sold_qty' } }],
      }], { data: { lines: { sample: [{ item: 'Notebook A5', sold_qty: 820 }, { item: 'Gel Pen', sold_qty: 690 }] } } })))
    await step('the user opens the page', async () => {
      ({ session } = await open(admin))
    })
    await step('the page says it shows sample data', () => session.within('[data-testid="page-header-status"]', (status) => status.assertText('Sample data')))
    await step('the user sees the item "Notebook A5"', () => session.assertText('Notebook A5'))
  })

  scenario('A draft is not there for a viewer', async ({ admin, createUser }, step) => {
    await step('a draft page "Reorder Plan"', () =>
      savePage(admin, definition(['hello'], [{ id: 'hello', component: 'Text', text: 'What to reorder next month' }]), 'Draft'))
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a viewer who may not build Tables opens its address', async () => {
      await shopNotes(admin)
      ;({ session } = await open(await viewer(admin, createUser, { table: 'Shop Note' })))
    })
    await step('the viewer is told nothing is there', () => session.assertText('This page isn’t here').refuteText('What to reorder next month'))
  })

  scenario('An address with no page says nothing is there', async ({ admin }, step) => {
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('no page named "Reorder Plan"', async () => {
      expect((await admin.get<{ pages: unknown[] }>('/api/pages')).pages).toEqual([])
    })
    await step('the user opens the address a page of that name would have', async () => {
      ({ session } = await open(admin))
    })
    await step('the user is told nothing is there', () => session.assertText('This page isn’t here'))
  })

  /** The address of the group's own page, where its Tables are listed. */
  const groupHref = async (as: TestClient, group: string) => {
    const { pages } = await as.get<{ pages: { row_id: string; module: string | null }[] }>('/api/home_pages')
    return `/featherbase/admin/home/${encodeURIComponent(pages.find((page) => page.module === group)!.row_id)}`
  }

  scenario('A published page is listed in its group', async ({ admin, createUser }, step) => {
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a published page "Reorder Plan" in the group "Reorder"', async () => {
      await reorderLines(admin)
      await savePage(admin, LIST)
    })
    await step('the user opens the group "Reorder"', async () => {
      const reader = await viewer(admin, createUser, { table: 'Reorder Line' })
      ;({ session } = await open(reader, await groupHref(reader, 'Reorder')))
    })
    await step('the user sees "Reorder Plan" among the group\'s pages', () =>
      // The link opens the page: its own heading, then its rows.
      session.within('[data-testid="home-card-pages"]', (card) => card.assertText('Pages').clickLink('Reorder Plan'))
        .within('h1', (heading) => heading.assertExactText('Reorder Plan')).assertText('Notebook A5'))
  })

  scenario('A builder sees the group\'s draft, marked', async ({ admin }, step) => {
    let session!: Awaited<ReturnType<typeof open>>['session']
    await step('a draft page "Reorder Plan" in the group "Reorder"', () =>
      savePage(admin, definition(['hello'], [{ id: 'hello', component: 'Text', text: 'What to reorder next month' }]), 'Draft'))
    await step('the user, who may build Tables, opens the group "Reorder"', async () => {
      ({ session } = await open(admin, await groupHref(admin, 'Reorder')))
    })
    await step('the user sees "Reorder Plan" among the group\'s pages, marked as a draft', () =>
      session.within('[data-testid="home-card-pages"] li', (line) => line.assertText('Reorder Plan').assertText('Draft')))
  })
})
