// What a list row leads with when the Table's title column is not plain text:
// a link to another Table's row, a link to a row of any Table, a Choice, and
// a person with no name.
// Real ListView against the in-process server.
import { screen, waitFor, within } from '@testing-library/react'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { columnsToAdd, ANY_TABLE_LINK } from '../src/pages/ColumnEditor'

type Admin = Parameters<typeof renderApp>[1]

async function openList(admin: Admin, name: string) {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(name))}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
}

/** The link that leads the row with this id. */
const leader = (rowId: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('tbody a')].find((a) => a.getAttribute('href')?.endsWith(`/row/${rowId}`))

async function regions(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Ltc Region', id_pattern: 'prompt', title_column: 'region_name', columns: [{ column_name: 'region_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Ltc Region', row: { row_id: 'N1', region_name: 'North Zone' } })
}

test("a row titled by a link to another Table's row leads with that row's title", async ({ admin }) => {
  await regions(admin)
  await admin.post('/api/table_def', {
    name: 'Ltc Store',
    id_pattern: 'prompt',
    title_column: 'region',
    columns: [{ column_name: 'region', column_type: 'Reference', reference_table: 'Ltc Region' }],
  })
  await admin.post('/api/save_row', { table: 'Ltc Store', row: { row_id: 'S1', region: 'N1' } })
  await openList(admin, 'Ltc Store')
  await waitFor(() => expect(leader('S1')).toHaveTextContent('North Zone'))
})

test('a row titled by a Choice leads with the choice', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Ltc Ticket',
    id_pattern: 'prompt',
    title_column: 'stage',
    columns: [{ column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' }],
  })
  await admin.post('/api/save_row', { table: 'Ltc Ticket', row: { row_id: 'T1', stage: 'Closed' } })
  await openList(admin, 'Ltc Ticket')
  await waitFor(() => expect(leader('T1')).toHaveTextContent(/^Closed$/))
})

async function decisions(admin: Admin) {
  await regions(admin)
  await admin.post('/api/table_def', {
    name: 'Ltc Decision',
    id_pattern: 'prompt',
    title_column: 'shapes',
    columns: columnsToAdd({ label: 'Shapes', column_name: 'shapes', column_type: ANY_TABLE_LINK, target: 'Ltc Region', nameTouched: false }),
  })
}

test('a row titled by a link to a row of any Table leads with that row\'s title', async ({ admin }) => {
  await decisions(admin)
  await admin.post('/api/save_row', { table: 'Ltc Decision', row: { row_id: 'D1', shapes_table: 'Ltc Region', shapes: 'N1' } })
  await openList(admin, 'Ltc Decision')
  await waitFor(() => expect(leader('D1')).toHaveTextContent('North Zone'))
})

test('a row whose any-Table title is not set leads with its id', async ({ admin }) => {
  await decisions(admin)
  await admin.post('/api/save_row', { table: 'Ltc Decision', row: { row_id: 'D2' } })
  await openList(admin, 'Ltc Decision')
  await waitFor(() => expect(leader('D2')).toHaveTextContent(/^D2$/))
  expect(within(leader('D2')!).queryByRole('link')).not.toBeInTheDocument()
})

test('a person with no name leads the people list as an unnamed person, never by their id', async ({ admin }) => {
  await sql`insert into person ${sql({ row_id: 'psn_ltcnonamepersonltcno', created_by: 'Administrator', updated_by: 'Administrator', email: 'ltc-noname@example.com', full_name: '', enabled: true })}`
  await openList(admin, 'Person')
  await waitFor(() => expect(leader('psn_ltcnonamepersonltcno')).toHaveTextContent(/^Unnamed person$/))
})
