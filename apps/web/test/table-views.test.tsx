// #1021: creating a view from a Table's list. The server rules are in
// apps/server/test/table-views.test.ts; this file proves what the person sees
// when a dialog in the Table administration menu has something to say.

import { cleanup, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Vwd Site',
    columns: [
      { column_name: 'site_name', column_type: 'Data', label: 'Site name', in_list_view: true },
      { column_name: 'is_store', column_type: 'Check', label: 'Is store', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', { name: 'Vwd Taken', columns: [{ column_name: 'title', column_type: 'Data' }] })
}

test('a refused name is said in the dialog, which stays open when focus leaves it', async ({ admin }) => {
  await seed(admin)
  const filters = encodeURIComponent(JSON.stringify([['is_store', '=', 1]]))
  await renderApp(`/featherbase/admin/table/vwd-site?filters=${filters}`, admin)
  fireEvent.click(await screen.findByRole('button', { name: /Table administration/ }))
  fireEvent.click(await screen.findByTestId('save-as-view'))
  const name = await screen.findByTestId('save-as-view-name')
  // A busy button gives up focus, as does a click on the dialog's own words.
  fireEvent.focusOut(name, { relatedTarget: null })
  expect(screen.getByTestId('save-as-view-dialog')).toBeTruthy()
  fireEvent.change(name, { target: { value: 'Vwd Taken' } })
  fireEvent.click(screen.getByTestId('save-as-view-confirm'))
  await waitFor(() => expect(screen.getByTestId('save-as-view-error').textContent).toContain('already exists'))
  cleanup()
})
