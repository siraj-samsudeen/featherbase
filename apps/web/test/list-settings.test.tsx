// UI-013: a customized list stays customized. Hiding a column and choosing a
// sort are stored per user on the server (PUT /api/user_settings/:table), and
// the ListView reads them back on mount — which is why the customization
// outlives the page that made it. Pushed down from e2e/list-settings.spec.ts
// (#223 batch 1); the spec proved "outlives" by logging out and back in, but
// the durable thing is the server row, and a fresh mount reads it through the
// same code path a fresh login would.
//
// Three claims, one test each: the hidden column leaves the header, the sort
// reorders the rows, and both survive a mount that starts from nothing.
//
// Every test ends by waiting for the settings PUT to arrive. That is not
// belt-and-braces: ListView fires it as `void api.put(...)`, so a test that
// returns without waiting lets the request execute AFTER its sandbox
// transaction ended — committing for real, and handing the next test (and
// the developer's database) a pre-customized list. `settledSettings` keeps
// the write inside the transaction, where rollback can undo it.

import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const DT = 'Ls Settings'

type Admin = Parameters<typeof renderApp>[1]
type Stored = { settings: { sort: { field: string; dir: string } | null; hiddenCols: string[] } }

async function seedList(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
      { column_name: 'rank', column_type: 'Int', label: 'Rank', in_list_view: true },
    ],
  })
  for (const [title, city, rank] of [
    ['alpha', 'NYC', 3],
    ['bravo', 'LA', 1],
    ['charlie', 'SF', 2],
  ] as [string, string, number][])
    await admin.post('/api/save_row', { table: DT, row: { title, city, rank } })
}

/** Mount the list and wait for its rows — settings load on mount, so every
 *  assertion below has to come after this resolves. */
async function openList(admin: Admin) {
  await renderApp(`/admin/${encodeURIComponent(DT)}`, admin)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(screen.getByTestId('col-title')).toBeInTheDocument())
  await waitFor(() =>
    expect(within(screen.getByTestId('list-rows')).getByText('alpha')).toBeInTheDocument(),
  )
}

/** Wait until the server row matches `want`, and return it. */
async function settledSettings(admin: Admin, want: Stored['settings']): Promise<Stored> {
  let stored!: Stored
  await waitFor(async () => {
    stored = (await admin.get(`/api/user_settings/${encodeURIComponent(DT)}`)) as Stored
    expect(stored.settings).toMatchObject(want)
  })
  return stored
}

const firstRowText = () => screen.getByTestId('list-rows').querySelector('tr')?.textContent ?? ''

async function hideCity() {
  screen.getByTestId('list-columns').click()
  ;(await screen.findByTestId('list-col-toggle-city')).click()
  await waitFor(() => expect(screen.queryByTestId('col-city')).not.toBeInTheDocument())
}

test('unchecking a column in the picker removes its header', async ({ admin }) => {
  await seedList(admin)
  await openList(admin)

  expect(screen.getByTestId('col-city')).toBeInTheDocument()
  await hideCity()
  expect(screen.getByTestId('col-title')).toBeInTheDocument()

  await settledSettings(admin, { sort: null, hiddenCols: ['city'] })
})

test('clicking a column header sorts the rows by it, ascending first', async ({ admin }) => {
  await seedList(admin)
  await openList(admin)

  screen.getByTestId('col-rank').click()
  // rank asc puts bravo (1) on top, ahead of charlie (2) and alpha (3).
  await waitFor(() => expect(firstRowText()).toContain('bravo'))

  await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: [] })
})

test('a fresh mount restores the hidden column and the sort from the server', async ({
  admin,
}) => {
  await seedList(admin)
  await openList(admin)

  await hideCity()
  screen.getByTestId('col-rank').click()
  await waitFor(() => expect(firstRowText()).toContain('bravo'))

  // The customization reached the server, not just this component's state.
  await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: ['city'] })

  // Throw the whole tree away — new mount, new QueryClient, nothing carried
  // over but the token — and the list comes back customized.
  cleanup()
  await openList(admin)
  expect(screen.queryByTestId('col-city')).not.toBeInTheDocument()
  expect(screen.getByTestId('col-title')).toBeInTheDocument()
  await waitFor(() => expect(firstRowText()).toContain('bravo'))
})
