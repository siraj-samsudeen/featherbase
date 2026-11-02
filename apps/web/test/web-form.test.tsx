// A published web form, opened by a visitor who is not signed in: the fields
// the builder chose, a choice's answers in the configured order, required
// marks, a refusal that keeps what the visitor typed, and the confirmation.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
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
