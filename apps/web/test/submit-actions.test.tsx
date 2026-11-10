// UI-010: a submittable row's form walks Draft → Submitted → Cancelled →
// amended Draft, each with its own action and field lock. The lifecycle on
// the server: apps/server/test/document.test.ts.
import { tableSlug } from 'shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'UI Sub Order'
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname
const title = () => document.querySelector<HTMLInputElement>('[data-field=title]')

test('UI-010: Draft offers Submit, Submitted locks the fields and offers Cancel, Cancelled offers Amend to a new draft', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    is_submittable: true,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', reqd: true }],
  })
  const { row_id } = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(DT)}`, { title: 'action doc' })
  const user = userEvent.setup()
  const app = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${row_id}`, admin)

  // Draft: Submit offered, the field editable.
  await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Draft'), { timeout: 8000 })
  expect(screen.getByTestId('form-submit')).toBeInTheDocument()
  await waitFor(() => expect(title()).toBeEnabled())

  // Submitted: Cancel offered, Submit gone, the title reads as a value (#795).
  await user.click(screen.getByTestId('form-submit'))
  await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Submitted'), { timeout: 8000 })
  expect(await screen.findByTestId('form-cancel')).toBeInTheDocument()
  expect(screen.queryByTestId('form-submit')).not.toBeInTheDocument()
  expect(document.querySelector('[data-form-field][data-label="Title"] [data-value]')?.textContent).toBe('action doc')
  expect(title()).toBeNull()

  // Cancelled: Amend offered.
  await user.click(screen.getByTestId('form-cancel'))
  await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Cancelled'), { timeout: 8000 })
  expect(await screen.findByTestId('form-amend')).toBeInTheDocument()

  // Amend: a new editable draft, named after the original.
  await user.click(screen.getByTestId('form-amend'))
  await waitFor(() => expect(here(app)).toBe(`/featherbase/admin/table/${tableSlug(DT)}/row/${row_id}-1`), { timeout: 8000 })
  await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Draft'))
  await waitFor(() => expect(title()).toHaveValue('action doc'))
  expect(title()).toBeEnabled()
})

test('a Submit the network drops says the action failed and leaves the row a draft', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    is_submittable: true,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', reqd: true }],
  })
  const { row_id } = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(DT)}`, { title: 'lost submit' })
  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${row_id}`, admin)
  await waitFor(() => expect(screen.getByTestId('status-badge')).toHaveTextContent('Draft'), { timeout: 8000 })
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(':submit')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await user.click(await screen.findByTestId('form-submit'))
  expect(await screen.findByTestId('form-banner')).toHaveTextContent('Action failed')
  expect(screen.getByTestId('status-badge')).toHaveTextContent('Draft')
})
