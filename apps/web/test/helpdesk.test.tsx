// The HD Ticket helpdesk (a registered app manifest,
// server/src/sample-apps/helpdesk.ts — PLAT-006 #78) tested at the component
// layer: real ListView/FormView (generic Admin) rendered in jsdom, talking
// through the fetch bridge to the in-process server, inside a rolled-back
// Postgres transaction. Each test installs the app itself — through the real
// installApp() manifest path, inside its sandbox transaction — and creates
// its own tickets; demo content is opt-in.
//
// MECE states: list-with-data, list-empty (permission-scoped), form-create,
// form-validation-error, workflow-transition — one test per state.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp } from 'server/src/apps'
import { sql } from 'server/src/db'
import { test, expect, renderApp, renderSession } from './pg-test'

// A dev database may already carry the committed structure (seed:helpdesk,
// or the ticketing e2e ran against it) — adopt it instead of colliding.
async function installHelpdesk() {
  const [have] = await sql`select 1 from table_def where name = 'HD Ticket'`
  if (!have) await installApp('helpdesk')
}

test('list: an admin sees a freshly created ticket', async ({ admin }) => {
  await installHelpdesk()
  const doc = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'HD Ticket',
    row: { subject: 'Rendered by the generic ListView' },
  })
  await renderApp('/featherbase/admin/table/hd-ticket', admin)
  // #792: the list leads with the ticket's subject, its title, as the link to it.
  const link = await screen.findByRole('link', { name: 'Rendered by the generic ListView' })
  expect(link.getAttribute('href')).toContain(doc.row_id)
})

test('list: opening a ticket from the list shows its form with the workflow actions of its state', async ({ admin }) => {
  await installHelpdesk()
  await admin.post('/api/save_row', { table: 'HD Ticket', row: { subject: 'Opens with workflow actions' } })
  await renderApp('/featherbase/admin/table/hd-ticket', admin)
  await userEvent.click(await screen.findByRole('link', { name: 'Opens with workflow actions' }, { timeout: 8000 }))
  expect(await screen.findByTestId('form-view')).toBeInTheDocument()
  expect(await screen.findByTestId('workflow-actions')).toHaveTextContent('Open')
  expect(await screen.findByTestId('workflow-action-Start')).toBeInTheDocument()
})

test('list: a customer with no tickets sees an empty, permission-scoped list', async ({
  admin,
  createUser,
}) => {
  await installHelpdesk()
  const other = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'HD Ticket',
    row: { subject: 'Someone else’s ticket' },
  })
  const customer = await createUser({ roles: ['Customer'] })
  // Positive control: own_rows_only scoping (HD Ticket / Customer) means a
  // ticket the customer creates themselves IS visible to them. `list-view`
  // mounts (and 'No rows' renders into it) before the list query even
  // fires — meta.data gates the whole page, but the rows fetch is a second,
  // later query, and its "no rows yet" and "loaded, truly empty" states
  // render identically. Waiting on the customer's own ticket instead proves
  // the list query has actually resolved with this customer's scoped data
  // — not just that the container mounted — before we assert the other
  // customer's ticket is absent.
  //
  // Customer carries can_create without can_write (the app's real shape —
  // creation is meant to happen through the Web Form, see helpdesk.ts), so
  // fields get stripped on a raw /api/save_row insert; go through the
  // installed "New Ticket" web form instead, exactly like a real customer
  // would, which creates the row in the logged-in submitter's name.
  const mine = await customer.post<{ row_id: string }>('/api/web_form/new-ticket', {
    values: { subject: 'My own ticket, scoped visible' },
  })
  await renderApp('/featherbase/admin/table/hd-ticket', customer)
  // #792: the list leads with each ticket's subject, its title.
  expect(await screen.findByText('My own ticket, scoped visible')).toBeInTheDocument()
  expect(screen.queryByText('Someone else’s ticket')).not.toBeInTheDocument()
  expect(screen.queryByText(other.row_id)).not.toBeInTheDocument()
})

test('form: create a ticket through the UI (Session DSL) — real save, real series', async ({
  admin,
}) => {
  await installHelpdesk()
  const { session } = await renderSession('/featherbase/admin/table/hd-ticket/new', admin)
  await session
    .fillIn('Subject', 'Filed from a component test')
    .selectOption('Priority', 'High')
    .clickButton('Save')
  // The save numbers the ticket from the series, and the form shows it. (The row
  // id is not on that page: the form reads by its subject. #898 stopped the
  // sidebar flashing the id while the title loads, which this used to find.)
  const saved = await waitFor(async () => {
    const { data } = await admin.get<{ data: { row_id: string }[] }>('/api/table/HD%20Ticket')
    expect(data).toHaveLength(1)
    return data[0].row_id
  }, { timeout: 5000 })
  expect(saved).toMatch(/^HDT-\d+$/)
  expect(await admin.get<{ subject: string }>(`/api/table/HD%20Ticket/${saved}`)).toMatchObject({ subject: 'Filed from a component test' })
  await waitFor(() => expect(screen.getByTestId('form-view')).toHaveTextContent('Filed from a component test'), { timeout: 5000 })
})

test('form: a dirty form with an empty required subject shows the field error', async ({
  admin,
}) => {
  await installHelpdesk()
  // A pristine form's Save is disabled (dirty-tracking), so make it dirty
  // via another field and leave the required subject empty.
  const { session } = await renderSession('/featherbase/admin/table/hd-ticket/new', admin)
  await session
    .fillIn('Description', 'details without a subject')
    .clickButton('Save')
    .assertText('Please fix the highlighted fields')
  expect(await screen.findByTestId('error-subject')).toBeInTheDocument()
})

test('workflow: Start from the ticket form moves the bound status field', async ({ admin }) => {
  await installHelpdesk()
  const doc = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'HD Ticket',
    row: { subject: 'Workflow via the UI' },
  })
  const { session } = await renderSession(`/featherbase/admin/table/hd-ticket/row/${doc.row_id}`, admin)
  // The ticket's page reads by its subject, not its id (#898: the sidebar no
  // longer flashes the id while the title loads, which this used to find).
  expect(await screen.findByTestId('form-view', {}, { timeout: 5000 })).toHaveTextContent('Workflow via the UI')
  await session.clickButton('Start')
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
