// UI-009 + META-013: the FormView refuses to send a save it can already tell
// is invalid. The shared zod schema (packages/shared) is derived from Table
// metadata, so the client can reject a missing required column without asking
// the server — and the point of the rule is the round trip that DOESN'T
// happen. Pushed down from e2e/client-validation.spec.ts (#223 batch 1): the
// assertion was never about the browser, only about the network, and the
// fetch bridge is a sharper place to count calls than a Playwright route
// interceptor.
//
// Two states, both required to make the claim: invalid → inline error and
// zero calls; valid → exactly one call and a save.

import { screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'CV Form'

async function makeForm(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  return admin.post('/api/save_row', {
    table: DT,
    row: { title: 'starts valid', qty: 4 },
  }) as Promise<{ row_id: string }>
}

/** Count save_row round trips through the bridged fetch, letting them through. */
function countSaves() {
  const calls = { n: 0 }
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/save_row')) calls.n++
    return real(input, init)
  })
  return calls
}

const field = (name: string) =>
  document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

test('an emptied required column errors inline and sends no save at all', async ({ admin }) => {
  const doc = await makeForm(admin)
  const saves = countSaves()

  await renderApp(`/admin/${encodeURIComponent(DT)}/${doc.row_id}`, admin)
  await screen.findByTestId('form-view')
  await waitFor(() => expect(field('title')).toHaveValue('starts valid'))

  fireEvent.change(field('title'), { target: { value: '' } })
  ;(await screen.findByTestId('form-save')).click()

  expect(await screen.findByTestId('error-title')).toHaveTextContent(/required/i)
  expect(saves.n).toBe(0)
})

test('fixing the column clears the error and sends exactly one save', async ({ admin }) => {
  const doc = await makeForm(admin)
  const saves = countSaves()

  await renderApp(`/admin/${encodeURIComponent(DT)}/${doc.row_id}`, admin)
  await screen.findByTestId('form-view')
  await waitFor(() => expect(field('title')).toHaveValue('starts valid'))

  fireEvent.change(field('title'), { target: { value: '' } })
  ;(await screen.findByTestId('form-save')).click()
  await screen.findByTestId('error-title')

  fireEvent.change(field('title'), { target: { value: 'client valid again' } })
  ;(await screen.findByTestId('form-save')).click()

  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent(/saved/i))
  expect(screen.queryByTestId('error-title')).not.toBeInTheDocument()
  expect(saves.n).toBe(1)

  // …and it is the server's row that changed, not just the input's value.
  const saved = (await admin.get(
    `/api/table/${encodeURIComponent(DT)}/${doc.row_id}`,
  )) as { title: string }
  expect(saved.title).toBe('client valid again')
})
