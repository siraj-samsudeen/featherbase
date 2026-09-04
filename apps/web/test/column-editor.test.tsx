// #209 (issue #197): changing a Table's columns after the rows are in it.
//
// "After importing I want to add a certain column but today it is not
// possible", and "in one of the things floor was spelled with a G, Glor".
//
// This is the component layer, not e2e, because everything here is what
// docs/TESTING.md puts on layer 2: rendering from metadata, form-interaction
// logic, and what did or did not reach the server. The browser adds nothing
// to any of it. `e2e/column-editor.spec.ts` keeps the part a browser does
// add — arriving from the Table's own list view, and the route.
//
// The server is the real in-process one against the sandboxed database, so
// a rename here performs the real DDL and the assertion that the rows came
// with it is a real one.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Ce Zones'

type Admin = Parameters<typeof renderApp>[1]
interface Meta {
  columns: { column_name: string; label: string }[]
}

async function seed(admin: Admin, extra: Record<string, unknown> = {}) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data', in_list_view: true },
      { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
    ],
    ...extra,
  })
  for (const [glor, pop] of [
    ['Ground', 12],
    ['Mezzanine', 7],
  ] as [string, number][])
    await admin.post('/api/save_row', { table: DT, row: { glor, pop } })
}

async function openEditor(admin: Admin, table = DT) {
  await renderApp(`/admin/${encodeURIComponent(table)}/columns`, admin)
  await screen.findByTestId('column-editor')
}

const meta = (admin: Admin) => admin.get<Meta>(`/api/table/${encodeURIComponent(DT)}:meta`) as Promise<Meta>

async function zoneRows(admin: Admin, fields: string[]) {
  const list = (await admin.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      JSON.stringify(fields),
    )}&limit_page_length=50`,
  )) as { data: Record<string, unknown>[] }
  return list.data
}

test('the editor lists the Table it is for, column by column', async ({ admin }) => {
  await seed(admin)
  await openEditor(admin)

  await screen.findByTestId('ce-row-glor')
  expect(screen.getByTestId('ce-row-pop')).toBeInTheDocument()
  // The label is editable; the machine name is stated beside it, not guessed at.
  expect(screen.getByTestId('ce-label-glor')).toHaveValue('Glor')
  expect(within(screen.getByTestId('ce-row-glor')).getByText('glor')).toBeInTheDocument()
})

test('a misspelled column is renamed and its rows come with it', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.click(await screen.findByTestId('ce-rename-glor'))
  const field = screen.getByTestId('ce-rename-input-glor')
  await user.clear(field)
  await user.type(field, 'floor')
  await user.click(screen.getByTestId('ce-rename-go-glor'))

  await waitFor(() => expect(screen.getByTestId('ce-row-floor')).toBeInTheDocument())
  expect(screen.queryByTestId('ce-row-glor')).not.toBeInTheDocument()

  // The point of a rename rather than a new column: the data was already right.
  const rows = await zoneRows(admin, ['floor', 'pop'])
  expect(rows.map((r) => r.floor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a rename that collides is refused in place, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.click(await screen.findByTestId('ce-rename-glor'))
  const field = screen.getByTestId('ce-rename-input-glor')
  await user.clear(field)
  await user.type(field, 'pop')
  await user.click(screen.getByTestId('ce-rename-go-glor'))

  await waitFor(() =>
    expect(screen.getByTestId('ce-rename-error-glor')).toHaveTextContent(/already has/),
  )
  // And nothing moved.
  expect(screen.getByTestId('ce-row-glor')).toBeInTheDocument()
  expect(screen.getByTestId('ce-row-pop')).toBeInTheDocument()
})

test('a column is added, empty on the rows that already exist', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  // The machine name follows the label until the user claims it.
  await user.type(await screen.findByTestId('ce-add-label'), 'Aisle Code')
  expect(screen.getByTestId('ce-add-name')).toHaveValue('aisle_code')
  await user.click(screen.getByTestId('ce-add-go'))

  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('Added aisle_code'))
  expect(screen.getByTestId('ce-row-aisle_code')).toBeInTheDocument()

  const rows = await zoneRows(admin, ['glor', 'aisle_code'])
  expect(rows).toHaveLength(2)
  expect(rows.every((r) => r.aisle_code === null || r.aisle_code === undefined)).toBe(true)
  expect(rows.map((r) => r.glor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a name the server would reject is caught before the round trip', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  const name = await screen.findByTestId('ce-add-name')
  await user.type(screen.getByTestId('ce-add-label'), 'Glor')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('already has glor'),
  )
  expect(screen.getByTestId('ce-add-go')).toBeDisabled()

  await user.clear(name)
  await user.type(name, 'created_at')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('standard column'),
  )

  await user.clear(name)
  await user.type(name, 'Not Snake')
  await waitFor(() => expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('snake_case'))

  await user.clear(name)
  await user.type(name, 'aisle')
  await waitFor(() => expect(screen.getByTestId('ce-add-go')).toBeEnabled())
  // Nothing was sent while it was refused.
  expect((await meta(admin)).columns.map((c) => c.column_name)).toEqual(['glor', 'pop'])
})

test('a Choice column must carry its choices before it can be added', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  await user.type(await screen.findByTestId('ce-add-label'), 'Stage')
  await user.selectOptions(screen.getByTestId('ce-add-type'), 'Choice')
  await waitFor(() =>
    expect(screen.getByTestId('ce-add-problem')).toHaveTextContent('needs its choices'),
  )
  await user.type(screen.getByTestId('ce-add-target'), 'New\nDone')
  await user.click(screen.getByTestId('ce-add-go'))

  await waitFor(() => expect(screen.getByTestId('ce-row-stage')).toBeInTheDocument())
})

test('a label is changed without touching the column or its data', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await openEditor(admin)

  const label = await screen.findByTestId('ce-label-glor')
  await user.clear(label)
  await user.type(label, 'Floor')
  await user.click(screen.getByTestId('ce-label-save-glor'))

  await waitFor(() => expect(screen.getByTestId('ce-saved')).toHaveTextContent('glor'))
  const def = await meta(admin)
  expect(def.columns.find((c) => c.column_name === 'glor')?.label).toBe('Floor')
  // The machine name — and therefore every row — is untouched.
  expect((await zoneRows(admin, ['glor'])).map((r) => r.glor).sort()).toEqual([
    'Ground',
    'Mezzanine',
  ])
})

test('a system Table refuses the whole editor', async ({ admin }) => {
  await openEditor(admin, 'Import Log')
  await waitFor(() =>
    expect(screen.getByTestId('ce-system')).toHaveTextContent(/system Table/),
  )
  expect(screen.queryByTestId('ce-add')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ce-rename-file_name')).not.toBeInTheDocument()
})
