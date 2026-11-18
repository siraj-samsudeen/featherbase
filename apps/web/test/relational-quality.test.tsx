// #910 checklist 20: headers read in sentence case, never all capitals, on
// the list, the drill pane, the row page and the Linked to filter (#1276).
import { configure, fireEvent, screen, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const capitals = () => [...document.querySelectorAll('main .uppercase')].map((el) => el.textContent)

test('a list and its drill pane set nothing in capitals', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  fireEvent.click(within(line).getAllByRole('cell').at(-1)!)
  await screen.findByRole('complementary', { name: /^Enchakkal/ })
  await screen.findByTestId('standard-filters')
  expect(capitals()).toEqual([])
})

test('the Linked to filter sets nothing in capitals', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await screen.findByTestId('filter-toggle'))
  const field = await screen.findByTestId('filter-field')
  await within(field).findByRole('option', { name: 'Linked to…' })
  fireEvent.change(field, { target: { value: '__linked_to' } })
  await screen.findByTestId('linked-step')
  expect(capitals()).toEqual([])
})
