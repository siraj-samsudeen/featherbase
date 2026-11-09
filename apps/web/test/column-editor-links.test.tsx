// A Table's Columns screen (#911, #881, #1021) and its links: backing out of
// turning a column into one, pointing one at a view of its Table, a link to
// any Table whose Table column would collide, and the screen when the Table's
// details stop coming back.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { ANY_TABLE_LINK } from '../src/pages/ColumnEditor'

type Admin = Parameters<typeof renderApp>[1]
const FLOOR = 'Cel Floor'
const ZONE = 'Cel Zone'
const T = { timeout: 10_000 }

async function seed(admin: Admin, floor: { column_type: string; reference_table?: string } = { column_type: 'Data' }) {
  await admin.post('/api/table_def', { name: FLOOR, id_pattern: 'prompt', columns: [
    { column_name: 'floor_name', label: 'Floor name', column_type: 'Data' },
    { column_name: 'upper', label: 'Upper', column_type: 'Check' },
  ] })
  await admin.post('/api/table_def', { name: ZONE, columns: [
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data' },
    { column_name: 'floor', label: 'Floor', ...floor },
  ] })
}

const zoneColumn = async (admin: Admin, name: string) =>
  (await admin.get<{ columns: { column_name: string; column_type: string; reference_table?: string | null }[] }>(
    `/api/table/${encodeURIComponent(ZONE)}:meta`)).columns.find((c) => c.column_name === name)

async function openEditor(admin: Admin) {
  await renderApp(`/featherbase/admin/table/${tableSlug(ZONE)}/columns`, admin)
  return screen.findByTestId('column-editor', {}, T)
}

test('Cancel on turning a column into a link leaves it text', async ({ admin }) => {
  await seed(admin)
  await openEditor(admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Turn floor into a link' }, T))
  await userEvent.click(within(screen.getByTestId('ce-row-floor')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('combobox', { name: 'Table floor links to' })).not.toBeInTheDocument()
  expect(await zoneColumn(admin, 'floor')).toMatchObject({ column_type: 'Data' })
})

test('a link to a Table that has a view can be pointed at the view instead', async ({ admin }) => {
  await seed(admin, { column_type: 'Reference', reference_table: FLOOR })
  await admin.post('/api/table_def', { name: 'Cel Upper Floor', kind: 'view', view_of: FLOOR, view_filters: [['upper', '=', 1]] })
  await openEditor(admin)
  const target = await screen.findByTestId('ce-link-target-floor', {}, T)
  await within(target).findByRole('option', { name: /Cel Upper Floor/ }, T)
  await userEvent.selectOptions(target, 'Cel Upper Floor')
  await waitFor(async () => expect(await zoneColumn(admin, 'floor')).toMatchObject({ reference_table: 'Cel Upper Floor' }), T)
})

test('a link to any Table is refused a name whose Table column already exists', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.put(`/api/table_def/${encodeURIComponent(ZONE)}`, { columns: [
    { column_name: 'zone_name', label: 'Zone name', column_type: 'Data' },
    { column_name: 'floor', label: 'Floor', column_type: 'Data' },
    { column_name: 'shapes_table', label: 'Shapes Table', column_type: 'Data' },
  ] })
  await openEditor(admin)
  await user.type(await screen.findByTestId('ce-add-label', {}, T), 'Shapes')
  await user.selectOptions(screen.getByTestId('ce-add-type'), ANY_TABLE_LINK)
  await user.type(screen.getByTestId('ce-add-allowed'), FLOOR)
  expect(screen.getByTestId('ce-add-allowed')).toHaveValue(FLOOR)
  await waitFor(() => expect(screen.getByTestId('ce-add-problem')).toHaveTextContent(`${ZONE} already has shapes_table`))
  expect(screen.getByTestId('ce-add-go')).toBeDisabled()
})

test("the Columns screen says so when the Table's details stop coming back after a change", async ({ admin }) => {
  await seed(admin)
  await openEditor(admin)
  const inList = await screen.findByTestId('ce-in-list-floor', {}, T)
  // The network drops just as the screen asks for the Table's details again.
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.includes(':meta')) throw new TypeError('Failed to fetch')
    return real(input, init)
  })
  await userEvent.click(inList)
  expect(await screen.findByTestId('ce-error', {}, T)).toHaveTextContent('Could not load this Table')
})
