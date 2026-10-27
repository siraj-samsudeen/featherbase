// FormView paths the merged web coverage report (ADR 0012) still showed red
// after form-extras: a row that cannot be loaded, a Submit someone else beat
// the person to, long text typed into a Text column, a Reference to a service
// account shown by its label, a Reference search the server refuses, an
// attachment the server refuses, an onload handler reading a value, and JSON
// typed into a JSON column (one suspected defect, pinned). Each failure is a
// real server answer — a deleted row, a refused permission.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const field = (name: string) => document.querySelector<HTMLElement>(`[data-field=${name}]`) as HTMLInputElement

afterEach(() => vi.unstubAllGlobals())

async function seedNotes(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Frf Note',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title' },
      { column_name: 'body', column_type: 'Long Text', label: 'Body' },
      { column_name: 'scan', column_type: 'Attach', label: 'Scan' },
      { column_name: 'extra', column_type: 'JSON', label: 'Extra' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Frf Note', row: { row_id: 'note-1', title: 'first' } })
}

test('a row that is not there says it cannot be loaded', async ({ admin }) => {
  await seedNotes(admin)
  await renderApp(`/featherbase/admin/${enc('Frf Note')}/no-such-note`, admin)
  expect(await screen.findByText('Cannot load Frf Note no-such-note', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('form-save')).not.toBeInTheDocument()
})

test('long text typed into a Text column is saved', async ({ admin }) => {
  const user = userEvent.setup()
  await seedNotes(admin)
  await renderApp(`/featherbase/admin/${enc('Frf Note')}/note-1`, admin)
  await waitFor(() => expect(field('body')).toBeInTheDocument(), { timeout: 8000 })
  await user.type(field('body'), 'line one')
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  expect(((await admin.get(`/api/table/${enc('Frf Note')}/note-1`)) as { body: string }).body).toBe('line one')
})

// SPEC: a JSON column holds the JSON value the person typed into it (the form
// shows a stored object as JSON text, so typing JSON back is how it is edited)
// — suspected defect: the form sends the text as it is, and the column stores
// a JSON *string* ("{\"shelf\": 3}") rather than the object { shelf: 3 }.
test.fails('JSON typed into a JSON column is saved as that JSON', async ({ admin }) => {
  await seedNotes(admin)
  await renderApp(`/featherbase/admin/${enc('Frf Note')}/note-1`, admin)
  await waitFor(() => expect(field('extra')).toBeInTheDocument(), { timeout: 8000 })
  fireEvent.change(field('extra'), { target: { value: '{"shelf": 3}' } })
  await userEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  expect(((await admin.get(`/api/table/${enc('Frf Note')}/note-1`)) as { extra: unknown }).extra).toEqual({ shelf: 3 })
})

test('submitting a row someone else already submitted is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Frf Order',
    id_pattern: 'prompt',
    is_submittable: true,
    columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }],
  })
  await admin.post('/api/save_row', { table: 'Frf Order', row: { row_id: 'ord-1', item: 'tea' } })
  await renderApp(`/featherbase/admin/${enc('Frf Order')}/ord-1`, admin)
  const submit = await screen.findByTestId('form-submit', {}, { timeout: 8000 })
  await admin.post(`/api/table/${enc('Frf Order')}/ord-1:submit`)
  await user.click(submit)
  await waitFor(() => expect(screen.getByTestId('form-banner')).not.toBeEmptyDOMElement())
  expect(screen.getByTestId('form-banner')).toHaveTextContent('Frf Order ord-1 has status submitted; expected draft')
  expect(((await admin.get(`/api/table/${enc('Frf Order')}/ord-1`)) as { status: string }).status).toBe('submitted')
})

test('a Reference to a service account shows the account by its label, not its id', async ({ admin }) => {
  const bot = (await admin.post('/api/service_accounts', { label: 'svc-frf-stock-bot' })) as { row_id: string }
  await admin.post('/api/table_def', {
    name: 'Frf Job',
    id_pattern: 'prompt',
    columns: [{ column_name: 'runner', column_type: 'Reference', label: 'Runner', reference_table: 'Service Account' }],
  })
  await admin.post('/api/save_row', { table: 'Frf Job', row: { row_id: 'job-1', runner: bot.row_id } })
  await renderApp(`/featherbase/admin/${enc('Frf Job')}/job-1`, admin)
  await waitFor(() => expect(field('runner')).toHaveValue('svc-frf-stock-bot'), { timeout: 8000 })
  expect(field('runner')).not.toHaveValue(bot.row_id)
})

test('a Reference search the server refuses offers no matches rather than failing', async ({ admin, createUser }) => {
  // The clerk may edit Frf Visit but not read the Frf Depot it points at.
  await admin.post('/api/table_def', { name: 'Frf Depot', id_pattern: 'prompt', columns: [{ column_name: 'city', column_type: 'Data' }] })
  await admin.post('/api/table_def', {
    name: 'Frf Visit',
    id_pattern: 'prompt',
    columns: [{ column_name: 'depot', column_type: 'Reference', label: 'Depot', reference_table: 'Frf Depot' }],
  })
  await admin.post('/api/save_row', { table: 'Frf Depot', row: { row_id: 'depot-1', city: 'Kochi' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Frf Visitor' } })
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: 'Frf Visit', role: 'Frf Visitor', can_read: true, can_write: true, can_create: true },
  })
  await admin.post('/api/save_row', { table: 'Frf Visit', row: { row_id: 'visit-1' } })
  const clerk = await createUser({ roles: ['Frf Visitor'] })
  await expect(clerk.get(`/api/table/${enc('Frf Depot')}`)).rejects.toMatchObject({ status: 403 })

  await renderApp(`/featherbase/admin/${enc('Frf Visit')}/visit-1`, clerk)
  await waitFor(() => expect(field('depot')).toBeInTheDocument(), { timeout: 8000 })
  fireEvent.change(field('depot'), { target: { value: 'Ko' } })
  await new Promise((r) => setTimeout(r, 400))
  expect(screen.queryAllByTestId('link-option')).toHaveLength(0)
  expect(screen.queryByTestId('link-options-depot')).not.toBeInTheDocument()
})

test('a file attached to a row deleted meanwhile is refused and nothing is attached', async ({ admin }) => {
  await seedNotes(admin)
  await renderApp(`/featherbase/admin/${enc('Frf Note')}/note-1`, admin)
  await waitFor(() => expect(field('scan')).toBeInTheDocument(), { timeout: 8000 })
  await admin.delete(`/api/table/${enc('Frf Note')}/note-1`)
  await useNodeMultipart()
  const file = pickedFile('scan.txt', 'scan bytes')
  fireEvent.change(document.querySelector('[data-attach-input=scan]')!, { target: { files: [file] } })
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  expect(document.querySelector('[data-testid=attach-link-scan]')).toBeNull()
})

test("an onload handler's get_value reads the same row frm.doc holds", async ({ admin }) => {
  await seedNotes(admin)
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: {
      row_id: 'frf-onload',
      ref_table: 'Frf Note',
      enabled: true,
      script: `featherbase.ui.form.on('Frf Note', { onload: function (frm) {
        throw new Error('agrees: ' + (frm.get_value('title') === frm.doc.title))
      } })`,
    },
  })
  await renderApp(`/featherbase/admin/${enc('Frf Note')}/note-1`, admin)
  expect(await screen.findByTestId('client-script-error', {}, { timeout: 8000 })).toHaveTextContent(
    'Client script error (onload): agrees: true',
  )
})
