// A list's Tree of all opening a row and showing all of a big group (#910),
// and a list's Delete permanently for the rows it has selected (#859).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, PROFIT, SITE, seedSites } from './relational-fixture'

const T = { timeout: 10_000 }
const tree = () => screen.findByRole('tree', {}, T)
const topLines = (t: HTMLElement) => within(t).getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')

test('a line of Tree of all opens its row in the pane', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }, T))
  const t = await tree()
  await waitFor(() => expect(topLines(t)).toHaveLength(3))
  fireEvent.click(within(t).getByText('Madurai · MDU'))
  expect(await screen.findByRole('complementary', { name: 'Madurai · MDU' }, T)).toHaveTextContent(SITE)
})

test('show all in Tree of all lists every row of a big group', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 25 })
  await renderApp(tableHref(PLANT), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }, T))
  const t = await tree()
  const plant = (await within(t).findAllByRole('treeitem', { name: 'Enchakkal Supermarket · 1503' }, T))[0]
  fireEvent.keyDown(plant, { key: 'ArrowRight' })
  const group = await within(plant).findByRole('treeitem', { name: `${PROFIT} 25` }, T)
  fireEvent.keyDown(group, { key: 'ArrowRight' })
  fireEvent.click(await within(group).findByRole('button', { name: 'show all 25' }, T))
  await waitFor(() => expect(within(group).getAllByRole('treeitem')).toHaveLength(25), T)
})

async function selectPlants(admin: Parameters<typeof renderApp>[1]) {
  await seedSites(admin)
  await renderApp(tableHref(PLANT), admin)
  const rows = await screen.findByTestId('list-rows', {}, T)
  await waitFor(() => expect(within(rows).getAllByTestId('row-check')).toHaveLength(4), T)
  for (const check of within(rows).getAllByTestId('row-check').slice(0, 2)) fireEvent.click(check)
  fireEvent.click(await screen.findByTestId('bulk-purge', {}, T))
  return screen.findByTestId('purge-dialog', {}, T)
}

test("Cancel on a list's Delete permanently keeps the rows and their selection", async ({ admin }) => {
  const dialog = await selectPlants(admin)
  await userEvent.click(within(dialog).getByTestId('purge-cancel'))
  expect(screen.queryByTestId('purge-dialog')).not.toBeInTheDocument()
  expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check').filter((c) => (c as HTMLInputElement).checked)).toHaveLength(2)
})

test("a list's Delete permanently removes the selected rows and clears the selection", async ({ admin }) => {
  const user = userEvent.setup()
  const dialog = await selectPlants(admin)
  await within(dialog).findByTestId('purge-summary', {}, T)
  await user.type(within(dialog).getByTestId('purge-reason'), 'Created by mistake')
  await user.type(within(dialog).getByTestId('purge-confirm-word'), 'DELETE')
  await user.click(within(dialog).getByTestId('purge-confirm'))
  await waitFor(() => expect(screen.queryByTestId('purge-dialog')).not.toBeInTheDocument(), T)
  await waitFor(() => expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')).toHaveLength(2), T)
  expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
})
