// Small page paths the merged web coverage report (ADR 0012) showed red: the
// Google callback reached with no code or a code the server does not know,
// the print page of a row that is not there and its Print button, and a
// relation map address whose trail is not a trail. window.print is a browser
// API jsdom does not implement; the spy stands in for the print dialog.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
type Router = { state: { location: { pathname: string } } }
const enc = encodeURIComponent

afterEach(() => vi.restoreAllMocks())

test('the Google callback with no code goes back to the sign-in page', async () => {
  const { router } = await renderApp('/featherbase/oauth-callback', anonymous)
  await waitFor(() => expect((router as Router).state.location.pathname).toBe('/featherbase/login'))
})

test('the Google callback with a code the server does not know goes back to the sign-in page, signed out', async () => {
  const { router } = await renderApp('/featherbase/oauth-callback?code=no-such-code', anonymous)
  await waitFor(() => expect((router as Router).state.location.pathname).toBe('/featherbase/login'))
  expect(localStorage.getItem('fc_token')).toBeNull()
})

test('the print page of a row that is not there says it cannot be loaded', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Mpg Order', id_pattern: 'prompt', columns: [{ column_name: 'item', column_type: 'Data' }] })
  await renderApp(`/featherbase/print/${enc('Mpg Order')}/no-such-order`, admin)
  expect(await screen.findByText('Cannot load Mpg Order no-such-order', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('Print opens the browser print dialog', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Mpg Order', id_pattern: 'prompt', columns: [{ column_name: 'item', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Mpg Order', row: { row_id: 'ord-1', item: 'tea' } })
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  await renderApp(`/featherbase/print/${enc('Mpg Order')}/ord-1`, admin)
  await userEvent.click(await screen.findByTestId('print-button', {}, { timeout: 8000 }))
  expect(print).toHaveBeenCalledTimes(1)
})

test('a relation map whose trail is not a list of steps shows no trail', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Mpg Customer', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Mpg Customer', row: { row_id: 'cust-1', title: 'Asha' } })
  await renderApp(`/featherbase/admin/map/${enc('Mpg Customer')}/cust-1?trail=${enc('{"not":"a trail"}')}`, admin)
  await screen.findByTestId('map-center', {}, { timeout: 8000 })
  expect(screen.queryByTestId('map-trail')).not.toBeInTheDocument()
})
