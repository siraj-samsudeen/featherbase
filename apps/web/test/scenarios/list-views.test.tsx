// #1259: list-view's and saved-views' fenced scenarios for a list's three
// views (openspec/changes/list-views-switch), each run step by step in jsdom
// against the in-process server.
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { tableSlug } from 'shared'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const scenario = scenarioFor(test, 'list-view')

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
const panel = () => screen.findByTestId('record-panel')
const rowOf = (person: string) => [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((r) => r.textContent?.includes(person))!

describe('list-view', () => {
  scenario('Reading a record beside the list', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('the user opens the Job Assignment list', async () => {
      await seed(admin, JOBS)
      user = await reader(admin, createUser as CreateUser, JOBS, 'beside@example.com')
      await openList(user, JOBS)
    })
    await step("the user switches it to List And Record and chooses Anitha's card", async () => {
      await userEvent.click(switcher().getByRole('button', { name: 'List And Record' }))
      const card = (await screen.findAllByTestId('record-card')).find((c) => c.textContent?.includes('Anitha'))!
      await userEvent.click(within(card).getAllByRole('button')[0])
    })
    await step("Anitha's record shows beside the cards", async () => {
      await waitFor(async () => expect(await panel()).toHaveAccessibleName('Anitha'))
      expect(within(screen.getByTestId('list-split')).getByTestId('record-panel')).toBeInTheDocument()
    })
    await step('the cards stay where they were', () => {
      expect(screen.getAllByTestId('record-card').map((c) => c.textContent?.match(/Anitha|Bala|Chitra/)?.[0])).toEqual(expect.arrayContaining(PEOPLE))
      expect(within(screen.getAllByTestId('record-card').find((c) => c.textContent?.includes('Anitha'))!).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'true')
    })
  })

  scenario('The panel over the table', async ({ admin, createUser }, step) => {
    let marked = ''
    await step('the user opens the Job Assignment list in Table With Panel', async () => {
      await seed(admin, JOBS)
      const user = await reader(admin, createUser as CreateUser, JOBS, 'over@example.com')
      await openList(user, JOBS)
      expect(pressed()).toEqual(['Table With Panel'])
    })
    await step("the user chooses Anitha's row and presses the down arrow", async () => {
      const row = rowOf('Anitha')
      row.focus()
      fireEvent.keyDown(row, { key: 'Enter' })
      await waitFor(async () => expect(await panel()).toHaveAccessibleName('Anitha'))
      const rows = [...document.querySelectorAll<HTMLElement>('[data-row-id]')]
      marked = rows[rows.indexOf(rowOf('Anitha')) + 1].getAttribute('data-row-id')!
      fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    })
    await step("the next row's record shows in the panel", async () => {
      const next = document.querySelector(`[data-row-id="${marked}"]`)!.textContent!.match(/Anitha|Bala|Chitra/)![0]
      await waitFor(() => expect(screen.getByTestId('record-panel')).toHaveAccessibleName(next))
      expect(within(screen.getByTestId('record-panel-over')).getByTestId('record-panel')).toBeInTheDocument()
    })
    await step('pressing Escape closes the panel with that row still marked', async () => {
      fireEvent.keyDown(screen.getByTestId('record-panel'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument())
      await waitFor(() => expect(document.activeElement?.getAttribute('data-row-id')).toBe(marked))
    })
  })

  scenario('Back to the same view', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('the user switched the Department list to List And Record', async () => {
      await seed(admin, 'Department')
      user = await reader(admin, createUser as CreateUser, 'Department', 'again@example.com')
      await openList(user, 'Department')
      await userEvent.click(switcher().getByRole('button', { name: 'List And Record' }))
      await waitFor(async () => expect(((await user.get('/api/user_settings/Department')) as { settings: { layout?: string } }).settings?.layout).toBe('split'))
    })
    await step('the user signs out, signs back in and reopens that list', async () => {
      cleanup()
      await openList(user, 'Department')
    })
    await step('it opens in List And Record', () => waitFor(() => expect(pressed()).toEqual(['List And Record'])))
  })

  scenario('A queue opens on its cards', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('a Table is marked as a queue and the user has never chosen a view for it', async () => {
      await seed(admin, 'Requests', true)
      user = await reader(admin, createUser as CreateUser, 'Requests', 'queue@example.com')
    })
    await step('the user opens its list', () => openList(user, 'Requests'))
    await step('it opens in List And Record', async () => {
      await waitFor(() => expect(pressed()).toEqual(['List And Record']))
      expect(screen.getByTestId('list-split')).toBeInTheDocument()
    })
  })

  scenario('A pasted link opens the record beside its list', async ({ admin, createUser }, step) => {
    let address = ''
    await step("the user copies the address while Anitha's record is open beside the Job Assignment list", async () => {
      await seed(admin, JOBS)
      const user = await reader(admin, createUser as CreateUser, JOBS, 'copier@example.com')
      const view = await openList(user, JOBS)
      const row = rowOf('Anitha')
      row.focus()
      fireEvent.keyDown(row, { key: 'Enter' })
      await waitFor(async () => expect(await panel()).toHaveAccessibleName('Anitha'))
      address = (view.router.state as { location: { href: string } }).location.href
      cleanup()
    })
    await step('a colleague who can read Job Assignment opens that address', async () => {
      const colleague = await reader(admin, createUser as CreateUser, JOBS, 'colleague@example.com')
      await renderApp(address, colleague)
    })
    await step("they see the Job Assignment list with Anitha's record open", async () => {
      expect(await screen.findByTestId('list-view')).toBeInTheDocument()
      await waitFor(async () => expect(await panel()).toHaveAccessibleName('Anitha'))
    })
  })
})
