// Verifier, round 2 on #495: an Admin path that is neither a known page nor an
// existing Table says "Page not found", plainly, with a way back to the Admin
// home. The retired /featherbase/admin/sign-in-methods is one (#489 item 13;
// changed outright, no redirect), and so is any made-up path.
import { screen, within } from '@testing-library/react'
import { logAccess } from 'server/src/audit'
import { test, expect, renderApp } from './pg-test'

test.for([
  ['the retired Sign-in methods page', '/featherbase/admin/sign-in-methods'],
  ['a made-up page', '/featherbase/admin/no-such-page-489'],
  ['a row of a made-up Table', '/featherbase/admin/no-such-page-489/some-row'],
  ['a path deeper than any Admin page', '/featherbase/admin/no/such/page/489'],
] as const)('%s says Page not found, with a link to the Admin home', async ([, path], { admin }) => {
  await renderApp(path, admin)
  const page = await screen.findByTestId('page-not-found')
  expect(page).toHaveTextContent('Page not found')
  expect(within(page).getByRole('link')).toHaveAttribute('href', '/featherbase/admin')
  expect(screen.queryByText(/Table .* not found/)).toBeNull()
})

// DEL-R9 stands: a Table that was deleted is not "not found"; its path says
// who deleted it and when.
test("a deleted Table's path still says it was deleted", async ({ admin }) => {
  await logAccess('Administrator', 'delete_table', { table: 'Buried Table 489' })
  await renderApp('/featherbase/admin/Buried%20Table%20489', admin)
  expect(await screen.findByText(/Table Buried Table 489 was deleted by Administrator on/)).toBeInTheDocument()
  expect(screen.queryByTestId('page-not-found')).toBeNull()
})

test('an existing Table still opens its list', async ({ admin }) => {
  await renderApp('/featherbase/admin/Person', admin)
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  expect(screen.queryByTestId('page-not-found')).toBeNull()
})
