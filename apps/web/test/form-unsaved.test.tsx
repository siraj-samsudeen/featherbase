// #1009: a change that looks done but isn't saved must be hard to miss. Every
// form keeps Save in view while it has unsaved changes, and asks before leaving.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { rowHref, tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 10_000 }
const TABLE = 'Unsaved Desk'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: TABLE, id_pattern: 'prompt', title_column: 'label', columns: [
    { column_name: 'label', column_type: 'Data' }, { column_name: 'note', column_type: 'Data' },
  ] })
  await admin.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: 'D-1', label: 'First', note: 'old' })
}

const bar = () => screen.queryByTestId('form-unsaved-bar')
const note = () => screen.findByLabelText('Note', {}, WAIT)
const listLink = () => within(screen.getByTestId('breadcrumbs')).getByRole('link', { name: TABLE })

test('the bar shows only with unsaved changes, and its Save stores them', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(TABLE, 'D-1'), admin)
  const field = await note()
  expect(bar()).not.toBeInTheDocument()
  await userEvent.type(field, ' new')
  expect(within(bar()!).getByText('Unsaved changes')).toBeInTheDocument()
  // The page's own Save keeps its name, so the two can be told apart.
  expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
  await userEvent.click(within(bar()!).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(bar()).not.toBeInTheDocument(), WAIT)
  expect((await admin.get<{ note: string }>(`/api/table/${encodeURIComponent(TABLE)}/D-1`)).note).toBe('old new')
})

test('putting a change back takes the bar away', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(TABLE, 'D-1'), admin)
  const field = await note()
  await userEvent.type(field, 'x')
  expect(bar()).toBeInTheDocument()
  await userEvent.type(field, '{Backspace}')
  expect(bar()).not.toBeInTheDocument()
})

test('a row the person can only read never shows it', async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Unsaved Reader' } })
  await grantRole(admin, { table: TABLE, role: 'Unsaved Reader', can_read: true })
  const reader = await createUser({ roles: ['Unsaved Reader'] })
  await renderApp(rowHref(TABLE, 'D-1'), reader)
  expect(await screen.findByTestId('value-note', {}, WAIT)).toBeInTheDocument()
  expect(bar()).not.toBeInTheDocument()
})

test('leaving with unsaved changes asks first: Stay keeps the edit, Leave goes', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(TABLE, 'D-1'), admin)
  const field = await note()
  await userEvent.type(field, ' new')

  await userEvent.click(listLink())
  const dialog = await screen.findByTestId('unsaved-leave-dialog', {}, WAIT)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))
  await waitFor(() => expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument())
  expect(await note()).toHaveValue('old new')

  await userEvent.click(listLink())
  await userEvent.click(within(await screen.findByTestId('unsaved-leave-dialog', {}, WAIT)).getByRole('button', { name: 'Leave without saving' }))
  await waitFor(() => expect(screen.queryByTestId('form-view')).not.toBeInTheDocument(), WAIT)
})

test('with nothing unsaved, leaving asks nothing', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(TABLE, 'D-1'), admin)
  await note()
  await userEvent.click(listLink())
  await waitFor(() => expect(screen.queryByTestId('form-view')).not.toBeInTheDocument(), WAIT)
  expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument()
})

test('saving a new row goes to it without asking', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(TABLE)}/new`, admin)
  await userEvent.type(await screen.findByLabelText(/Row ID/, {}, WAIT), 'D-2')
  await userEvent.type(await screen.findByLabelText('Label', {}, WAIT), 'Second')
  await userEvent.click(within(bar()!).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second'), WAIT)
  expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument()
})

test('a new row holding only prefilled values has nothing to lose', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref(TABLE)}/new?prefill=${encodeURIComponent(JSON.stringify({ note: 'from a link' }))}`, admin)
  expect(await note()).toHaveValue('from a link')
  expect(screen.getByTestId('form-save')).toBeEnabled()
  expect(bar()).not.toBeInTheDocument()
  await userEvent.click(listLink())
  await waitFor(() => expect(screen.queryByTestId('form-view')).not.toBeInTheDocument(), WAIT)
  expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument()
})

test('switching tabs on the same row asks nothing and keeps the edit', async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(TABLE, 'D-1'), admin)
  await userEvent.type(await note(), ' new')
  await userEvent.click(screen.getByRole('tab', { name: 'Activity' }))
  expect(screen.queryByTestId('unsaved-leave-dialog')).not.toBeInTheDocument()
  expect(bar()).toBeInTheDocument()
})

test('adding a role row on a Person brings up the bar', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Unsaved Role' } })
  const person = await createUser({ roles: [] })
  await renderApp(rowHref('Person', person.user!), admin)
  const add = await screen.findByTestId('add-row-roles', {}, WAIT)
  expect(bar()).not.toBeInTheDocument()
  await userEvent.click(add)
  await waitFor(() => expect(bar()).toBeInTheDocument())
})
