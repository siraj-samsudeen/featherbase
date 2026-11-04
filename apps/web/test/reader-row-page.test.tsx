// #861 item 2: a person whose role may only read a Table opens one of its rows.
// The page must not ask for Tables their role cannot read (ToDo, File, Client
// Script), so they see no "could not be read" errors and no 403s.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]

const DT = 'Rrp Shelf Note'
const ROLE = 'Rrp Shelf Reader'

afterEach(() => vi.restoreAllMocks())

/** Every URL the page asks the server for, from now on. */
function recordCalls(): string[] {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(decodeURIComponent(typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url))
    return real(input, init)
  })
  return urls
}

async function seed(admin: Admin): Promise<string> {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  await grantRole(admin, { table: DT, role: ROLE, can_read: true })
  const row = (await admin.post('/api/save_row', { table: DT, row: { title: 'Blue box' } })) as { row_id: string }
  return row.row_id
}

async function openCollaboration(as: Admin, rowId: string) {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${rowId}`, as)
  await screen.findByTestId('form-view')
  await userEvent.click(await screen.findByRole('tab', { name: 'Collaboration' }))
}

test('a reader who may read only this Table sees no errors for assignments and attachments, and the page never asks for them', async ({ admin, createUser }) => {
  const rowId = await seed(admin)
  const reader = await createUser({ email: 'rrp.reader@example.com', roles: [ROLE] })
  const urls = recordCalls()
  await openCollaboration(reader, rowId)
  expect(await screen.findByTestId('tags-panel')).toBeInTheDocument()
  expect(screen.queryByText('Assignments could not be read.')).not.toBeInTheDocument()
  expect(screen.queryByText('Attachments could not be read.')).not.toBeInTheDocument()
  expect(screen.queryByTestId('assignments-panel')).not.toBeInTheDocument()
  expect(screen.queryByTestId('attachments-panel')).not.toBeInTheDocument()
  for (const refused of ['/api/table/ToDo', '/api/table/File', '/api/table/Client Script'])
    expect(urls.filter((u) => u.startsWith(refused))).toEqual([])
})

test('a reader whose role may also read assignments sees who the row is assigned to', async ({ admin, createUser }) => {
  const rowId = await seed(admin)
  await grantRole(admin, { table: 'ToDo', role: ROLE, can_read: true })
  await admin.post('/api/assign', { table: DT, row_id: rowId, assign_to: 'Administrator' })
  const reader = await createUser({ email: 'rrp.todo@example.com', roles: [ROLE] })
  await openCollaboration(reader, rowId)
  const panel = await screen.findByTestId('assignments-panel')
  await waitFor(() => expect(within(panel).getAllByTestId('assignee')).toHaveLength(1))
  expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
})
