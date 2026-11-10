// record-workspace's scenarios, as a person reads them on screen (#1070).
// Each test is one fenced scenario of
// openspec/specs/record-workspace/spec.md, step by step, rendered in jsdom
// against the real in-process server. The Plant row for Tenkasi (9154) is the
// running example.
import { cleanup, configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, vi } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { deleteStored } from 'server/src/storage'
import { grantRole, patchDoc } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, byTestId } from '../pg-test'
import { useNodeMultipart } from '../node-multipart'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
const scenario = scenarioFor(test, 'record-workspace')

const stored: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  // An upload lands on disk, outside the rolled-back transaction.
  for (const url of stored.splice(0)) await deleteStored(url).catch(() => {})
})

async function plant(admin: Client) {
  await admin.post('/api/table_def', {
    name: 'Plant', id_pattern: 'prompt', title_column: 'plant_name',
    columns: [{ column_name: 'plant_name', column_type: 'Data', label: 'Plant name', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: 'Plant', row: { row_id: '9154', plant_name: 'Tenkasi' } })
}

/** A role that may read Plant and nothing else, as `readerRoleFor` made it. */
async function plantReader(admin: Client, createUser: (o: { email?: string; roles?: string[] }) => Promise<Client>) {
  await grantRole(admin, { role: 'Plant Reader', table: 'Plant', can_read: true })
  return createUser({ email: 'plant.reader@example.com', roles: ['Plant Reader'] })
}

/** Tenkasi with an assignment, a tag, a file, a discussion and a recorded edit, all with collaboration off. */
async function collaborate(admin: Client) {
  await plant(admin)
  await admin.post('/api/assign', { table: 'Plant', row_id: '9154', assign_to: admin.user })
  await admin.post('/api/tags', { table: 'Plant', row_id: '9154', tag: 'priority' })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'Plant', ref_name: '9154', content: 'Supplier called' } })
  await useNodeMultipart()
  const form = new FormData()
  form.append('file', new File(['Plant note'], 'plant-note.txt', { type: 'text/plain' }))
  form.append('ref_table', 'Plant')
  form.append('ref_name', '9154')
  const upload = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
  expect(upload.status).toBe(201)
  stored.push(((await upload.json()) as { file_url: string }).file_url)
  const row = await admin.get<{ updated_at: string }>('/api/table/Plant/9154')
  await patchDoc(admin, '/api/table/Plant/9154', { plant_name: 'Tenkasi before review', updated_at: row.updated_at })
  const edited = await admin.get<{ updated_at: string }>('/api/table/Plant/9154')
  await patchDoc(admin, '/api/table/Plant/9154', { plant_name: 'Tenkasi', updated_at: edited.updated_at })
}

/** The Plant name: a text box to whoever may edit the row; its value, read only, to a reader (#795).
 *  Read raw where either may be on screen: the DSL's field verbs need a form control. */
const plantName = () => within(screen.getByTestId('form-view')).getByLabelText('Plant name', { exact: true })

async function openRow(as: Client) {
  cleanup()
  await renderApp(rowHref('Plant', '9154'), as)
  await screen.findByTestId('form-view')
  await waitFor(() => {
    const name = plantName()
    if (name instanceof HTMLInputElement || name instanceof HTMLTextAreaElement) expect(name).toHaveValue('Tenkasi')
    else expect(name).toHaveTextContent('Tenkasi')
  })
}

async function openList(as: Client) {
  cleanup()
  await renderApp(tableHref('Plant'), as)
  await screen.findByRole('checkbox', { name: 'Select Tenkasi' })
}

const area = (name: string) => userEvent.click(screen.getByRole('tab', { name }))

async function tagPlant(as: Client) {
  await openRow(as)
  await area('Collaboration')
  await userEvent.type(await screen.findByTestId('tag-input'), 'priority')
  await onScreen().clickButton('Add')
  await onScreen().within(byTestId('tag-chip'), (el) => el.assertText('priority'))
  expect(screen.getByRole('button', { name: 'Remove priority' })).toBeVisible()
}

describe('record-workspace', () => {
  scenario('Unfinished work survives consulting activity', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user can edit the Plant row for Tenkasi', () => plant(admin))
    await step('the user changes its name and consults its activity before returning to work', async () => {
      await openRow(admin)
      await onScreen().within(byTestId('form-view'), (form) => form.fillIn('Plant name', 'Tenkasi distribution'))
      await onScreen().clickButton('Activity')
      await screen.findByTestId('activity-timeline')
      await onScreen().clickButton('Form')
    })
    await step('the unfinished name is still present and can be saved', async () => {
      await onScreen().within(byTestId('form-view'), (form) => form.assertValue('Plant name', 'Tenkasi distribution'))
      await user.click(screen.getByTestId('form-save'))
      await onScreen().within(byTestId('form-banner'), (el) => el.assertText('Saved'))
      expect((await admin.get<{ plant_name: string }>('/api/table/Plant/9154')).plant_name).toBe('Tenkasi distribution')
    })
    await step("the row's print and related navigation remain reachable", async () => {
      const actions = screen.getByRole('button', { name: 'Record actions' })
      actions.focus()
      await onScreen().pressKey('Enter')
      expect(await screen.findByTestId('form-print')).toBeVisible()
      await onScreen().pressKey('Escape')
      expect(actions).toHaveFocus()
      expect(screen.queryByTestId('form-print')).not.toBeInTheDocument()
      // #910: related navigation is the row's Map and Tree tabs.
      await onScreen().clickButton('Map')
      expect(await screen.findByTestId('relation-map')).toBeVisible()
      await onScreen().clickButton('Tree')
      expect(await screen.findByRole('tree')).toBeVisible()
    })
  })

  scenario('Selection reveals operations on rows, not the Table', async ({ admin }, step) => {
    await step('the user manages the Plant Table containing Tenkasi', () => plant(admin))
    await step('the user selects Tenkasi in its list', async () => {
      await openList(admin)
      expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument()
      await onScreen().check('Select Tenkasi')
    })
    await step('the selection offers deletion of rows separately from deletion of the Table', async () => {
      await onScreen().within(byTestId('bulk-delete'), (el) => el.assertText('Delete rows'))
      expect(screen.queryByTestId('delete-table')).not.toBeInTheDocument()
      await onScreen().clickButton('Table administration')
      await onScreen().within(byTestId('delete-table'), (el) => el.assertText('Delete Table'))
      await onScreen().pressKey('Escape')
    })
    await step('clearing the selection removes the row operations without changing Tenkasi', async () => {
      await onScreen().clickButton('Clear selection')
      await waitFor(() => expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument())
      await onScreen().refuteChecked('Select Tenkasi')
      expect((await admin.get<{ plant_name: string }>('/api/table/Plant/9154')).plant_name).toBe('Tenkasi')
    })
  })

  scenario('Ordinary readers do not get Table administration', async ({ admin, createUser }, step) => {
    let reader!: Client
    await step('the user can only read the Plant row for Tenkasi', async () => {
      await plant(admin)
      reader = await plantReader(admin, createUser)
    })
    await step('the user consults its list views and related navigation', async () => {
      await openList(reader)
      await onScreen().clickButton('View: List')
      expect(await screen.findByTestId('open-report')).toBeVisible()
      await onScreen().pressKey('Escape')
      expect(screen.getByTestId('open-explore')).toBeVisible()
    })
    await step('the list does not offer Table administration', () => {
      expect(screen.queryByRole('button', { name: 'Table administration' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
    })
    await step('Tenkasi remains readable', () => openRow(reader))
  })

  scenario('A reader sees only available enabled collaboration', async ({ admin, createUser }, step) => {
    let reader!: Client
    await step('the user reads Tenkasi with collaboration enabled but no collaboration grants', async () => {
      await plant(admin)
      for (const property of ['enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion'])
        await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Plant', property, value: 'true' } })
      reader = await plantReader(admin, createUser)
    })
    await step("the user consults Tenkasi's available operations", () => openRow(reader))
    await step('Tenkasi is read-only without save, rename or delete operations', async () => {
      // A reader's row shows its values read only (#795): nothing to type into.
      expect(plantName()).toHaveTextContent('Tenkasi')
      expect(screen.queryByRole('textbox', { name: 'Plant name' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('form-save')).not.toBeInTheDocument()
      await onScreen().clickButton('Record actions')
      for (const id of ['form-rename', 'form-delete']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      await onScreen().pressKey('Escape')
    })
    await step('assigning, uploading and composing discussion are absent', async () => {
      await onScreen().clickButton('Collaboration')
      await screen.findByTestId('tags-panel')
      for (const id of ['assign-to', 'attach-file', 'attachment-delete']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      await onScreen().clickButton('Activity')
      await screen.findByTestId('activity-timeline')
      expect(screen.queryByTestId('comment-input')).not.toBeInTheDocument()
    })
    await step('the reader can still label Tenkasi with a tag', () => tagPlant(reader))
    await step('selecting Tenkasi offers no unavailable bulk mutations', async () => {
      await openList(reader)
      await onScreen().check('Select Tenkasi')
      await screen.findByRole('button', { name: 'Clear selection' })
      for (const id of ['bulk-delete', 'bulk-edit-field']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      await onScreen().clickButton('Clear selection')
    })
  })

  scenario('Existing collaboration remains readable when disabled', async ({ admin }, step) => {
    await step('Tenkasi has an assignment, a tag, a file and a discussion', () => collaborate(admin))
    await step('the user opens Tenkasi with collaboration disabled', () => openRow(admin))
    await step('the existing collaboration is readable without collaboration mutation controls', async () => {
      await onScreen().clickButton('Collaboration')
      const me = await admin.get<{ full_name: string }>(`/api/table/Person/${encodeURIComponent(admin.user!)}`)
      await onScreen().within(byTestId('assignments-panel'), (el) => el.assertText(me.full_name))
      await onScreen().within(byTestId('tags-panel'), (el) => el.assertText('priority'))
      await onScreen().within(byTestId('attachments-panel'), (el) => el.assertText('plant-note.txt'))
      for (const id of ['assign-submit', 'tag-add', 'attach-file', 'attachment-delete'])
        expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      await onScreen().clickButton('Activity')
      await onScreen().within(byTestId('activity-timeline'), (el) => el.assertText('Supplier called'))
      expect(screen.queryByTestId('comment-input')).not.toBeInTheDocument()
    })
    await step('the user can still consult its audit history', async () => {
      await onScreen().clickButton('Activity')
      await onScreen().within(byTestId('activity-timeline'), (el) => el.assertText('Tenkasi before review'))
    })
  })

  scenario('Only explicitly enabled collaboration can be added', async ({ admin }, step) => {
    await step('the Plant Table explicitly enables tags alone', async () => {
      await plant(admin)
      await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: 'Plant', property: 'enable_tags', value: 'true' } })
    })
    await step('the user labels Tenkasi with a tag', () => tagPlant(admin))
    await step('the tag is saved and the other empty collaboration features stay absent', async () => {
      expect(await admin.get('/api/tags/Plant/9154')).toEqual({ tags: ['priority'] })
      for (const id of ['assignments-panel', 'attachments-panel']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      await onScreen().clickButton('Activity')
      await screen.findByTestId('activity-timeline')
      expect(screen.queryByTestId('comment-input')).not.toBeInTheDocument()
    })
  })

  scenario('Discussion is not duplicated across areas', async ({ admin }, step) => {
    await step('Tenkasi has a discussion and a recorded edit', () => collaborate(admin))
    await step('the user consults its activity', async () => {
      await openRow(admin)
      await area('Activity')
    })
    await step('the discussion and edit appear together once', async () => {
      await waitFor(() => expect(screen.getAllByTestId('activity-comment')).toHaveLength(1))
      expect(screen.getAllByTestId('activity-version')[0]).toBeVisible()
      expect(screen.getAllByTestId('comment-content')).toHaveLength(1)
      expect(screen.queryByTestId('comment-list')).not.toBeInTheDocument()
    })
  })
})
