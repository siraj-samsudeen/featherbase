// #911: on a Table's Columns screen, a text column whose values are codes of
// another Table's rows turns into a link to it, and a link turns back into text.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const FLOOR = 'Ctl Floor'
const ZONE = 'Ctl Zone'

async function seed(admin: Admin, codes: string[]) {
  await admin.post('/api/table_def', { name: FLOOR, id_pattern: 'prompt', columns: [{ column_name: 'floor_name', label: 'Floor name', column_type: 'Data' }] })
  for (const id of ['G', 'M']) await admin.post('/api/save_row', { table: FLOOR, row: { row_id: id, floor_name: id === 'G' ? 'Ground' : 'Mezzanine' } })
  await admin.post('/api/table_def', { name: ZONE, columns: [
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data' },
    { column_name: 'floor', label: 'Floor', column_type: 'Data' },
    { column_name: 'pop', label: 'Pop', column_type: 'Int' },
  ] })
  for (const [i, floor] of codes.entries()) await admin.post('/api/save_row', { table: ZONE, row: { zone_name: `Zone ${i}`, floor } })
}

const floorColumn = async (admin: Admin) =>
  (await admin.get<{ columns: { column_name: string; column_type: string; reference_table?: string | null }[] }>(
    `/api/table/${encodeURIComponent(ZONE)}:meta`)).columns.find(c => c.column_name === 'floor')

async function openEditor(admin: Admin) {
  await renderApp(`/featherbase/admin/table/${tableSlug(ZONE)}/columns`, admin)
  await screen.findByTestId('column-editor')
}

async function linkFloorTo(table: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Turn floor into a link' }))
  const picker = await screen.findByRole('combobox', { name: 'Table floor links to' })
  await within(picker).findByRole('option', { name: table })
  await userEvent.selectOptions(picker, table)
  await userEvent.click(screen.getByTestId('ce-link-go-floor'))
}

test('a text column of codes turns into a link to the Table they name', async ({ admin }) => {
  await seed(admin, ['G', 'M', 'G'])
  await openEditor(admin)
  await linkFloorTo(FLOOR)
  await waitFor(() => expect(within(screen.getByTestId('ce-row-floor')).getByText('Reference')).toBeInTheDocument())
  expect(await screen.findByTestId('ce-saved')).toHaveTextContent('floor now links to Ctl Floor')
  expect(await floorColumn(admin)).toMatchObject({ column_type: 'Reference', reference_table: FLOOR })
})

test('a code with no row is named, and the column stays text', async ({ admin }) => {
  await seed(admin, ['G', 'X9'])
  await openEditor(admin)
  await linkFloorTo(FLOOR)
  expect(await screen.findByTestId('ce-link-error-floor')).toHaveTextContent('X9 names no Ctl Floor row')
  expect(within(screen.getByTestId('ce-row-floor')).getByText('Data')).toBeInTheDocument()
  expect(await floorColumn(admin)).toMatchObject({ column_type: 'Data' })
})

test('a link turns back into text', async ({ admin }) => {
  await seed(admin, ['G'])
  await admin.put(`/api/table_def/${encodeURIComponent(ZONE)}`, { columns: [
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data' },
    { column_name: 'floor', label: 'Floor', column_type: 'Reference', reference_table: FLOOR },
    { column_name: 'pop', label: 'Pop', column_type: 'Int' },
  ] })
  await openEditor(admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Turn floor into text' }))
  await waitFor(() => expect(within(screen.getByTestId('ce-row-floor')).getByText('Data')).toBeInTheDocument())
  expect(await floorColumn(admin)).toMatchObject({ column_type: 'Data', reference_table: null })
})

test('only a text or link column offers the change', async ({ admin }) => {
  await seed(admin, ['G'])
  await openEditor(admin)
  expect(within(screen.getByTestId('ce-row-pop')).queryByRole('button', { name: /into a link/ })).not.toBeInTheDocument()
  expect(within(screen.getByTestId('ce-row-zone_name')).getByRole('button', { name: 'Turn zone_name into a link' })).toBeInTheDocument()
})
