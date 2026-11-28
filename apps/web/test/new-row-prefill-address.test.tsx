// #100, #1419: a new row's prefill comes from its address as a plain JSON object (?prefill={"…"}); a string, as
// older links wrote it, still parses; anything else is ignored rather than breaking the form. Made-up names.
import { screen, waitFor } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

const T = { timeout: 10_000 }
type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Npa Shelf', columns: [
    { column_name: 'shelf_name', column_type: 'Data', label: 'Shelf name' },
    { column_name: 'starts_on', column_type: 'Date', label: 'Starts on' },
  ] })
}
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field="${name}"]`)

test('a prefill written as a plain object fills the new row', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Npa Shelf')}/new?prefill=${encodeURIComponent(JSON.stringify({ shelf_name: 'Top Shelf', starts_on: '2026-11-27' }))}`, admin)
  await waitFor(() => expect(field('shelf_name')).toHaveValue('Top Shelf'), T)
  expect(field('starts_on')).toHaveValue('2026-11-27')
})

test('a prefill written as a quoted JSON string, as older links wrote it, still fills the new row', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Npa Shelf')}/new?prefill=${encodeURIComponent(JSON.stringify(JSON.stringify({ shelf_name: 'Old Link' })))}`, admin)
  await waitFor(() => expect(field('shelf_name')).toHaveValue('Old Link'), T)
})

test('a prefill that is not JSON is ignored: the new row opens empty', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Npa Shelf')}/new?prefill=not-json`, admin)
  await screen.findByTestId('doc-page', {}, T)
  await waitFor(() => expect(field('shelf_name')).toHaveValue(''), T)
})
