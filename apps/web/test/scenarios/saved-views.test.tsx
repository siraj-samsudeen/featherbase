// #1259: saved-views' fenced scenario for a view's own list view
// (openspec/changes/list-views-switch), run step by step in jsdom.
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { tableSlug } from 'shared'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const scenario = scenarioFor(test, 'saved-views')

const JOBS = 'Job Assignment'
// Anitha in the middle, whichever way the list is sorted.
const PEOPLE = ['Chitra', 'Anitha', 'Bala']

/** A Table whose rows are named for people, readable by a reader role. */
async function seed(admin: Client, name: string, queue = false) {
  await admin.post('/api/table_def', {
    name, title_column: 'person', ...(queue ? { queue: true } : {}),
    columns: [
      { column_name: 'person', column_type: 'Data', label: 'Person', in_list_view: true },
      { column_name: 'role_name', column_type: 'Data', label: 'Role', in_list_view: true },
    ],
  })
  for (const person of PEOPLE) await admin.post('/api/save_row', { table: name, row: { person, role_name: 'Cashier' } })
  await grantRole(admin, { role: `${name} Reader`, table: name, can_read: true })
}

async function reader(admin: Client, createUser: CreateUser, name: string, email: string) {
  return createUser({ email, roles: [`${name} Reader`] })
}

async function openList(as: Client, name: string, query = '') {
  const view = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(name))}${query}`, as)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(screen.getByTestId('list-view')).toHaveTextContent('Anitha'))
  return view
}

const switcher = () => within(screen.getByTestId('layout-switch'))
const pressed = () => switcher().getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))

describe('saved-views', () => {
  scenario('A queue view opens as cards', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('the user saved "My Open Requests" while reading the list as List And Record', async () => {
      await seed(admin, JOBS)
      user = await reader(admin, createUser as CreateUser, JOBS, 'saver@example.com')
      await user.post('/api/saved_views', { table: JOBS, label: 'My Open Requests', filters: [['role_name', '=', 'Cashier']], layout: 'split' })
    })
    await step('has since switched that Table to Table', async () => {
      await user.put(`/api/user_settings/${encodeURIComponent(JOBS)}`, { layout: 'table' })
      await openList(user, JOBS)
      await waitFor(() => expect(pressed()).toEqual(['Table']))
    })
    await step('the user opens "My Open Requests"', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'My Open Requests' }))
    })
    await step("the list shows as List And Record with the view's filters", async () => {
      await waitFor(() => expect(pressed()).toEqual(['List And Record']))
      expect(await screen.findAllByTestId('filter-chip')).toHaveLength(1)
    })
  })
})
