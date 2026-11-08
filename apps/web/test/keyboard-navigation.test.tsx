// usable-on-any-device, "Use a screen without a mouse": a Table's list and a
// row's form are worked with the keyboard alone. Tab here is user-event's
// sequential focus navigation over the real DOM. Whether every control is a
// Tab stop in the browser's own order and shows a visible focus ring (the
// computed :focus-visible style) needs a real stylesheet and layout, so it is
// not claimed here.
import { tableSlug } from 'shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Kbn Item'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'aisle', column_type: 'Choice', choices: 'North\nSouth', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', in_list_view: true },
      { column_name: 'in_stock', column_type: 'Check' },
      { column_name: 'notes', column_type: 'Text' },
    ],
  })
  const row = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(DT)}`, { title: 'Kbn shelf label', aisle: 'North', qty: 3 })
  return row.row_id
}

/** Press Tab until `matches` holds for the focused element; fail if it never does. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, matches: (el: Element) => boolean, what: string) {
  for (let i = 0; i < 300; i++) {
    await user.tab()
    if (document.activeElement && matches(document.activeElement)) return
  }
  throw new Error(`Tab never reached ${what}`)
}

test('from a Table list, Tab reaches a row and Enter opens its form', async ({ admin }) => {
  const rowId = await seed(admin)
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, admin)
  await screen.findByText('Kbn shelf label', {}, { timeout: 8000 })
  const list = screen.getByTestId('list-view')
  await tabTo(user, (el) => list.contains(el) && el.matches(`a[href$="/${rowId}"]`), 'the row link')
  await user.keyboard('{Enter}')
  expect(await screen.findByTestId('form-view')).toBeInTheDocument()
  await waitFor(() => expect(document.querySelector('[data-field=title]')).toHaveValue('Kbn shelf label'))
})

test('a row form field is changed and saved with the keyboard alone', async ({ admin }) => {
  const rowId = await seed(admin)
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${rowId}`, admin)
  await waitFor(() => expect(document.querySelector('[data-field=title]')).toHaveValue('Kbn shelf label'), { timeout: 8000 })
  await tabTo(user, (el) => el.matches('[data-field=qty]'), 'the qty field')
  await user.keyboard('{Control>}a{/Control}7')
  await tabTo(user, (el) => el.matches('[data-testid="form-save"]'), 'Save')
  await user.keyboard('{Enter}')
  expect(await screen.findByTestId('form-banner')).toHaveTextContent('Saved')
  expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${rowId}`)).toMatchObject({ qty: 7 })
})
