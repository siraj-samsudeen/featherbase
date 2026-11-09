// A published web form, opened by a visitor who is not signed in: the fields
// the builder chose, a choice's answers in the configured order, required
// marks, a refusal that keeps what the visitor typed, and the confirmation.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

type Admin = Parameters<typeof renderApp>[1]

async function publish(admin: Admin, published = true) {
  await admin.post('/api/table_def', {
    name: 'Wf Comp Order',
    columns: [
      { column_name: 'full_name', label: 'Full name', column_type: 'Data', reqd: true },
      { column_name: 'delivery_speed', label: 'Delivery speed', column_type: 'Choice', choices: 'Standard\nExpedited\nSame day', reqd: true },
      { column_name: 'notes', label: 'Notes', column_type: 'Data' },
      { column_name: 'internal_ref', label: 'Internal ref', column_type: 'Data' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Web Form',
    row: {
      row_id: 'wf-comp-order',
      title: 'Order form',
      route: 'wf-comp-order',
      ref_table: 'Wf Comp Order',
      published,
      success_message: 'Thanks, we have your order.',
      web_fields: ['full_name', 'delivery_speed', 'notes'],
    },
  })
}

test('a published form shows its chosen fields, marks the required ones and offers a choice in its configured order', async ({ admin }) => {
  await publish(admin)
  await renderApp('/featherbase/form/wf-comp-order', anonymous)

  expect(await screen.findByTestId('web-form-title')).toHaveTextContent('Order form')
  expect(screen.getByLabelText(/Full name/)).toBeInTheDocument()
  expect(screen.queryByLabelText(/Internal ref/)).not.toBeInTheDocument()
  expect(screen.getByText('Delivery speed', { exact: false }).textContent).toContain('*')
  expect(screen.getByText('Notes').textContent).not.toContain('*')
  const options = within(screen.getByLabelText(/Delivery speed/)).getAllByRole('option').map((o) => o.textContent)
  expect(options).toEqual(['—', 'Standard', 'Expedited', 'Same day'])
})

test('a missing required answer is explained and nothing already typed is lost; the next try creates the row and shows the confirmation', async ({ admin }) => {
  await publish(admin)
  await renderApp('/featherbase/form/wf-comp-order', anonymous)

  await userEvent.type(await screen.findByLabelText(/Full name/), 'Ada Lovelace')
  await userEvent.type(screen.getByLabelText('Notes'), 'ring the bell')
  await userEvent.click(screen.getByTestId('web-form-submit'))

  expect(await screen.findByTestId('web-form-submit-error')).toBeInTheDocument()
  expect(screen.getByLabelText(/Full name/)).toHaveValue('Ada Lovelace')
  expect(screen.getByLabelText('Notes')).toHaveValue('ring the bell')
  expect((await sql`select 1 from featherbase.wf_comp_order`).length).toBe(0)

  await userEvent.selectOptions(screen.getByLabelText(/Delivery speed/), 'Expedited')
  await userEvent.clear(screen.getByLabelText('Notes'))
  await userEvent.click(screen.getByTestId('web-form-submit'))
  expect(await screen.findByTestId('web-form-success')).toHaveTextContent('Thanks, we have your order.')
  const [row] = await sql`select full_name, delivery_speed, notes from featherbase.wf_comp_order`
  expect(row).toMatchObject({ full_name: 'Ada Lovelace', delivery_speed: 'Expedited', notes: null })
})

test('a form that is still a draft is not shown', async ({ admin }) => {
  await publish(admin, false)
  await renderApp('/featherbase/form/wf-comp-order', anonymous)
  expect(await screen.findByTestId('web-form-error')).toHaveTextContent(/No published web form/)
  expect(screen.queryByTestId('web-form-form')).not.toBeInTheDocument()
})

// WEB-002, moved down from e2e/web-form.spec.ts (#1080): choices whose answers
// look like numbers, and an optional choice left on its placeholder.
test('WEB-002: anonymous web form submit creates a document', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Wf Msg',
    columns: [
      { column_name: 'full_name', label: 'Full name', column_type: 'Data', reqd: true },
      { column_name: 'message', label: 'Message', column_type: 'Long Text', reqd: true },
      { column_name: 'delivery_speed', label: 'Delivery speed', column_type: 'Choice', choices: 'Standard\nExpedited\nSame day', reqd: true },
      { column_name: 'contact_method', label: 'Contact method', column_type: 'Choice', choices: 'Email\nPhone' },
      { column_name: 'quantity_code', label: 'Quantity code', column_type: 'Choice', choices: '0\n1\n2', reqd: true },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Web Form',
    row: {
      row_id: 'wf-msg', title: 'Contact E2E', route: 'wf-msg', ref_table: 'Wf Msg', published: true,
      web_fields: ['full_name', 'message', 'delivery_speed', 'contact_method', 'quantity_code'],
    },
  })
  const user = userEvent.setup()
  await renderApp('/featherbase/form/wf-msg', anonymous)
  const title = await screen.findByTestId('web-form-title', {}, { timeout: 8000 })
  expect(title.textContent).toBe('Contact E2E')
  const options = (label: RegExp) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent)
  expect(options(/Delivery speed/)).toEqual(['—', 'Standard', 'Expedited', 'Same day'])
  expect(options(/Contact method/)).toEqual(['—', 'Email', 'Phone'])
  expect(options(/Quantity code/)).toEqual(['—', '0', '1', '2'])

  await user.type(screen.getByLabelText(/Full name/), 'Wf Visitor')
  await user.click(screen.getByTestId('web-form-submit'))
  expect(await screen.findByTestId('web-form-submit-error')).toBeInTheDocument()

  await user.type(screen.getByLabelText(/Message/), 'Hello from the public web form')
  await user.selectOptions(screen.getByLabelText(/Delivery speed/), 'Expedited')
  expect(screen.getByLabelText(/Delivery speed/)).toHaveValue('Expedited')
  await user.selectOptions(screen.getByLabelText(/Quantity code/), '1')
  expect(screen.getByLabelText(/Quantity code/)).toHaveValue('1')
  await user.click(screen.getByTestId('web-form-submit'))
  expect(await screen.findByTestId('web-form-success', {}, { timeout: 8000 })).toBeInTheDocument()

  // The selected answers are stored as their exact strings; the optional one stays empty.
  const rows = await admin.get<{ total: number; data: Record<string, unknown>[] }>(
    `/api/table/${encodeURIComponent('Wf Msg')}?fields=${encodeURIComponent('["delivery_speed","contact_method","quantity_code"]')}`,
  )
  expect(rows.total).toBe(1)
  expect(rows.data).toEqual([{ delivery_speed: 'Expedited', contact_method: null, quantity_code: '1' }])
})

/** Requests to the form's address are lost, as offline. */
function dropForm(method: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith('/api/web_form/') &&
    (init?.method ?? 'GET') === method
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('a form the network drops says the form was not found', async ({ admin }) => {
  await publish(admin)
  dropForm('GET')
  await renderApp('/featherbase/form/wf-comp-order', anonymous)
  expect(await screen.findByTestId('web-form-error', {}, { timeout: 8000 })).toHaveTextContent('Form not found')
})

test('a submission the network drops says it failed and keeps what was typed', async ({ admin }) => {
  await publish(admin)
  await renderApp('/featherbase/form/wf-comp-order', anonymous)
  await screen.findByTestId('web-form', {}, { timeout: 8000 })
  await userEvent.type(screen.getByLabelText(/Full name/), 'Ada Lovelace')
  await userEvent.selectOptions(screen.getByLabelText(/Delivery speed/), 'Expedited')
  dropForm('POST')
  await userEvent.click(screen.getByTestId('web-form-submit'))
  expect(await screen.findByTestId('web-form-submit-error')).toHaveTextContent('Submission failed')
  expect(screen.getByLabelText(/Full name/)).toHaveValue('Ada Lovelace')
})
