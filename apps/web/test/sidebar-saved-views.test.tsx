// #1229: the Admin sidebar's "Saved views" — the person's own views and the
// shared ones they starred, one click each. The read's rules (Tables the person
// can read, private or deleted views dropping out) are the server's
// (apps/server/test/saved-views-sidebar.test.ts).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DEPT = 'Ssv Department'
const T = { timeout: 10_000 }
const ATK = ['store', '=', 'Attakulangara']

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DEPT, id_pattern: 'prompt', title_column: 'dept_name',
    columns: [
      { column_name: 'dept_name', column_type: 'Data', label: 'Department', in_list_view: true },
      { column_name: 'store', column_type: 'Data', label: 'Store', in_list_view: true },
    ],
  })
}

const group = () => screen.findByTestId('sidebar-saved-views', {}, T)

test("a person's own saved view is in the sidebar and opens its list with the view's filters", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  await renderApp('/featherbase/admin', admin)
  const row = await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)
  expect(row).toHaveTextContent(DEPT)

  await userEvent.click(row)
  // The Department list, with the view's one filter on.
  expect(await screen.findByTestId('table-page', {}, T)).toBeInTheDocument()
  const [chip, ...more] = await screen.findAllByTestId('filter-chip', {}, T)
  expect(more).toHaveLength(0)
  expect(chip).toHaveTextContent('Attakulangara')
})

test('with no saved views the group is not shown', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('admin-sidebar', {}, T)
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument()
})

test("starring someone else's shared view on the list puts it in the sidebar, and unstarring takes it out", async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'ATK Departments', filters: [ATK], shared: true })
  const manager = await createUser({ email: 'ssv.manager@example.test', roles: ['System Manager'] })
  await renderApp(tableHref(DEPT), manager)
  const star = await screen.findByTestId('saved-view-star', {}, T)
  expect(star).toHaveAccessibleName('Add ATK Departments to the sidebar')
  expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument()

  await userEvent.click(star)
  expect(await within(await group()).findByRole('link', { name: /ATK Departments/ }, T)).toHaveTextContent('shared')
  expect(star).toHaveAccessibleName('Remove ATK Departments from the sidebar')

  await userEvent.click(star)
  await waitFor(() => expect(screen.queryByTestId('sidebar-saved-views')).not.toBeInTheDocument(), T)
})

test('the star is offered only on shared views of other people', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/saved_views', { table: DEPT, label: 'Mine', filters: [ATK], shared: true })
  await renderApp(tableHref(DEPT), admin)
  await screen.findAllByTestId('saved-view-chip', {}, T)
  expect(screen.queryByTestId('saved-view-star')).not.toBeInTheDocument()
})
