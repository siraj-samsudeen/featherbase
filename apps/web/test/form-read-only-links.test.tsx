// A row someone can only read (#795) shows a link as the linked row's name;
// clicking it shows that row in the drill pane (#910), and a Ctrl-click is the
// browser's. And an arrangement the server could not save stays for the visit.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Frl Rack', id_pattern: 'prompt', title_column: 'rack_name',
    columns: [{ column_name: 'rack_name', column_type: 'Data', label: 'Rack name' }] })
  await admin.post('/api/table_def', { name: 'Frl Parcel', id_pattern: 'prompt', title_column: 'label', columns: [
    { column_name: 'label', column_type: 'Data', label: 'Label' },
    { column_name: 'rack', column_type: 'Reference', reference_table: 'Frl Rack', label: 'Rack' },
  ] })
  await admin.post('/api/save_row', { table: 'Frl Rack', row: { row_id: 'R-3', rack_name: 'Top' } })
  await admin.post('/api/save_row', { table: 'Frl Parcel', row: { row_id: 'P-1', label: 'Blue box', rack: 'R-3' } })
}

async function openAsReader(admin: Admin, createUser: Parameters<typeof createUserWithRole>[1]) {
  await seed(admin)
  const reader = await createUserWithRole(admin, createUser, { role: 'Frl Reader', table: ['Frl Rack', 'Frl Parcel'], can_read: true })
  await renderApp(`${tableHref('Frl Parcel')}/row/P-1`, reader)
  const rack = await screen.findByLabelText('Rack', {}, T)
  return within(rack).findByRole('link', { name: /Top/ }, T)
}

test("clicking a read-only row's link shows the linked row in the drill pane", async ({ admin, createUser }) => {
  fireEvent.click(await openAsReader(admin, createUser))
  expect(await screen.findByRole('complementary', { name: /^Top/ }, T)).toHaveTextContent('Frl Rack')
})

test("Ctrl-click on a read-only row's link is left to the browser, a new tab", async ({ admin, createUser }) => {
  const link = await openAsReader(admin, createUser)
  // fireEvent answers true when no handler took the click (preventDefault).
  expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
  expect(screen.queryByRole('complementary', { name: /^Top/ })).not.toBeInTheDocument()
})

test('an arrangement the server could not save stays for this visit', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Frl Parcel')}/row/P-1`, admin)
  await screen.findByTestId('arrange-importance', {}, T)
  // The network drops as the choice is saved.
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.startsWith('/api/user_settings/') && init?.method === 'PUT') throw new TypeError('Failed to fetch')
    return real(input, init)
  })
  await userEvent.click(screen.getByTestId('arrange-source'))
  await waitFor(() => expect(screen.getByTestId('arrange-source')).toHaveAttribute('aria-pressed', 'true'))
  const { settings } = await admin.get<{ settings: { form?: unknown } | null }>('/api/user_settings/Frl%20Parcel')
  expect(settings?.form).toBeUndefined()
})
