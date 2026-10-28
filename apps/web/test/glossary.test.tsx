// #629: the Glossary page and the "?" help where a described word appears.
// The UI checklist is the first comment on #629; item numbers are cited
// below. Fixture: runtime-apps/fixtures/shelves-v1, an app shipping "Shelf
// Lead" and "Coverage".
import { resolve } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from 'server/src/db'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'

const shelves = resolve(process.cwd(), '../..', 'runtime-apps/fixtures/shelves-v1')

async function installShelves(admin: TestClient) {
  expect(await discoverPackages([shelves])).toEqual([])
  await admin.post('/api/install_app', { name: 'shelves' })
}

const addTerm = (admin: TestClient, row: Record<string, unknown>) =>
  admin.post<{ row_id: string }>('/api/save_row', { table: 'Glossary Term', row })

async function stockCount(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: 'Stock Count',
    columns: [
      { column_name: 'aisle', column_type: 'Data', label: 'Aisle' },
      { column_name: 'counted_by', column_type: 'Data', label: 'Counted by' },
    ],
  })
  await addTerm(admin, { term: 'Stock count', definition: 'One walk along an aisle, counting what is on the shelves.', describes: [{ link_table: 'Stock Count' }] })
  await addTerm(admin, { term: 'Counter', definition: 'The person who walked the aisle.', examples: 'Ravi counted aisle 4.', avoid: [{ word: 'auditor', reason: 'sounds like finance' }],
    describes: [{ link_table: 'Stock Count', link_column: 'counted_by' }] })
}

const groups = () => screen.getAllByTestId('glossary-group')
const cards = (scope: HTMLElement) => within(scope).getAllByTestId('glossary-term')

test('terms are grouped by app, A to Z, with the instance\'s own last (items 2, 4, 5)', async ({ admin }) => {
  await installShelves(admin)
  await addTerm(admin, { term: 'Planogram', definition: 'The drawing of what goes on each shelf.' })
  await renderApp('/featherbase/admin/glossary', admin)
  const page = await screen.findByTestId('glossary-page')
  expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Glossary')
  expect(page).toHaveTextContent('The words this instance\'s apps use, and what they mean.')
  await waitFor(() => expect(groups()).toHaveLength(2))
  expect(groups().map((g) => within(g).getByRole('heading', { level: 2 }).textContent)).toEqual(['Shelves', 'This instance'])
  const [coverage, lead] = cards(groups()[0])
  expect(within(coverage).getByRole('heading', { level: 3 })).toHaveTextContent('Coverage')
  expect(coverage).toHaveTextContent('The aisles a person looks after.')
  expect(coverage).toHaveTextContent('Avoidscope: reads as access rights')
  expect(within(coverage).getByRole('link', { name: 'shelves.aisle' })).toHaveAttribute('href', '/featherbase/admin/shelves.aisle')
  expect(coverage).not.toHaveTextContent('Examples')
  expect(lead).toHaveTextContent('ExamplesAsha is Shelf Lead for aisle 4 on the morning shift.')
  expect(within(lead).getByRole('link', { name: 'shelves.assignment, job' })).toBeInTheDocument()
})

test('search matches a term\'s name, avoid words and definition, and says when nothing matches (items 3, 9)', async ({ admin }) => {
  await installShelves(admin)
  await renderApp('/featherbase/admin/glossary', admin)
  const user = userEvent.setup()
  const search = await screen.findByLabelText('Search terms')
  await waitFor(() => expect(screen.getAllByTestId('glossary-term')).toHaveLength(2))
  await user.type(search, 'SCOPE')
  expect(screen.getAllByTestId('glossary-term').map((c) => within(c).getByRole('heading').textContent)).toEqual(['Coverage'])
  await user.clear(search)
  await user.type(search, 'tidy')
  expect(screen.getAllByTestId('glossary-term').map((c) => within(c).getByRole('heading').textContent)).toEqual(['Shelf Lead'])
  await user.clear(search)
  await user.type(search, 'lead')
  expect(screen.getAllByTestId('glossary-term').map((c) => within(c).getByRole('heading').textContent)).toEqual(['Shelf Lead'])
  await user.clear(search)
  await user.type(search, 'zebra')
  expect(screen.queryByTestId('glossary-term')).not.toBeInTheDocument()
  expect(screen.getByText('No term matches "zebra".')).toBeInTheDocument()
})

test('with no terms, the page says so (item 9)', async ({ admin }) => {
  await renderApp('/featherbase/admin/glossary', admin)
  expect(await screen.findByText('No terms yet.')).toBeInTheDocument()
})

test('an editor can add and edit terms; a reader cannot (items 1, 8)', async ({ admin, createUser }) => {
  await installShelves(admin)
  const { unmount } = await renderApp('/featherbase/admin/glossary', admin)
  expect(await screen.findByRole('link', { name: 'Add a term' })).toHaveAttribute('href', '/featherbase/admin/Glossary%20Term/new')
  await waitFor(() => expect(screen.getAllByRole('link', { name: /^Edit / })).toHaveLength(2))
  expect(screen.getByTestId('glossary-link')).toHaveAttribute('href', '/featherbase/admin/glossary')
  unmount()
  // A person with any grant of their own enters the Admin (#410); none on Glossary Term.
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Glossary Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Glossary Reader', can_read: true } })
  const reader = await createUser({ email: 'reader@example.test', roles: ['Glossary Reader'] })
  await renderApp('/featherbase/admin/glossary', reader)
  await waitFor(() => expect(screen.getAllByTestId('glossary-term')).toHaveLength(2))
  expect(screen.queryByRole('link', { name: 'Add a term' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /^Edit / })).not.toBeInTheDocument()
})

test('a reworded term shows Edited here; new app wording can be taken back (items 6, 7)', async ({ admin }) => {
  await installShelves(admin)
  await sql`update glossary_term set definition = 'The aisles you answer for.', app_wording_changed = true where app_key = 'Coverage'`
  await renderApp('/featherbase/admin/glossary', admin)
  await waitFor(() => expect(screen.getAllByTestId('glossary-term')).toHaveLength(2))
  const [coverage, lead] = screen.getAllByTestId('glossary-term')
  expect(coverage).toHaveTextContent('Edited here')
  expect(coverage).toHaveTextContent('The app\'s wording has changed.')
  expect(lead).not.toHaveTextContent('Edited here')
  await userEvent.click(within(coverage).getByRole('button', { name: 'Take the app\'s wording' }))
  await waitFor(() => expect(screen.getAllByTestId('glossary-term')[0]).not.toHaveTextContent('Edited here'))
  expect(screen.getAllByTestId('glossary-term')[0]).toHaveTextContent('The aisles a person looks after.')
  expect(screen.getAllByTestId('glossary-term')[0]).not.toHaveTextContent('The app\'s wording has changed.')
})

test('a described Table\'s title offers its term; nothing else does (items 10, 12)', async ({ admin }) => {
  await stockCount(admin)
  await renderApp('/featherbase/admin/Stock%20Count', admin)
  const title = await screen.findByRole('heading', { level: 1 })
  expect(await within(title).findByRole('button', { name: 'What is Stock count?' })).toBeInTheDocument()
  expect(screen.getAllByTestId('glossary-help')).toHaveLength(1)
})

test('a described field opens its term in place, and Escape closes it back to the "?" (items 10, 11, 12)', async ({ admin }) => {
  await stockCount(admin)
  await renderApp('/featherbase/admin/Stock%20Count/new', admin)
  const counted = await screen.findByLabelText('Counted by')
  expect(counted).toHaveAccessibleName('Counted by')
  const help = await screen.findByRole('button', { name: 'What is Counter?' })
  // The Table's own term in the title, and this field; Aisle has none.
  await waitFor(() => expect(screen.getAllByTestId('glossary-help')).toHaveLength(2))
  const user = userEvent.setup()
  await user.click(help)
  const panel = await screen.findByRole('dialog', { name: 'Counter' })
  expect(help).toHaveAttribute('aria-expanded', 'true')
  expect(panel).toHaveTextContent('The person who walked the aisle.')
  expect(panel).toHaveTextContent('Ravi counted aisle 4.')
  expect(panel).toHaveTextContent('Avoid: auditor (sounds like finance)')
  expect(within(panel).getByRole('link', { name: 'Open in the glossary' }).getAttribute('href')).toMatch(/^\/featherbase\/admin\/glossary#term-/)
  expect(counted).not.toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(help).toHaveFocus()
  await user.click(help)
  await screen.findByRole('dialog', { name: 'Counter' })
  await user.click(help)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
