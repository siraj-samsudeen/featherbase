// UI-025: on a phone the Admin's sidebar is a drawer. Closed, it is inert and
// hidden from assistive technology; opened from its toggle it is available
// with a backdrop; navigating from it closes it; across the breakpoint the
// mounted layout switches. The width is what the page's media queries are
// told (window.matchMedia), since jsdom has no viewport: where the drawer
// sits, whether the toggle shows, Tab skipping the inert drawer and Tailwind's
// md: breakpoint landing on the same pixel are a real browser's to witness.
import { tableSlug } from 'shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Resp Item'

/** Answer the page's media queries as a window `width` pixels wide; `resize`
 *  changes it and tells every listening query. */
function viewport(initial: number) {
  let width = initial
  const listeners = new Set<() => void>()
  const matches = (q: string) => {
    if (q === '(width < 48rem)') return width < 768
    const max = /max-width:\s*([\d.]+)px/.exec(q)
    if (max) return width <= Number(max[1])
    const min = /min-width:\s*([\d.]+)px/.exec(q)
    if (min) return width >= Number(min[1])
    return false
  }
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    get matches() { return matches(q) },
    media: q, onchange: null,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    addListener: (f: () => void) => listeners.add(f),
    removeListener: (f: () => void) => listeners.delete(f),
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList)
  return {
    resize(to: number) {
      width = to
      act(() => { for (const f of [...listeners]) f() })
    },
  }
}

const sidebar = () => screen.getByTestId('admin-sidebar')

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', in_list_view: true },
      { column_name: 'notes', column_type: 'Text' },
    ],
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { title: 'Widget', qty: 5 })
}

test('UI-025: at phone width the closed drawer is inert, and its toggle opens and closes it from the keyboard', async ({ admin }) => {
  viewport(375)
  const user = userEvent.setup()
  await renderApp('/featherbase/admin', admin)
  const toggle = await screen.findByTestId('sidebar-toggle', {}, { timeout: 8000 })
  expect(sidebar()).toHaveAttribute('inert')
  expect(sidebar()).toHaveAttribute('aria-hidden', 'true')

  toggle.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByTestId('sidebar-backdrop')).toBeInTheDocument()
  expect(sidebar()).not.toHaveAttribute('inert')
  expect(sidebar()).not.toHaveAttribute('aria-hidden')

  toggle.focus()
  await user.keyboard('{Enter}')
  expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument()
  expect(sidebar()).toHaveAttribute('inert')
  expect(sidebar()).toHaveAttribute('aria-hidden', 'true')
})

test('UI-025: navigating from the open phone drawer closes it, and the list and a new row open', async ({ admin }) => {
  await seed(admin)
  viewport(375)
  const user = userEvent.setup()
  const app = await renderApp('/featherbase/admin', admin)
  await user.click(await screen.findByTestId('sidebar-toggle', {}, { timeout: 8000 }))
  await user.click(await screen.findByRole('link', { name: 'All tables' }))
  await waitFor(() => expect((app.router as { state: { location: { pathname: string } } }).state.location.pathname).toBe('/featherbase/admin/all-tables'))
  expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument()
  expect(sidebar()).toHaveAttribute('inert')

  await user.click(await screen.findByRole('link', { name: DT }))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  expect((app.router as { state: { location: { pathname: string } } }).state.location.pathname).toBe(`/featherbase/admin/table/${tableSlug(DT)}`)
  await user.click(await screen.findByRole('link', { name: 'New' }))
  expect(await screen.findByTestId('form-view')).toBeInTheDocument()
})

test('UI-025: at desktop width the sidebar is never inert', async ({ admin }) => {
  viewport(1280)
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('new-table-link', {}, { timeout: 8000 })
  expect(sidebar()).not.toHaveAttribute('inert')
  expect(sidebar()).not.toHaveAttribute('aria-hidden')
})

test('UI-025: a mounted layout crossing 768 pixels switches between the drawer and the static sidebar', async ({ admin }) => {
  const screenSize = viewport(767)
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('new-table-link', {}, { timeout: 8000 })
  expect(sidebar()).toHaveAttribute('inert')

  screenSize.resize(768)
  expect(sidebar()).not.toHaveAttribute('inert')
  expect(sidebar()).not.toHaveAttribute('aria-hidden')

  screenSize.resize(767)
  expect(sidebar()).toHaveAttribute('inert')
  expect(sidebar()).toHaveAttribute('aria-hidden', 'true')
})
