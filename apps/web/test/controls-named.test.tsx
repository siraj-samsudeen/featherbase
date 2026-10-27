// Usable on any device — "Controls are clearly named" (openspec/specs/
// usable-on-any-device). Every control on the generic screens carries a name
// a person (or a screen reader) can read: visible text, an aria-label, or a
// label tied to it. Real list and form in jsdom against the in-process server.

import { screen, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'


type Admin = Parameters<typeof renderApp>[1]
const CONTROLS = 'button, a[href], input, select, textarea, [role=button], [role=combobox], [role=checkbox]'

/** Controls a person can reach, minus the visually hidden file chooser that a
 *  named button opens for them. */
function unnamedControls(root: ParentNode = document): string[] {
  const bad: string[] = []
  root.querySelectorAll(CONTROLS).forEach((el) => {
    if ((el as HTMLInputElement).type === 'file') return
    // A text box whose visible placeholder says what goes in it is named.
    if ((el as HTMLInputElement).placeholder) return
    try {
      expect(el).toHaveAccessibleName()
    } catch {
      bad.push(el.outerHTML.slice(0, 120))
    }
  })
  return bad
}

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Named Parent',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label' }],
  })
  await admin.post('/api/table_def', {
    name: 'Named Thing',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true, reqd: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
      { column_name: 'notes', column_type: 'Text', label: 'Notes' },
      { column_name: 'due', column_type: 'Date', label: 'Due' },
      { column_name: 'guardian', column_type: 'Reference', label: 'Parent', reference_table: 'Named Parent' },
      { column_name: 'proof', column_type: 'Attach', label: 'Proof' },
    ],
  })
  return admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Named Thing',
    row: { title: 'one', stage: 'Open' },
  })
}

test('Controls are clearly named: every control on a row\'s form has a name', async ({ admin }) => {
  const row = await seed(admin)
  await renderApp(`/featherbase/admin/Named%20Thing/${row.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await screen.findByLabelText('Title')
  expect(unnamedControls(screen.getByTestId('form-view'))).toEqual([])
})

test('Controls are clearly named: every control in the top bar and the search bar has a name', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/Named%20Thing', admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  expect(unnamedControls(screen.getByRole('banner'))).toEqual([])
})

// SPEC: Controls are clearly named — suspected defect, see report.
// On a Table's list the filter pickers, the select-all and per-row checkboxes
// and the bulk "Edit field" picker carry no name at all.
test.fails('Controls are clearly named: every control on a Table\'s list has a name, including the row checkboxes and filter pickers', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Named Thing', row: { title: 'two', stage: 'Closed' } })
  await renderApp('/featherbase/admin/Named%20Thing', admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  fireEvent.click(await screen.findAllByTestId('row-check').then((l) => l[0]))
  await screen.findByTestId('bulk-bar')
  expect(unnamedControls(screen.getByTestId('list-view'))).toEqual([])
  expect(within(screen.getByTestId('list-view')).getAllByRole('checkbox').length).toBeGreaterThan(1)
})
