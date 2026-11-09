// Record nav: a form opened from the list steps to the previous and next
// record of that same list, with its filters, its sort and its pages. Ported
// from the Playwright record-nav spec. The checks read the list's own order
// rather than assuming one.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { beforeEach } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
type App = Awaited<ReturnType<typeof renderApp>>
const WAIT = { timeout: 10_000 }
const TABLE = 'Rn List'
const ROW_LINK = 'a[href*="/row/"]'

// The list leaves its place in this tab's sessionStorage, which jsdom keeps
// between tests; each test starts as a fresh tab.
beforeEach(() => sessionStorage.clear())

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: TABLE,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  for (let i = 0; i < 30; i++)
    await admin.post('/api/save_row', { table: TABLE, row: { title: `item-${String(i).padStart(2, '0')}`, qty: i } })
}

const listUrl = (filters?: unknown[]) =>
  `/featherbase/admin/table/${encodeURIComponent(tableSlug(TABLE))}` +
  (filters ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : '')

const rows = () => [...screen.getByTestId('list-rows').querySelectorAll('tr')]
const rowLink = (i: number) => rows()[i].querySelector<HTMLAnchorElement>(ROW_LINK)!
const pathOf = (href: string) => new URL(href, 'http://x').pathname

async function openList(admin: Admin, url: string, count: number) {
  const app = await renderApp(url, admin)
  await screen.findByTestId('list-rows', {}, WAIT)
  await waitFor(() => expect(rows()).toHaveLength(count), WAIT)
  return app
}

/** The address of each record the list shows, in its order. */
const listedRecords = () => rows().map((tr) => pathOf(tr.querySelector<HTMLAnchorElement>(ROW_LINK)!.getAttribute('href')!))

/** The form shows the record at this address. */
async function formAt(app: App, path: string) {
  await waitFor(() => expect((app.router.state as { location: { pathname: string } }).location.pathname).toBe(path), WAIT)
  await screen.findByTestId('form-view', {}, WAIT)
}

const position = () => screen.findByTestId('record-position', {}, WAIT)
const prevButton = () => screen.getByRole('button', { name: 'Previous record' })
const nextButton = () => screen.getByRole('button', { name: 'Next record' })

test('record nav: Previous and Next follow the filtered list the record was opened from', async ({ admin }) => {
  await seed(admin)
  // title like item-0% -> item-00 … item-09: ten rows, one page.
  const app = await openList(admin, listUrl([['title', 'like', 'item-0%']]), 10)
  const titles = listedRecords()

  await userEvent.click(rowLink(1))
  await formAt(app, titles[1])
  await waitFor(async () => expect(await position()).toHaveTextContent('2 of 10'), WAIT)

  await userEvent.click(nextButton())
  await formAt(app, titles[2])
  await waitFor(async () => expect(await position()).toHaveTextContent('3 of 10'), WAIT)

  await userEvent.click(prevButton())
  await waitFor(async () => expect(await position()).toHaveTextContent('2 of 10'), WAIT)
  await userEvent.click(prevButton())
  await formAt(app, titles[0])
  await waitFor(async () => expect(await position()).toHaveTextContent('1 of 10'), WAIT)
  expect(prevButton()).toBeDisabled()
})

test('record nav: steps across a page boundary of the list', async ({ admin }) => {
  await seed(admin)
  const app = await openList(admin, listUrl(), 20)
  const firstPage = listedRecords()

  await userEvent.click(screen.getByTestId('next-page'))
  await waitFor(() => expect(screen.getByTestId('page-info')).toHaveTextContent('21'), WAIT)
  await waitFor(() => expect(rows()).toHaveLength(10), WAIT)
  const secondPage = listedRecords()

  await userEvent.click(rowLink(0))
  await formAt(app, secondPage[0])
  await waitFor(async () => expect(await position()).toHaveTextContent('21 of 30'), WAIT)

  await userEvent.click(prevButton())
  await formAt(app, firstPage[19])
  await waitFor(async () => expect(await position()).toHaveTextContent('20 of 30'), WAIT)
})

test('record nav: a record opened without its list shows no record nav', async ({ admin }) => {
  await seed(admin)
  await openList(admin, listUrl(), 20)
  const href = rowLink(0).getAttribute('href')!

  // A fresh tab: no list behind it, and none of this tab's sessionStorage.
  cleanup()
  sessionStorage.clear()
  await renderApp(href, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await waitFor(() => expect(document.querySelector('[data-field=title]')).not.toHaveValue(''), WAIT)
  await new Promise((r) => setTimeout(r, 500)) // record nav asks the server for its neighbours; let any answer land
  expect(screen.queryByTestId('record-nav')).not.toBeInTheDocument()
})

test('record nav: unsaved changes are kept unless the user agrees to leave', async ({ admin }) => {
  await seed(admin)
  const app = await openList(admin, listUrl([['title', 'like', 'item-0%']]), 10)
  const titles = listedRecords()

  await userEvent.click(rowLink(0))
  await formAt(app, titles[0])
  await position()
  const title = () => document.querySelector<HTMLInputElement>('[data-field=title]')!
  await waitFor(() => expect(title()).not.toHaveValue(''), WAIT)
  await userEvent.clear(title())
  await userEvent.type(title(), 'edited, not saved')

  // The form's own leave question asks, as before any other page (#1009).
  await userEvent.click(nextButton())
  await userEvent.click(within(await screen.findByTestId('unsaved-leave-dialog', {}, WAIT)).getByRole('button', { name: 'Stay' }))
  await waitFor(() => expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument())
  expect((app.router.state as { location: { pathname: string } }).location.pathname).toBe(titles[0])
  expect(title()).toHaveValue('edited, not saved')

  await userEvent.click(nextButton())
  await userEvent.click(within(await screen.findByTestId('unsaved-leave-dialog', {}, WAIT)).getByRole('button', { name: 'Leave without saving' }))
  await formAt(app, titles[1])
})

test('a record whose list place in this tab cannot be read shows no record buttons', async ({ admin }) => {
  await seed(admin)
  const { data } = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(TABLE)}?fields=["row_id"]&limit_page_length=1`)
  sessionStorage.setItem(`featherbase.listPlace.${TABLE}`, '{not json')
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(TABLE))}/row/${data[0].row_id}`, admin)
  await screen.findByTestId('form-view', {}, WAIT)
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTestId('record-nav')).not.toBeInTheDocument()
})
