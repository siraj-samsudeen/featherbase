// #1345: Search or Command tells people who share a name apart. Each person reads
// their code, role and place under the name (the shared PersonLabel); a staff row
// folds into its Person, so one human is listed once; results are links. Real
// Admin in jsdom against the in-process server. Made-up people.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { rowHref } from 'shared'
import { sql } from 'server/src/db'
import { makePerson } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const T = { timeout: 8000 }
const here = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

let identifier = 0
async function code(person: string, value: string) {
  await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled)
    values ('pls-staff-code', 'Made-up staff code', 'employee-record', 'Normal', 'Off', true) on conflict (row_id) do nothing`
  await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by, valid)
    values (${`pid_pls${String(++identifier).padStart(17, 'a')}`}, ${person}, 'pls-staff-code', ${value}, true, 'test', 'test', daterange('2026-01-01', null))`
}

/** Three made-up people who share a name, each on a made-up staff list under their own code. */
async function threeNilas(admin: Client) {
  await admin.post('/api/table_def', {
    name: 'Pls Staff', id_pattern: 'field:staff_code', title_column: 'full_name', person_column: 'person', search_columns: ['staff_code'],
    columns: [{ column_name: 'staff_code', column_type: 'Data' }, { column_name: 'full_name', column_type: 'Data' },
      { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }],
  })
  const ids: string[] = []
  for (const [i, value] of ['PLS-501', 'PLS-502', 'PLS-503'].entries()) {
    const person = await makePerson({ full_name: 'Nila Sundaram', email: `nila.${i + 1}@example.test` })
    await code(person, value)
    await admin.post('/api/save_row', { table: 'Pls Staff', row: { staff_code: value, full_name: 'Nila Sundaram', person } })
    ids.push(person)
  }
  return ids
}

async function searchFor(admin: Client, words: string) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, T)
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: words } })
  return app
}

const people = async (count: number) => {
  await waitFor(() => expect(screen.getAllByTestId('person-label')).toHaveLength(count), T)
  return screen.getAllByTestId('awesomebar-doc').filter((row) => within(row).queryByTestId('person-label'))
}

test('three people who share a name read their own code under it, once each, and their staff rows are folded in', async ({ admin }) => {
  const ids = await threeNilas(admin)
  await searchFor(admin, 'Nila Sundaram')
  const rows = await people(3)
  expect(rows.map((r) => within(r).getByTestId('person-meta').textContent).sort()).toEqual(['PLS-501', 'PLS-502', 'PLS-503'])
  // Each is a link to its Person; no staff row is listed beside them.
  expect(rows.map((r) => r.getAttribute('href')).sort()).toEqual(ids.map((id) => rowHref('Person', id)).sort())
  expect(screen.getAllByTestId('awesomebar-doc-table').map((t) => t.textContent)).not.toContain('Pls Staff')
})

test('a result opens in place on a click, and a middle-click leaves the search open for a new tab', async ({ admin }) => {
  const ids = await threeNilas(admin)
  const app = await searchFor(admin, 'pls-502')
  const [row] = await people(1)
  fireEvent.click(row!, { button: 1 })
  expect(screen.getByTestId('awesomebar-results')).toBeInTheDocument()
  fireEvent.click(row!)
  await waitFor(() => expect(here(app)).toBe(rowHref('Person', ids[1]!)), T)
})

test('two people who would read exactly the same add their email', async ({ admin }) => {
  await makePerson({ full_name: 'Ravi Ganesan', email: 'ravi.one@example.test' })
  await makePerson({ full_name: 'Ravi Ganesan', email: 'ravi.two@example.test' })
  await searchFor(admin, 'Ravi Ganesan')
  const rows = await people(2)
  expect(rows.map((r) => within(r).getByTestId('person-meta').textContent).sort()).toEqual(['ravi.one@example.test', 'ravi.two@example.test'])
})
