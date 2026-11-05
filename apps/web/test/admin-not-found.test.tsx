// Verifier, round 2 on #495: an Admin path that is neither a known page nor an
// existing Table says "Page not found", plainly, with a way back to the Admin
// home. The retired /featherbase/admin/sign-in-methods is one (#489 item 13;
// changed outright, no redirect), and so is any made-up path.
import { screen, within } from '@testing-library/react'
import { logAccess } from 'server/src/audit'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

test.for([
  ['the retired Sign-in methods page', '/featherbase/admin/sign-in-methods'],
  ['a made-up page', '/featherbase/admin/no-such-page-489'],
  ['a row of a made-up Table', '/featherbase/admin/table/no-such-page-489/row/some-row'],
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
  await renderApp('/featherbase/admin/table/buried-table-489', admin)
  expect(await screen.findByText(/Table Buried Table 489 was deleted by Administrator on/)).toBeInTheDocument()
  expect(screen.queryByTestId('page-not-found')).toBeNull()
})

// #958: the page reads a name and a day, never the id the Access Log holds.
test("a deleted Table's page names the person who deleted it", async ({ admin }) => {
  const person = 'psn_aaaaaaaaaaaaaaaaaaaa'
  await sql`insert into person (row_id, full_name) values (${person}, 'Priya Raman')`
  await logAccess(person, 'delete_table', { table: 'Buried Table 958' })
  await sql`update access_log set created_at = '2026-11-05T03:50:20Z' where ref_table = 'Buried Table 958'`
  await renderApp('/featherbase/admin/table/buried-table-958', admin)
  const message = await screen.findByText('Table Buried Table 958 was deleted by Priya Raman on 05-Nov-2026')
  expect(message).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(person)
})

test('an existing Table still opens its list', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/person', admin)
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  expect(screen.queryByTestId('page-not-found')).toBeNull()
})
