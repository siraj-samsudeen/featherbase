// The FormView paths the merged web coverage report (ADR 0012) showed no test
// taking: editing a yes/no, a date and a date-time and reordering sub-table
// rows; jumping to a linked row; renaming a row (and a rename the server
// refuses); client scripts that run on load, or fail on load or while
// running; and backing out of the delete confirmation three ways. Each asserts the stored
// row, or the page the user is left on.
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../src/router'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Saved = { row_id: string; updated_at: string }
type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Fx Store', id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data', label: 'City' }],
  })
  await admin.post('/api/table_def', {
    name: 'Fx Step', kind: 'sub_table',
    columns: [{ column_name: 'step', column_type: 'Data', label: 'Step' }],
  })
  await admin.post('/api/table_def', {
    name: 'Fx Visit', id_pattern: 'prompt',
    columns: [
      { column_name: 'store', column_type: 'Reference', label: 'Store', reference_table: 'Fx Store' },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
      { column_name: 'due', column_type: 'Date', label: 'Due' },
      { column_name: 'met_at', column_type: 'Datetime', label: 'Met at' },
      { column_name: 'note', column_type: 'Data', label: 'Note' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
      { column_name: 'steps', column_type: 'Sub-table', label: 'Steps', row_table: 'Fx Step' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Fx Store', row: { row_id: 'store-1', city: 'Kochi' } })
  await admin.post('/api/save_row', { table: 'Fx Store', row: { row_id: 'store-2', city: 'Madurai' } })
  return admin.post<Saved>('/api/save_row', {
    table: 'Fx Visit',
    row: { row_id: 'visit-1', store: 'store-1', steps: [{ step: 'first' }, { step: 'second' }] },
  })
}

const stored = (admin: Admin, id = 'visit-1') =>
  admin.get<Record<string, unknown> & { steps: { step: string }[] }>(`/api/table/${enc('Fx Visit')}/${enc(id)}`)

test('a yes/no, a date, a date-time and the order of sub-table rows are saved as edited', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('done')).toBeInTheDocument())

  await user.click((await screen.findAllByRole('button', { name: 'Move row up' }))[0])
  await user.click(screen.getAllByRole('button', { name: 'Move row down' })[1])
  expect([...document.querySelectorAll<HTMLInputElement>('[data-childfield="step"]')].map((input) => input.value)).toEqual(['first', 'second'])
  await user.click(field('done'))
  fireEvent.change(field('due'), { target: { value: '2026-11-05' } })
  fireEvent.change(field('met_at'), { target: { value: '2026-11-05T09:30' } })
  await user.click((await screen.findAllByRole('button', { name: 'Move row down' }))[0])
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))

  const row = await stored(admin)
  expect(row.done).toBe(true)
  expect(String(row.due).slice(0, 10)).toBe('2026-11-05')
  expect(new Date(String(row.met_at)).toISOString()).toBe(new Date('2026-11-05T09:30').toISOString())
  expect(row.steps.map((s) => s.step)).toEqual(['second', 'first'])

  // Clearing the date stores nothing rather than an empty string.
  fireEvent.change(field('due'), { target: { value: '' } })
  fireEvent.change(field('met_at'), { target: { value: '' } })
  await user.click(screen.getByTestId('form-save'))
  await waitFor(async () => {
    const again = await stored(admin)
    expect(again.due).toBeNull()
    expect(again.met_at).toBeNull()
  })
})

test('an invalid date-time set by a client script stays editable instead of breaking the form', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-invalid-datetime', ref_table: 'Fx Visit', enabled: true,
      script: `featherbase.ui.form.on('Fx Visit', { onload: function (frm) { frm.set_value('met_at', 'not-a-date') } })`,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  await screen.findByTestId('form-view')
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved'))
  expect(field('met_at')).toHaveValue('')
  fireEvent.change(field('met_at'), { target: { value: '2026-11-05T09:30' } })
  await userEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  expect(new Date(String((await stored(admin)).met_at)).toISOString()).toBe(new Date('2026-11-05T09:30').toISOString())
})

test('the ↗ beside a linked row opens that row', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  fireEvent.mouseDown(await screen.findByTestId('link-open-store', {}, { timeout: 8000 }))
  await waitFor(() => expect(field('city')).toHaveValue('Kochi'))
  expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Fx Store')
})

test('renaming a row moves the links to it; a name already taken is refused and nothing moves', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Fx Store')}/store-1`, admin)
  await user.click(await screen.findByTestId('form-rename', {}, { timeout: 8000 }))
  // Cancel leaves the name alone.
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('form-rename'))
  await user.clear(screen.getByTestId('rename-input'))
  await user.type(screen.getByTestId('rename-input'), 'store-2')
  await user.click(screen.getByTestId('rename-confirm'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent(/store-2/))
  expect((await stored(admin)).store).toBe('store-1')

  await user.clear(screen.getByTestId('rename-input'))
  await user.type(screen.getByTestId('rename-input'), 'store-kochi')
  await user.click(screen.getByTestId('rename-confirm'))
  await waitFor(() => expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('store-kochi'))
  expect(field('city')).toHaveValue('Kochi')
  expect((await stored(admin)).store).toBe('store-kochi')
})

// SPEC (CUST-003): an onload handler sees the loaded row and its changes add to
// it (#538: it used to fire against the empty pre-load doc, and its set_value
// then replaced the loaded values, opening the form with every other field
// blank).
test('a client script runs on load against the loaded row, keeping its values', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-onload',
      ref_table: 'Fx Visit',
      enabled: true,
      script: `
        featherbase.ui.form.on('Fx Visit', { onload: function (frm) { frm.set_value('note', 'opened ' + frm.doc.row_id) } })
        featherbase.ui.form.on('Fx Store', { onload: function (frm) { frm.set_value('note', 'wrong table') } })
      `,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('note')).toHaveValue('opened visit-1'), { timeout: 3000 })
  expect(field('store')).toHaveValue('store-1')
})

// #538: on-load runs once per row opened — the refetch after the user's own
// save must not run it again and mark the just-saved form "Not saved".
test('a client script runs on load once: after saving, the form stays saved', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-onload-once',
      ref_table: 'Fx Visit',
      enabled: true,
      script: `featherbase.ui.form.on('Fx Visit', { onload: function (frm) { frm.set_value('qty', Number(frm.doc.qty || 0) + 1) } })`,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('qty')).toHaveValue(1), { timeout: 3000 })
  expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')

  fireEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'))
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.getByTestId('form-status')).toHaveTextContent('Saved')
  expect(field('qty')).toHaveValue(1)
  expect(Number((await stored(admin)).qty)).toBe(1)
})

// #538 (Codex review): the dev app mounts under StrictMode, which replays
// effects. Reopening a row whose row and scripts are already cached must
// still keep what on-load set, not reset it on the replay.
test('a client script runs on load against a cached row under StrictMode, keeping its change', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-onload-strict',
      ref_table: 'Fx Visit',
      enabled: true,
      script: `featherbase.ui.form.on('Fx Visit', { onload: function (frm) { frm.set_value('note', 'opened ' + frm.doc.row_id) } })`,
    },
  })
  const path = `/featherbase/admin/${enc('Fx Visit')}/visit-1`
  const first = await renderApp(path, admin)
  await waitFor(() => expect(field('note')).toHaveValue('opened visit-1'), { timeout: 8000 })
  const { queryClient } = first
  cleanup()

  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>,
  )
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('note')).toHaveValue('opened visit-1'), { timeout: 3000 })
  expect(field('store')).toHaveValue('store-1')
  expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')
})

test('a client script that fails while running says so, can be dismissed, and the form still saves', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-qty',
      ref_table: 'Fx Visit',
      enabled: true,
      script: `featherbase.ui.form.on('Fx Visit', {
        qty: function (frm) { if (Number(frm.get_value('qty')) === 13) throw new Error('unlucky number') },
      })`,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('qty')).toBeInTheDocument())

  await user.type(field('qty'), '13')
  fireEvent.blur(field('qty'))
  const banner = await screen.findByTestId('client-script-error')
  expect(banner).toHaveTextContent('Client script error (qty): unlucky number')
  await user.click(within(banner).getByRole('button', { name: 'dismiss' }))
  expect(screen.queryByTestId('client-script-error')).not.toBeInTheDocument()
  // The value typed is kept and saves.
  await user.click(screen.getByTestId('form-save'))
  await waitFor(async () => expect(Number((await stored(admin)).qty)).toBe(13))
})

test('a client script whose load handler fails says so instead of breaking the form', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'fx-onload-broken',
      ref_table: 'Fx Visit',
      enabled: true,
      script: `featherbase.ui.form.on('Fx Visit', { onload: function () { throw new Error('cannot start') } })`,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  expect(await screen.findByTestId('client-script-error', {}, { timeout: 8000 })).toHaveTextContent(
    'Client script error (onload): cannot start',
  )
  expect(screen.getByTestId('form-view')).toBeInTheDocument()
})

test('the delete confirmation can be backed out of with Cancel, Escape or a click outside', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Fx Visit')}/visit-1`, admin)
  const open = async () => {
    await user.click(await screen.findByTestId('form-delete', {}, { timeout: 8000 }))
    return screen.getByTestId('delete-row-dialog')
  }
  await user.click(within(await open()).getByTestId('delete-row-cancel'))
  expect(screen.queryByTestId('delete-row-dialog')).not.toBeInTheDocument()
  fireEvent.keyDown(await open(), { key: 'Escape' })
  expect(screen.queryByTestId('delete-row-dialog')).not.toBeInTheDocument()
  fireEvent.click((await open()).parentElement!)
  expect(screen.queryByTestId('delete-row-dialog')).not.toBeInTheDocument()
  expect((await stored(admin)).row_id).toBe('visit-1')
})
