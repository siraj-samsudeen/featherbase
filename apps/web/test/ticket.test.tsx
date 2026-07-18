// The ticketing system tested at the component layer: real ListView/FormView
// (generic Desk) rendered in jsdom, talking through the fetch bridge to the
// in-process server, inside a rolled-back Postgres transaction.
//
// MECE states: list-with-data, list-empty (permission-scoped), form-create,
// form-validation-error, workflow-transition — one test per state.

import { screen } from '@testing-library/react'
import { test, expect, renderDesk, renderSession } from './pg-test'

test('list: an admin sees the seeded tickets', async ({ admin }) => {
  await renderDesk('/desk/Ticket', admin)
  expect(await screen.findByText('TICK-0001')).toBeInTheDocument()
  expect(
    await screen.findByText('Sales mismatch between DW and SAP for store CHN-02'),
  ).toBeInTheDocument()
})

test('list: a reporter with no tickets sees an empty, permission-scoped list', async ({
  createUser,
}) => {
  const reporter = await createUser({ roles: ['Ticket Reporter'] })
  await renderDesk('/desk/Ticket', reporter)
  await screen.findByTestId('list-view')
  await new Promise((r) => setTimeout(r, 150))
  expect(screen.queryByText('TICK-0001')).not.toBeInTheDocument()
})

test('form: create a ticket through the UI (Session DSL) — real save, real series', async ({
  admin,
}) => {
  const { session } = await renderSession('/desk/Ticket/new', admin)
  await session
    .fillIn('Title', 'Filed from a component test')
    .selectOption('Type', 'Question')
    .selectOption('Priority', 'High')
    .clickButton('Save')
    .assertText('TICK-0006')
})

test('form: a dirty form with an empty required title shows the field error', async ({
  admin,
}) => {
  // A pristine form's Save is disabled (dirty-tracking), so make it dirty
  // via another field and leave the required title empty.
  const { session } = await renderSession('/desk/Ticket/new', admin)
  await session
    .fillIn('Area', 'sales mart')
    .clickButton('Save')
    .assertText('Please fix the highlighted fields')
  expect(await screen.findByTestId('error-title')).toBeInTheDocument()
})

test('workflow: Start Progress from the ticket form moves the state', async ({ admin }) => {
  const { session } = await renderSession('/desk/Ticket/TICK-0001', admin)
  await session
    .assertText('TICK-0001')
    .clickButton('Start Progress')
    .assertText('In Progress')
})

test("workflow: the previous test's transition rolled back — TICK-0001 is Open again", async ({
  admin,
}) => {
  await renderDesk('/desk/Ticket/TICK-0001', admin)
  const badge = await screen.findByTestId('workflow-actions')
  expect(badge.textContent).toContain('Open')
})
