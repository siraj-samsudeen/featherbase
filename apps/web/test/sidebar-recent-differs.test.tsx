// #1253 (one-app-chrome, 17-Nov): two Recently Opened rows of one name say
// what sets them apart; the person's role sits under their name at the foot.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { actionForLocation, recordAction } from '../src/lib/recents'
import { roleLine } from '../src/components/TopBar'

const DT = 'Differs DT'
const LIST = `/featherbase/admin/table/${tableSlug(DT)}`
const COLUMNS = [{ column_name: 'site', label: 'Site', column_type: 'Data' as const }]

test('of two rows of one list, the filtered one reads as its filter; the unfiltered one stays its name', async ({ admin }) => {
  await admin.post('/api/table_def', { name: DT, columns: [{ ...COLUMNS[0], in_list_view: true }] })
  const now = Date.now()
  recordAction('Administrator', actionForLocation(LIST, {}, DT)!, now - 60_000)
  recordAction('Administrator', actionForLocation(LIST, { filters: '[["site","=","Head Office"]]' }, DT, undefined, COLUMNS)!, now)
  await renderApp('/featherbase/admin/all-tables', admin)
  const recents = await screen.findByTestId('sidebar-recents')
  const rows = await waitFor(() => {
    const found = within(recents).getAllByTestId('sidebar-recent').map((r) => (r.textContent ?? '').replace(/\s+/g, ' '))
    expect(found.length).toBe(2)
    return found
  })
  // The tile names the Table; the filtered row reads as its filter, the plain one as its name.
  expect(rows[0]).toContain('Site = Head Office')
  expect(rows[0]).not.toContain(DT)
  expect(within(recents).getAllByTestId('sidebar-recent')[0]).toHaveAttribute('title', expect.stringContaining(`${DT} · Site = Head Office · opened`))
  expect(rows[1]).toContain(DT)
  expect(rows[1]).not.toContain('Site')
})

test('the same list remembered with no filters and with an empty filter list is one row', async ({ admin }) => {
  await admin.post('/api/table_def', { name: DT, columns: [{ ...COLUMNS[0], in_list_view: true }] })
  const now = Date.now()
  recordAction('Administrator', actionForLocation(LIST, {}, DT)!, now - 60_000)
  recordAction('Administrator', actionForLocation(LIST, { filters: '[]' }, DT)!, now)
  await renderApp('/featherbase/admin/all-tables', admin)
  const recents = await screen.findByTestId('sidebar-recents')
  await waitFor(() => expect(within(recents).getAllByTestId('sidebar-recent')).toHaveLength(1))
  expect(within(recents).queryByTestId('recent-differs')).toBeNull()
})

test("the foot says who the person is here, under their name", async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  expect(await screen.findByTestId('session-user-role')).toHaveTextContent('System Manager')
})

test('roleLine: System Manager for a manager; else the first role and how many more, never the roles everyone holds', () => {
  expect(roleLine({ roles: ['All'], capabilities: { manage: true } })).toBe('System Manager')
  expect(roleLine({ roles: ['All', 'Store Manager'], capabilities: { manage: false } })).toBe('Store Manager')
  expect(roleLine({ roles: ['All', 'Store Manager', 'Ticket Agent', 'Guest'], capabilities: { manage: false } })).toBe('Store Manager · +1 more')
  expect(roleLine({ roles: ['All'], capabilities: { manage: false } })).toBe('')
})

test("in the rail, the Recently Opened menu says a shared name's filters after it", async ({ admin }) => {
  await admin.post('/api/table_def', { name: DT, columns: [{ ...COLUMNS[0], in_list_view: true }] })
  const now = Date.now()
  recordAction('Administrator', actionForLocation(LIST, {}, DT)!, now - 60_000)
  recordAction('Administrator', actionForLocation(LIST, { filters: '[["site","=","Head Office"]]' }, DT, undefined, COLUMNS)!, now)
  await renderApp('/featherbase/admin/all-tables', admin)
  fireEvent.click(await screen.findByTestId('sidebar-collapse'))
  fireEvent.click(await screen.findByRole('button', { name: 'Recently Opened' }))
  const menu = await screen.findByRole('menu', { name: 'Recently Opened' })
  await waitFor(() => expect(within(menu).getByTestId('recent-differs')).toHaveTextContent('· Site = Head Office'))
})
