// TLC-J1 / TLC-J2 (table lifecycle). The rule these journeys hold (TLC-H2):
// after the entry point a journey never navigates by address. Every step is
// reached by clicking what a person would click — a test that renders
// `/…/new` directly proves the form works and says nothing about whether
// anyone could have opened it (#247).
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const NOTE = 'Journey Lifecycle Note'
const REF = 'Journey Lifecycle Ref'
const SUB = 'Journey Lifecycle Line'
const LIST = `/featherbase/admin/table/${tableSlug(NOTE)}`
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('TLC-J1 / TLC-R1 / TLC-I1: declare a table, then reach its first row by clicking — never by address', async ({ admin }) => {
  const user = userEvent.setup()
  // J1.1 — the journey's one and only navigation by address.
  const app = await renderApp('/featherbase/admin/new-table', admin)
  await user.type(await screen.findByTestId('dt-name', {}, { timeout: 8000 }), NOTE)
  const row = screen.getByTestId('dt-fields').querySelector<HTMLElement>('tbody tr[data-columnrow]')!
  await user.type(row.querySelector<HTMLInputElement>('[data-rowfield=column_name]')!, 'body')
  await user.type(row.querySelector<HTMLInputElement>('[data-rowfield=label]')!, 'Body')
  const inList = row.querySelector<HTMLInputElement>('[data-rowfield=in_list_view]')!
  if (!inList.checked) await user.click(inList)
  await user.click(screen.getByTestId('dt-create'))

  // The round trip closes on the Table, not the builder.
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  expect(here(app)).toBe(LIST)
  await waitFor(() => expect(screen.getByTestId('list-total')).toHaveTextContent('0 total'))

  // J1.2 — Report and Import sit behind the toolbar's disclosures; New is in the toolbar.
  await user.click(screen.getByRole('button', { name: 'View: List' }))
  expect(await screen.findByTestId('open-report')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View: List' }))
  await user.click(screen.getByRole('button', { name: 'List actions' }))
  expect(await screen.findByTestId('open-import')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'List actions' }))
  expect(screen.getByTestId('list-new')).toBeInTheDocument()
  // The empty Table offers the same way forward inline.
  expect(await screen.findByTestId('list-empty-new')).toBeInTheDocument()

  // J1.3 — click New. From here on, only clicks.
  await user.click(screen.getByTestId('list-new'))
  await waitFor(() => expect(here(app)).toBe(`${LIST}/new`))
  expect(await screen.findByTestId('form-view')).toBeInTheDocument()
  const body = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-field="body"]')
    expect(el).not.toBeNull()
    return el!
  })

  // J1.4 — the form stops being "New document" and becomes a row of its own.
  expect(screen.getByTestId('form-status')).toHaveTextContent('New document')
  await user.type(body, 'the first note')
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'), { timeout: 8000 })
  expect(here(app)).not.toBe(`${LIST}/new`)

  // J1.5 — back to the list through the breadcrumb.
  await user.click(within(screen.getByTestId('breadcrumbs')).getByText(NOTE))
  await waitFor(() => expect(here(app)).toBe(LIST))
  await waitFor(() => expect(screen.getByTestId('list-total')).toHaveTextContent('1 total'))
  expect(screen.getByTestId('list-rows')).toHaveTextContent('the first note')
}, 30_000)

test('TLC-R1.settings: a settings Table opens its single row and offers no create affordance', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/system-settings', admin)
  expect(await screen.findByTestId('form-view', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('list-new')).not.toBeInTheDocument()
})

test('TLC-R1.sub_table: a child Table reached directly offers no create affordance', async ({ admin }) => {
  // A child row exists only inside a parent: the server refuses a direct
  // insert, so an affordance here could only produce an error.
  await admin.post('/api/table_def', { name: SUB, kind: 'sub_table', columns: [{ column_name: 'line', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/table/${tableSlug(SUB)}`, admin)
  expect(await screen.findByTestId('list-view', {}, { timeout: 8000 })).toBeInTheDocument()
  await screen.findByTestId('list-total')
  expect(screen.queryByTestId('list-new')).not.toBeInTheDocument()
  expect(screen.queryByTestId('list-empty-new')).not.toBeInTheDocument()
})

async function seedNotes(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', { name: NOTE, id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: REF, id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Reference', reference_table: NOTE }] })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-1', body: 'spoken for' } })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'note-2', body: 'a mistake' } })
  await admin.post('/api/save_row', { table: REF, row: { row_id: 'ref-1', note: 'note-1' } })
}

test('TLC-J2 / TLC-R4: a row is deleted from its own form, behind a confirmation that names it', async ({ admin }) => {
  await seedNotes(admin)
  const user = userEvent.setup()
  const app = await renderApp(`${LIST}/row/note-2`, admin)

  // J2.1 — Record actions holds Rename and Delete.
  await user.click(await screen.findByRole('button', { name: 'Record actions' }, { timeout: 8000 }))
  expect(await screen.findByTestId('form-rename')).toBeInTheDocument()
  expect(screen.getByTestId('form-delete')).toBeInTheDocument()

  // J2.2 — the confirmation names the row; Cancel leaves it where it was.
  await user.click(screen.getByTestId('form-delete'))
  const dialog = await screen.findByTestId('delete-row-dialog')
  expect(dialog).toHaveTextContent(`Delete ${NOTE}: a mistake?`)
  expect(dialog).toHaveTextContent('This cannot be undone')
  await user.click(within(dialog).getByTestId('delete-row-cancel'))
  expect(screen.queryByTestId('delete-row-dialog')).not.toBeInTheDocument()
  expect(here(app)).toBe(`${LIST}/row/note-2`)
  expect(screen.getByTestId('form-view')).toBeInTheDocument()

  // J2.3 — confirm: on the list, the row gone, the total moved.
  await user.click(screen.getByRole('button', { name: 'Record actions' }))
  await user.click(await screen.findByTestId('form-delete'))
  await user.click(within(await screen.findByTestId('delete-row-dialog')).getByTestId('delete-row-confirm'))
  await waitFor(() => expect(here(app)).toBe(LIST), { timeout: 8000 })
  await waitFor(() => expect(screen.getByTestId('list-total')).toHaveTextContent('1 total'))
  expect(screen.getByTestId('list-rows')).not.toHaveTextContent('a mistake')
})

test('TLC-R3.referenced: deleting a referenced row is refused in the dialog, naming what holds it', async ({ admin }) => {
  await seedNotes(admin)
  const user = userEvent.setup()
  const app = await renderApp(`${LIST}/row/note-1`, admin)
  await user.click(await screen.findByRole('button', { name: 'Record actions' }, { timeout: 8000 }))
  await user.click(await screen.findByTestId('form-delete'))
  await user.click(within(await screen.findByTestId('delete-row-dialog')).getByTestId('delete-row-confirm'))
  expect(await screen.findByTestId('delete-row-error', {}, { timeout: 8000 })).toHaveTextContent('ref-1')
  expect(here(app)).toBe(`${LIST}/row/note-1`)
  expect(await admin.get(`/api/table/${encodeURIComponent(NOTE)}/note-1`)).toMatchObject({ body: 'spoken for' })
})
