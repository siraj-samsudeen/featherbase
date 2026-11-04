// #910 checklist 22: a link to a row the viewer can't read shows neutral
// words wherever a link value renders — a list cell, a read-only field, an
// editable link field — never the row's id, and offers no way to it.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const rowHref = (table: string, row: string) => `${tableHref(table)}/row/${encodeURIComponent(row)}`

test("a list's link cell to an unreadable row is neutral text, not a link", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Viewer', table: SITE, can_read: true })
  await renderApp(tableHref(SITE), viewer)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  const cell = within(line).getByTestId('cell-region')
  await waitFor(() => expect(cell).toHaveTextContent('A row you cannot see'))
  expect(within(cell).queryByRole('link')).not.toBeInTheDocument()
})

test('clicking an unreadable link cell opens nothing and leaves the address alone', async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Viewer', table: SITE, can_read: true })
  const { router } = await renderApp(tableHref(SITE), viewer)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  const cell = within(line).getByTestId('cell-region')
  await waitFor(() => expect(cell).toHaveTextContent('A row you cannot see'))
  fireEvent.click(cell.firstElementChild ?? cell)
  const href = (router.state as { location: { href: string } }).location.href
  expect(decodeURIComponent(href)).not.toContain('KL')
})

test("a read-only form's link to an unreadable row reads neutrally, without its id", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Viewer', table: SITE, can_read: true })
  await renderApp(rowHref(SITE, 'ENK'), viewer)
  const field = await screen.findByTestId('value-region')
  await waitFor(() => expect(field).toHaveTextContent('A row you cannot see'))
  expect(field).not.toHaveTextContent('KL')
  expect(within(field).queryByRole('link')).not.toBeInTheDocument()
})

test('an editable form shows a link to an unreadable row as neutral text, with no box to type in and no way to the row', async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Writer', table: SITE, can_read: true, can_write: true })
  await renderApp(rowHref(SITE, 'ENK'), viewer)
  const field = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-form-field="region"]')
    if (!el) throw new Error('no region field yet')
    return el
  })
  await waitFor(() => expect(field).toHaveTextContent('A row you cannot see'))
  expect(field.querySelector('input, textarea, [role="combobox"]')).toBeNull()
  expect(field).not.toHaveTextContent('KL')
  expect(screen.queryByTestId('link-pane-region')).not.toBeInTheDocument()
  expect(screen.queryByTestId('link-open-region')).not.toBeInTheDocument()
})

test('saving a form keeps a link to a row the person cannot read', async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Writer', table: SITE, can_read: true, can_write: true })
  await renderApp(rowHref(SITE, 'ENK'), viewer)
  const name = await screen.findByLabelText('Site name', undefined, { timeout: 10_000 })
  await waitFor(() => expect(document.querySelector('[data-form-field="region"]')).toHaveTextContent('A row you cannot see'))
  fireEvent.change(name, { target: { value: 'Enchakkal North' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(async () => expect((await admin.get<{ site_name: string }>(`/api/table/${encodeURIComponent(SITE)}/ENK`)).site_name).toBe('Enchakkal North'))
  expect((await admin.get<{ region: string }>(`/api/table/${encodeURIComponent(SITE)}/ENK`)).region).toBe('KL')
})
