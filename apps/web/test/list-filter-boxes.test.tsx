// #1016, #1017 (spec: list-view "Narrow the list with filters", "A list's
// controls leave the room to its rows"): password managers leave filter boxes
// alone, and the Add filter row waits until it is asked for.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

function expectLeftAlone(box: HTMLElement) {
  expect(box).toHaveAttribute('autocomplete', 'off')
  for (const manager of ['data-1p-ignore', 'data-lpignore', 'data-bwignore']) expect(box).toHaveAttribute(manager, 'true')
  expect(box).toHaveAttribute('data-form-type', 'other')
}

const addFilter = () => screen.findByRole('button', { name: 'Add filter', expanded: false })

test('text and link filter boxes tell password managers to leave them alone', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  expectLeftAlone(await screen.findByTestId('std-filter-site_name'))
  expectLeftAlone(await screen.findByTestId('std-filter-region'))
  fireEvent.click(await addFilter())
  expectLeftAlone(await screen.findByTestId('filter-value'))
})

test('the Add filter row is closed until asked for, and closes again', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await addFilter())
  expect(await screen.findByTestId('filter-field')).toBeInTheDocument()
  expect(await screen.findByTestId('filter-value')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('filter-toggle'))
  await waitFor(() => expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument())
})

test('filters already applied stay visible with the Add filter row closed', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['site_name', 'like', '%a%']]))}`, admin)
  await addFilter()
  const chip = await screen.findByTestId('filter-chip')
  expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument()
  expect(within(chip).getByRole('button', { name: 'Remove filter' })).toBeInTheDocument()
})
