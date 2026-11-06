// #910 checklist 2 and 16: following a link — a list's link cell, a form's
// link field — shows the linked row in the drill pane, not a peek and not a
// new page.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { REGION, SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

test("clicking Kerala in Enchakkal's line shows Kerala in the pane, over the same list", async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(tableHref(SITE), admin)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  fireEvent.click(await within(line).findByRole('link', { name: 'Kerala (KL)' }))
  expect(await screen.findByRole('complementary', { name: 'Kerala (KL)' })).toHaveTextContent(REGION)
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref(SITE))
  expect(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')).toHaveLength(3)
})
