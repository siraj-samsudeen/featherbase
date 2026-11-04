// #858: row ids from a fixed prefix plus one column, e.g. PLANT-8151. The
// Naming page sets the rule and shows a sample id; a row whose column no longer
// matches its id offers Rename to the id the rule would give it now.
import { rowHref, tableSlug } from 'shared'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = 'Pri Plant'
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seed(admin: Admin, id_pattern?: string) {
  await admin.post('/api/table_def', {
    name: T,
    ...(id_pattern ? { id_pattern } : {}),
    columns: [
      { column_name: 'plant_code', column_type: 'Data', label: 'Plant code' },
      { column_name: 'title', column_type: 'Data', label: 'Title' },
    ],
  })
}

test('naming rows PLANT- plus their plant code shows a sample id and stores the rule', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/naming`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'field:plant_code')
  await user.type(screen.getByTestId('naming-naming-prefix'), 'PLANT-')
  expect(screen.getByTestId('naming-naming-preview')).toHaveTextContent('Ids look like PLANT-‹Plant code›')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  expect(screen.getByTestId('naming-naming-prefix')).toHaveValue('PLANT-')

  expect(((await admin.get(`/api/table/${encodeURIComponent(T)}:meta`)) as { id_pattern: string }).id_pattern).toBe('PLANT-{plant_code}')
  expect(((await admin.post('/api/save_row', { table: T, row: { plant_code: '8151' } })) as { row_id: string }).row_id).toBe('PLANT-8151')
})

test('clearing the prefix goes back to the column alone', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin, 'PLANT-{plant_code}')
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/naming`, admin)
  await user.clear(await screen.findByTestId('naming-naming-prefix', {}, { timeout: 8000 }))
  expect(screen.getByTestId('naming-naming-preview')).toHaveTextContent('Each row takes its id from Plant code')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  expect(((await admin.get(`/api/table/${encodeURIComponent(T)}:meta`)) as { id_pattern: string }).id_pattern).toBe('field:plant_code')
})

test('changing the plant code keeps the id and offers Rename to the new one', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin, 'PLANT-{plant_code}')
  await admin.post('/api/save_row', { table: T, row: { plant_code: '8151', title: 'Chennai' } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/row/PLANT-8151`, admin)
  await waitFor(() => expect(field('plant_code')).toHaveValue('8151'), { timeout: 8000 })
  expect(screen.queryByTestId('form-id-out-of-step')).not.toBeInTheDocument()

  await user.clear(field('plant_code'))
  await user.type(field('plant_code'), '8159')
  const note = screen.getByTestId('form-id-out-of-step')
  expect(note).toHaveTextContent('This row keeps the id PLANT-8151.')
  await user.click(screen.getByTestId('form-id-rename'))
  expect(screen.getByTestId('rename-input')).toHaveValue('PLANT-8159')
  expect(screen.getByRole('button', { name: 'Record actions' })).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByTestId('rename-input'))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Record actions' })).toHaveFocus()
  expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument()

  cleanup()
  await renderApp(`/featherbase/admin/table/${tableSlug(T)}/new`, admin)
  await user.type(await screen.findByRole('textbox', { name: 'Plant code' }), '8159')
  expect(screen.queryByTestId('form-id-rename')).not.toBeInTheDocument()
  expect(screen.queryByTestId('form-rename')).not.toBeInTheDocument()
})

test('missing or denied rename advice exposes neither rename action, even on a writable shared row with ID drift', async ({ admin, createUser }) => {
  await seed(admin, 'PLANT-{plant_code}')
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
    table: T, row: { plant_code: '8151', title: 'Chennai' },
  })
  await admin.post('/api/save_row', { table: T, row: { ...row, plant_code: '8159' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pri Reader' } })
  await admin.post('/api/save_row', {
    table: 'Permission', row: { ref_table: T, role: 'Pri Reader', can_read: true },
  })
  const reader = await createUser({ email: 'pri.reader@example.com', roles: ['Pri Reader'] })
  await admin.post('/api/save_row', {
    table: 'Share', row: { share_table: T, share_name: row.row_id, person: reader.user, read: true, write: true },
  })
  expect(await reader.get(`/api/table/${encodeURIComponent(T)}/${row.row_id}:capabilities`))
    .toMatchObject({ write: true, rename: false })

  // Delay delivery, not the server answer: the same real request eventually
  // resolves with write=true and rename=false. Neither state may flash Rename.
  let release!: () => void
  const delivery = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  const real = globalThis.fetch
  const delayed = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith(':capabilities')) {
      requested = true
      await delivery
    }
    return real(input, init)
  })
  try {
    await renderApp(rowHref(T, row.row_id), reader)
    await waitFor(() => expect(requested).toBe(true))
    expect(screen.queryByTestId('form-rename')).not.toBeInTheDocument()
    expect(screen.queryByTestId('form-id-rename')).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(field('plant_code')).toBeEnabled())
    expect(field('plant_code')).toHaveValue('8159')
    await userEvent.click(screen.getByRole('button', { name: 'Record actions' }))
    expect(screen.queryByTestId('form-rename')).not.toBeInTheDocument()
    expect(screen.queryByTestId('form-id-rename')).not.toBeInTheDocument()
    expect(screen.queryByTestId('form-id-out-of-step')).not.toBeInTheDocument()
  } finally {
    release()
    delayed.mockRestore()
  }
})
