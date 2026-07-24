// The HD Ticket helpdesk tested at the component layer: real
// ListView/FormView (generic Desk) rendered in jsdom, talking through the
// fetch bridge to the in-process server, inside a rolled-back Postgres
// transaction. Tests create their own tickets — demo content is opt-in.
//
// MECE states: list-with-data, list-empty (permission-scoped), form-create,
// form-validation-error, workflow-transition — one test per state.

import { screen } from '@testing-library/react'
import { test, expect, renderDesk, renderSession } from './pg-test'

test('list: an admin sees a freshly created ticket', async ({ admin }) => {
  const doc = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'HD Ticket',
    doc: { subject: 'Rendered by the generic ListView' },
  })
  await renderDesk('/desk/HD%20Ticket', admin)
  expect(await screen.findByText(doc.name)).toBeInTheDocument()
  expect(await screen.findByText('Rendered by the generic ListView')).toBeInTheDocument()
})

test('list: a customer with no tickets sees an empty, permission-scoped list', async ({
  admin,
  createUser,
}) => {
  const other = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'HD Ticket',
    doc: { subject: 'Someone else’s ticket' },
  })
  const customer = await createUser({ roles: ['Customer'] })
  await renderDesk('/desk/HD%20Ticket', customer)
  await screen.findByTestId('list-view')
  await new Promise((r) => setTimeout(r, 150))
  expect(screen.queryByText(other.name)).not.toBeInTheDocument()
})

test('form: create a ticket through the UI (Session DSL) — real save, real series', async ({
  admin,
}) => {
  const { session } = await renderSession('/desk/HD%20Ticket/new', admin)
  await session
    .fillIn('Subject', 'Filed from a component test')
    .selectOption('Priority', 'High')
    .clickButton('Save')
    .assertText('HDT-')
})

test('form: a dirty form with an empty required subject shows the field error', async ({
  admin,
}) => {
  // A pristine form's Save is disabled (dirty-tracking), so make it dirty
  // via another field and leave the required subject empty.
  const { session } = await renderSession('/desk/HD%20Ticket/new', admin)
  await session
    .fillIn('Description', 'details without a subject')
    .clickButton('Save')
    .assertText('Please fix the highlighted fields')
  expect(await screen.findByTestId('error-subject')).toBeInTheDocument()
})

test('workflow: Start from the ticket form moves the bound status field', async ({ admin }) => {
  const doc = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'HD Ticket',
    doc: { subject: 'Workflow via the UI' },
  })
  const { session } = await renderSession(`/desk/HD%20Ticket/${doc.name}`, admin)
  await session.assertText(doc.name).clickButton('Start').assertText('In Progress')
})
