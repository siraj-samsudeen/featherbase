// #910 checklist 1 (spec: list-view "A compact list, remembered per table"):
// a list shows all its columns by default; Compact leads with each row's name
// and a few key values, and the choice is kept for that person on that table.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const headers = () => within(screen.getByTestId('list-table-scroll')).getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim())
const layout = () => screen.findByRole('group', { name: 'List layout' })

test('a list shows every one of its columns by default', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  expect(within(await layout()).getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on']))
})

test('Compact leads with the name and two key values', async ({ admin }) => {
  await seedSites(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(SITE)}`, { shownCols: ['rent'] })
  await renderApp(tableHref(SITE), admin)
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on', 'Rent']))
  fireEvent.click(within(await layout()).getByRole('button', { name: 'Compact' }))
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on']))
})

test('the compact choice is kept for that table alone, after signing in again', async ({ admin }) => {
  await seedSites(admin)
  const first = await renderApp(tableHref(SITE), admin)
  fireEvent.click(within(await layout()).getByRole('button', { name: 'Compact' }))
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { compact?: boolean } | null }>(`/api/user_settings/${encodeURIComponent(SITE)}`)
    expect(settings?.compact).toBe(true)
  })
  first.unmount()
  const again = await renderApp(tableHref(SITE), admin)
  await waitFor(async () => expect(within(await layout()).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true'))
  again.unmount()
  await renderApp(tableHref(PLANT), admin)
  expect(within(await layout()).getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
})
