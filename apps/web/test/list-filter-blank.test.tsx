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
  await waitFor(() => expect(chip).toHaveTextContent(/^Row ID is blank✕$/))
})

test('a list opened with is not blank shows it as a chip', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['region', 'is not blank', null]]))}`, admin)
  const chip = await screen.findByTestId('filter-chip')
  expect(chip.textContent).toMatch(/is not blank✕$/)
  expect(chip.textContent).not.toContain('null')
})

test('the breadcrumb and recents label is blank without a value', async () => {
  const { filterText } = await import('../src/lib/step-labels')
  const { describeFilters } = await import('../src/lib/recents')
  const meta = { columns: [{ column_name: 'person', label: 'Person', column_type: 'Data' }] } as never
  expect(filterText('T', meta, ['person', 'is blank', null], () => '')).toBe('Person is blank')
  expect(describeFilters(JSON.stringify([['person', 'is not blank', null]]), [{ column_name: 'person', label: 'Person', column_type: 'Data' }] as never, (s: string) => s))
    .toBe('Person is not blank')
})
