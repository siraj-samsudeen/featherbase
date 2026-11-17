// #910 checklist 1 (spec: list-view "A compact list, remembered per table"):
// a list shows all its columns by default; Compact leads with each row's name
// and a few key values, and the choice is kept for that person on that table.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const headers = () => within(screen.getByTestId('list-table-scroll')).getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim())
/** #1259: density is one Compact Rows button (Table names a list's view now). */
const compactRows = () => screen.findByRole('button', { name: 'Compact Rows' })

test('a list shows every one of its columns by default', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  expect((await compactRows())).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on']))
})

test('Compact leads with the name and two key values', async ({ admin }) => {
  await seedSites(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(SITE)}`, { shownCols: ['rent'] })
  await renderApp(tableHref(SITE), admin)
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on', 'Rent']))
  fireEvent.click(await compactRows())
  await waitFor(() => expect(headers()).toEqual(['', 'Site name', 'Region', 'Opened on']))
})

test('the compact choice is kept for that table alone, after signing in again', async ({ admin }) => {
  await seedSites(admin)
  const first = await renderApp(tableHref(SITE), admin)
  // A click before the person's saved list settings arrive cannot overwrite
  // them (list-settings.test.tsx), so choose Compact Rows until one is saved;
  // it is one on/off button, so an early click that showed it on without
  // saving it is turned off and on again.
  await waitFor(async () => {
    const button = await compactRows()
    if (button.getAttribute('aria-pressed') === 'true') fireEvent.click(button)
    fireEvent.click(button)
    const { settings } = await admin.get<{ settings: { compact?: boolean } | null }>(`/api/user_settings/${encodeURIComponent(SITE)}`)
    expect(settings?.compact).toBe(true)
  })
  first.unmount()
  const again = await renderApp(tableHref(SITE), admin)
  await waitFor(async () => expect((await compactRows())).toHaveAttribute('aria-pressed', 'true'))
  again.unmount()
  await renderApp(tableHref(PLANT), admin)
  expect((await compactRows())).toHaveAttribute('aria-pressed', 'false')
})

test("Compact clicked before the person's saved list settings arrive cannot overwrite them", async ({ admin }) => {
  await seedSites(admin)
  // Saved settings exist (a column shown, not compact), and they arrive late.
  await admin.put(`/api/user_settings/${encodeURIComponent(SITE)}`, { shownCols: ['rent'] })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  const held = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes(`/api/user_settings/${encodeURIComponent(SITE)}`) && (!init?.method || init.method === 'GET')) await gate
    return real(input, init)
  })
  try {
    // #1228: a bare open waits for the saved settings (they carry the remembered filters), so the
    // race lives where the list opens at once: an address that names its filters.
    const everySite = encodeURIComponent(JSON.stringify([['site_name', '!=', 'No such site']]))
    await renderApp(`${tableHref(SITE)}?filters=${everySite}`, admin)
    fireEvent.click(await compactRows())
    release()
    await waitFor(async () => expect((await compactRows())).toHaveAttribute('aria-pressed', 'false'))
    const { settings } = await admin.get<{ settings: { compact?: boolean; shownCols?: string[] } | null }>(`/api/user_settings/${encodeURIComponent(SITE)}`)
    expect(settings?.compact).toBeFalsy()
    expect(settings?.shownCols).toEqual(['rent'])
  } finally {
    release()
    held.mockRestore()
  }
})
