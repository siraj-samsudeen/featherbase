// CUST-003: a Client Script on a Table runs in the form. Moved from the
// Playwright client-script spec (#1080): the scripts are real Client Script
// rows, loaded by the real form from the in-process server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

type Admin = Parameters<typeof renderApp>[1]
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`)!

async function tableWithScript(admin: Admin, table: string, script: string) {
  await admin.post('/api/table_def', {
    name: table,
    columns: [
      { column_name: 'qty', column_type: 'Int', in_list_view: true },
      { column_name: 'total', column_type: 'Int', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Client Script',
    row: { row_id: `${table} script`, ref_table: table, script, enabled: true },
  })
}

// A new row's form is ready before its scripts have arrived; a person types
// after they have, so the test waits for the page's Client Script read too.
function clientScriptsRead(): () => boolean {
  const bridged = globalThis.fetch
  let done = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await bridged(input, init)
    if (String(input instanceof Request ? input.url : input).includes('/api/table/Client%20Script')) done = true
    return res
  })
  return () => done
}

async function openNewFromList(admin: Admin, slug: string) {
  const scriptsRead = clientScriptsRead()
  await renderApp(`/featherbase/admin/table/${slug}`, admin)
  await userEvent.click(await screen.findByTestId('list-new', {}, { timeout: 8000 }))
  await screen.findByTestId('form-view')
  await waitFor(() => expect(field('qty')).toBeInTheDocument())
  await waitFor(() => expect(scriptsRead()).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function change(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } })
  fireEvent.blur(field(name))
}

test('CUST-003: a client script fills a field each time the field it watches changes', async ({ admin }) => {
  await tableWithScript(
    admin,
    'Cs Order',
    `featherbase.ui.form.on('Cs Order', { qty: function(frm){ frm.set_value('total', (frm.get_value('qty') || 0) * 10) } })`,
  )
  await openNewFromList(admin, 'cs-order')
  change('qty', '7')
  await waitFor(() => expect(field('total')).toHaveValue(70))
  change('qty', '3')
  await waitFor(() => expect(field('total')).toHaveValue(30))
})

test('CUST-003: a client script that throws as it loads is reported, and the form stays usable', async ({ admin }) => {
  await tableWithScript(admin, 'Cs Bad', `throw new Error('boom in client script')`)
  await openNewFromList(admin, 'cs-bad')
  expect(await screen.findByTestId('client-script-error', {}, { timeout: 8000 })).toHaveTextContent('boom in client script')
  change('qty', '5')
  expect(field('qty')).toHaveValue(5)
  expect(screen.getByTestId('session-user')).toBeInTheDocument()
})
