// The HD Ticket helpdesk (a registered app manifest,
// server/src/sample-apps/helpdesk.ts — PLAT-006 #78) tested at the component
// layer: real ListView/FormView (generic Desk) rendered in jsdom, talking
// through the fetch bridge to the in-process server, inside a rolled-back
// Postgres transaction. Each test installs the app itself — through the real
// installApp() manifest path, inside its sandbox transaction — and creates
// its own tickets; demo content is opt-in.
//
// MECE states: list-with-data, list-empty (permission-scoped), form-create,
// form-validation-error, workflow-transition — one test per state.

import { screen, waitFor } from '@testing-library/react'
import { installApp } from 'server/src/apps'
import { sql } from 'server/src/db'
import { test, expect, renderDesk, renderSession } from './pg-test'

// A dev database may already carry the committed structure (seed:helpdesk,
// or the ticketing e2e ran against it) — adopt it instead of colliding.
async function installHelpdesk() {
  const [have] = await sql`select 1 from table_def where name = 'HD Ticket'`
  if (!have) await installApp('helpdesk')
}

test('list: an admin sees a freshly created ticket', async ({ admin }) => {
  await installHelpdesk()
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
  await installHelpdesk()
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
  await installHelpdesk()
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
  await installHelpdesk()
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
  await installHelpdesk()
  const doc = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'HD Ticket',
    doc: { subject: 'Workflow via the UI' },
  })
  const { session } = await renderSession(`/desk/HD%20Ticket/${doc.name}`, admin)
  await session.assertText(doc.name).clickButton('Start')
  // 'In Progress' sits in the status <select>'s options from the first
  // render, so a bare assertText would pass before the transition even
  // lands — assert the workflow-state pill specifically.
  await waitFor(
    () => expect(screen.getByTestId('workflow-state')).toHaveTextContent('In Progress'),
    { timeout: 5000 },
  )
  // And wait for the click's async apply() to settle: the status select
  // showing 'In Progress' as its VALUE (not an option) means the doc
  // refetch — the last network call apply() awaits — has delivered. Without
  // this the test ends with the POST's tail still in flight; that tail then
  // runs after this test's transaction rolled back (42P01 on the vanished
  // sandbox table) and, on a slow box, after jsdom teardown — the "window
  // is not defined" unhandled rejection that failed CI while every test
  // passed. (No follow-up action renders to wait on instead: from
  // In Progress the only transition, Resolve, is condition-gated on
  // resolution_details for everyone, Administrator included.)
  await waitFor(
    () => expect(screen.getByDisplayValue('In Progress')).toBeInTheDocument(),
    { timeout: 5000 },
  )
})
