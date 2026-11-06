// #910 checklist 20: headers read in sentence case, never all capitals, on
// the list, the drill pane, the row page and Explore.
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

test('Explore sets nothing in capitals', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`/featherbase/admin/explore?root=${encodeURIComponent(SITE)}`, admin)
  await screen.findByTestId('explore-pane1')
  expect(capitals()).toEqual([])
})
