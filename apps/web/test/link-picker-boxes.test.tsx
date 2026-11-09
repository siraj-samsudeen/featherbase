// #1019 (spec: list-view "Filter a list by a linked row's name", "Add a filter
// with the box its column calls for"): a link box reads as a picker, password
// managers leave it alone, its values sort by name, and the Add filter row
// offers the same box as the quick filters. Made-up rows only.
import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { holdResponses } from './held-requests'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Admin = Parameters<typeof renderApp>[1]
const REGION = 'Lb Region'
const SHOP = 'Lb Shop'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: REGION, id_pattern: 'prompt', title_column: 'region_name',
    columns: [{ column_name: 'region_name', column_type: 'Data', label: 'Region name', in_list_view: true }],
  })
  // Saved out of order: the newest first would read Tamil Nadu before Kerala.
  for (const [row_id, region_name] of [['r-k', 'Kerala'], ['r-a', 'Andhra'], ['r-t', 'Tamil Nadu']])
    await admin.post('/api/save_row', { table: REGION, row: { row_id, region_name } })
  await admin.post('/api/table_def', {
    name: SHOP, id_pattern: 'prompt', title_column: 'shop_name',
    columns: [
      { column_name: 'shop_name', column_type: 'Data', label: 'Shop name', in_list_view: true },
      { column_name: 'region', column_type: 'Reference', reference_table: REGION, label: 'Region', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'opened_on', column_type: 'Date', label: 'Opened on', in_list_view: true },
      { column_name: 'seen_at', column_type: 'Datetime', label: 'Seen at' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  for (const [row_id, shop_name, region] of [['s-1', 'Canal Road', 'r-k'], ['s-2', 'Hill Street', 'r-t']])
    await admin.post('/api/save_row', { table: SHOP, row: { row_id, shop_name, region } })
}

function expectLeftAlone(box: HTMLElement) {
  expect(box).toHaveAttribute('autocomplete', 'off')
  for (const manager of ['data-1p-ignore', 'data-lpignore', 'data-bwignore']) expect(box).toHaveAttribute(manager, 'true')
}

const options = (list: HTMLElement) => within(list).getAllByTestId('link-option').map((o) => o.textContent)

test('a link box on a form reads as a picker and password managers leave it alone', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(SHOP)}/new`, admin)
  await screen.findByTestId('form-view')
  const box = document.querySelector<HTMLInputElement>('[data-field=region]')!
  expectLeftAlone(box)
  expect(screen.getByTestId('link-chevron-region')).toBeInTheDocument()
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  expectLeftAlone(within(list).getByRole('searchbox'))
})

test('Tab leaves a link box for the next field: nothing in its list is a Tab stop', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(SHOP)}/new`, admin)
  await screen.findByTestId('form-view')
  fireEvent.focus(document.querySelector<HTMLInputElement>('[data-field=region]')!)
  const list = await screen.findByTestId('link-options-region')
  await within(list).findAllByTestId('link-option')
  for (const stop of [list, ...list.querySelectorAll('input,a,button')]) expect(stop).toHaveAttribute('tabindex', '-1')
})

test('Escape on a form link drops what was being searched for', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(SHOP)}/row/s-1`, admin)
  await screen.findByTestId('link-open-region')
  const box = document.querySelector<HTMLInputElement>('[data-field=region]')!
  await waitFor(() => expect(box).toHaveValue('Kerala'))
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  fireEvent.change(within(list).getByRole('searchbox'), { target: { value: 'tam' } })
  fireEvent.keyDown(within(list).getByRole('searchbox'), { key: 'Escape' })
  await waitFor(() => expect(box).toHaveValue('Kerala'))
})

test('a form link with a value offers its way to the row, not a chevron', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(SHOP)}/row/s-1`, admin)
  await screen.findByTestId('link-open-region')
  expect(screen.queryByTestId('link-chevron-region')).not.toBeInTheDocument()
})

test('a link filter lists values by name, and the search box in the list narrows them', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  const box = await screen.findByTestId('std-filter-region')
  expect(screen.getByTestId('link-chevron-region')).toBeInTheDocument()
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  await waitFor(() => expect(options(list)).toEqual(['Andhra', 'Kerala', 'Tamil Nadu']))
  fireEvent.change(within(list).getByRole('searchbox'), { target: { value: 'tamil' } })
  await waitFor(() => expect(options(list)).toEqual(['Tamil Nadu']))
  fireEvent.mouseDown(within(list).getByTestId('link-option'))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(1))
  await waitFor(() => expect(box).toHaveValue('Tamil Nadu'))
})

// Moved from e2e/list-one-line.spec.ts (#1019, #1080): what a click on a
// link filter does with the keyboard.
test('a link filter opened by a click takes what is typed into its search box', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  await user.click(await screen.findByTestId('std-filter-region'))
  const list = await screen.findByTestId('link-options-region')
  await waitFor(() => expect(options(list)).toEqual(['Andhra', 'Kerala', 'Tamil Nadu']))
  const search = within(list).getByRole('searchbox')
  expect(search).toHaveFocus()
  await user.keyboard('ker')
  expect(search).toHaveValue('ker')
  await waitFor(() => expect(options(list)).toEqual(['Kerala']))
})

test('a link filter search that finds nothing says No matches', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  fireEvent.focus(await screen.findByTestId('std-filter-region'))
  const list = await screen.findByTestId('link-options-region')
  await within(list).findAllByTestId('link-option')
  fireEvent.change(within(list).getByRole('searchbox'), { target: { value: 'zzz' } })
  await waitFor(() => expect(list).toHaveTextContent('No matches'))
  expect(within(list).queryByTestId('link-option')).not.toBeInTheDocument()
})

// Past the picker's 150ms search delay, so a stray search would have reopened it.
async function stayClosed() {
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(screen.queryByTestId('link-options-region')).not.toBeInTheDocument()
}

test('the keyboard walks a link list: arrows to an option, Enter picks it, Escape closes it', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  const box = await screen.findByTestId('std-filter-region')
  box.focus()
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  await within(list).findAllByTestId('link-option')
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  const first = within(list).getAllByTestId('link-option')[0]
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  const second = within(list).getAllByTestId('link-option')[1]
  expect(second).toHaveFocus()
  second.focus()
  fireEvent.keyDown(second, { key: 'Enter' })
  await waitFor(() => expect(box).toHaveValue('Kerala'))
  expect(box).toHaveFocus()
  await stayClosed()
  // ArrowDown shows the list again, for someone not using a mouse.
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  await within(await screen.findByTestId('link-options-region')).findAllByTestId('link-option')
  fireEvent.keyDown(box, { key: 'Escape' })
  await stayClosed()
  // A box that kept its focus opens again on a click.
  fireEvent.click(box)
  const again = await screen.findByTestId('link-options-region')
  const option = (await within(again).findAllByTestId('link-option'))[0]
  option.focus()
  fireEvent.keyDown(option, { key: 'Escape' })
  expect(box).toHaveFocus()
  await stayClosed()
})

const openBuilder = async () => fireEvent.click(await screen.findByTestId('filter-toggle'))
const chooseColumn = (column: string) => fireEvent.change(screen.getByTestId('filter-field'), { target: { value: column } })
const chooseOp = (op: string) => fireEvent.change(screen.getByTestId('filter-op'), { target: { value: op } })
const value = () => screen.getByTestId('filter-value')

test("the Add filter row's Value is the same picker as the quick filter for a link", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  await openBuilder()
  chooseColumn('region')
  expect(value()).toHaveAttribute('role', 'combobox')
  fireEvent.focus(value())
  const list = await screen.findByTestId('link-options-region')
  await waitFor(() => expect(options(list)).toEqual(['Andhra', 'Kerala', 'Tamil Nadu']))
  expect(within(list).queryByTestId('link-create-new')).not.toBeInTheDocument()
  fireEvent.mouseDown(within(list).getAllByTestId('link-option')[1])
  await waitFor(() => expect(value()).toHaveValue('Kerala'))
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent('Region = Kerala'))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(1))
  expect(value()).toHaveValue('')
})

test("the Add filter row's Value fits the column and the condition", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  await openBuilder()
  chooseColumn('stage')
  expect(value().tagName).toBe('SELECT')
  chooseOp('like')
  expect(value()).toHaveAttribute('type', 'text')
  chooseOp('=')
  chooseColumn('opened_on')
  expect(value()).toHaveAttribute('type', 'date')
  chooseColumn('seen_at')
  expect(value()).toHaveAttribute('type', 'datetime-local')
  chooseColumn('qty')
  expect(value()).toHaveAttribute('type', 'number')
  chooseOp('like')
  expect(value()).toHaveAttribute('type', 'text')
  chooseColumn('region')
  expect(value()).toHaveAttribute('type', 'text')
  expect(value()).not.toHaveAttribute('role', 'combobox')
  chooseOp('>')
  expect(value()).not.toHaveAttribute('role', 'combobox')
})

test('a value does not survive a change to a different kind of box', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  await openBuilder()
  chooseColumn('qty')
  fireEvent.change(value(), { target: { value: '5' } })
  chooseOp('>')
  expect(value()).toHaveValue(5)
  chooseOp('like')
  expect(value()).toHaveValue('')
  fireEvent.change(value(), { target: { value: 'x' } })
  chooseColumn('shop_name')
  expect(value()).toHaveValue('')
})

test('Down on the last option of a link list stays on it', async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  const box = await screen.findByTestId('std-filter-region')
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  const all = await within(list).findAllByTestId('link-option')
  await waitFor(() => expect(options(list)).toEqual(['Andhra', 'Kerala', 'Tamil Nadu']))
  all.at(-1)!.focus()
  fireEvent.keyDown(all.at(-1)!, { key: 'ArrowDown' })
  expect(within(list).getAllByTestId('link-option').at(-1)).toHaveFocus()
})

test("Up on the first option of a link list goes back to the list's search box", async ({ admin }) => {
  await seed(admin)
  await renderApp(tableHref(SHOP), admin)
  const box = await screen.findByTestId('std-filter-region')
  fireEvent.focus(box)
  const list = await screen.findByTestId('link-options-region')
  const [first] = await within(list).findAllByTestId('link-option')
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowUp' })
  expect(within(list).getByRole('searchbox')).toHaveFocus()
})

test("Enter in a form link's search box does not submit the form", async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(SHOP)}/row/s-1`, admin)
  await screen.findByTestId('link-open-region')
  fireEvent.focus(document.querySelector<HTMLInputElement>('[data-field=region]')!)
  const search = within(await screen.findByTestId('link-options-region')).getByRole('searchbox')
  // fireEvent answers false when a handler kept the key from the page.
  expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false)
})

test("a form link's list opened before its Table's details arrive lists names once they do", async ({ admin }) => {
  await seed(admin)
  const details = holdResponses(`/api/table/${encodeURIComponent(REGION)}:meta`)
  await renderApp(`${tableHref(SHOP)}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 10_000 })
  await details.asked
  fireEvent.focus(document.querySelector<HTMLInputElement>('[data-field=region]')!)
  const list = await screen.findByTestId('link-options-region')
  // Until then the rows can only be listed by their ids.
  await waitFor(() => expect(options(list)).toEqual(expect.arrayContaining(['r-k'])))
  await act(async () => { details.release() })
  await waitFor(() => expect(options(screen.getByTestId('link-options-region'))).toEqual(['Andhra', 'Kerala', 'Tamil Nadu']))
})

test('a person search that answers after the box was left does not open its list', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Lb Visit', columns: [{ column_name: 'host', column_type: 'Reference', reference_table: 'Person', label: 'Host' }],
  })
  await renderApp(`${tableHref('Lb Visit')}/new`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 10_000 })
  const search = holdResponses('/api/people/pick')
  const box = document.querySelector<HTMLInputElement>('[data-field=host]')!
  fireEvent.focus(box)
  await search.asked
  fireEvent.blur(box)
  await act(async () => {
    search.release()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
  expect(screen.queryByTestId('link-options-host')).not.toBeInTheDocument()
})
