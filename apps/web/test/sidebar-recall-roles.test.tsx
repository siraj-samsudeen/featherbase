// #228: the sidebar's recall rows must not share a role/name space with the
// page's own controls.
//
// The rows are named after whatever the operator last visited, so as buttons
// they put arbitrary, run-dependent text into the `button` role. A chip
// reading "Checklist Run — checklist" once matched an import-wizard lookup
// for a button named "Check" and failed a journey that had nothing to do with
// either — and only when an earlier spec had seeded that trail, which is why
// it looked random. Every sidebar row is a destination (searches are filtered
// out upstream), so `link` is both the honest role and one a button lookup
// can never reach.
//
// Two claims: the rows are links, and a page button keeps its name to itself
// even when a chip is wearing the same words.

import { screen, waitFor } from '@testing-library/react'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

const DT = 'Recall Roles'

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
}

/** Put a trail in the per-user buffer the sidebar reads. The label is chosen
 *  to collide with the form's own Save button under any substring lookup. */
function seedTrail(user: string) {
  for (const at of [1, 2, 3])
    recordAction(
      user,
      { kind: 'row', key: 'row:Saved Search/SS-1', label: 'Saved Search', sub: 'row', path: '/admin/Saved%20Search/SS-1' },
      Date.now() - at * 1000,
    )
}

test('sidebar recall rows expose the link role, never button', async ({ admin }) => {
  await seed(admin)
  seedTrail('Administrator')

  await renderApp(`/admin/${encodeURIComponent(DT)}/new`, admin)
  await screen.findByTestId('form-view')

  const row = await screen.findByTestId('sidebar-recent')
  expect(row).toHaveRole('link')
  expect(row).toHaveAttribute('href', '/admin/Saved%20Search/SS-1')
  expect(screen.queryAllByRole('button')).not.toContain(row)
})

test("a chip wearing a button's words does not widen that button's name lookup", async ({
  admin,
}) => {
  await seed(admin)
  seedTrail('Administrator')

  await renderApp(`/admin/${encodeURIComponent(DT)}/new`, admin)
  await screen.findByTestId('form-view')
  await screen.findByTestId('sidebar-recent')

  // The chip reads "Saved Search"; the form's own control reads "Save".
  // Exactly one button answers to Save, and it is the form's.
  await waitFor(() => {
    const saves = screen.getAllByRole('button', { name: /^Save/ })
    expect(saves).toEqual([screen.getByTestId('form-save')])
  })
})
