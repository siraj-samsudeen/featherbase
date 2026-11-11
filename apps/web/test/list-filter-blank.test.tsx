// #1196 (spec: list-view "Filter for blank values"): the Add filter row offers
// is blank and is not blank with no value box, and their chips read without one.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

test('is blank takes no value, and its chip reads "is blank" with nothing after it', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Add filter', expanded: false }))
  const op = await screen.findByTestId('filter-op')
  expect(within(op).getAllByRole('option').map(o => o.textContent)).toEqual(expect.arrayContaining(['is blank', 'is not blank']))
  fireEvent.change(op, { target: { value: 'is blank' } })
  expect(screen.queryByTestId('filter-value')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('filter-add'))
  const chip = await screen.findByTestId('filter-chip')
  await waitFor(() => expect(chip).toHaveTextContent(/^Row ID is blank×$/))
})

test('a list opened with is not blank shows it as a chip', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['region', 'is not blank', null]]))}`, admin)
  const chip = await screen.findByTestId('filter-chip')
  expect(chip.textContent).toMatch(/is not blank×$/)
  expect(chip.textContent).not.toContain('null')
})
