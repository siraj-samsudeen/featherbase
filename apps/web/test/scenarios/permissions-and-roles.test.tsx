// permissions-and-roles' fenced scenarios (#1070), rendered in jsdom against
// the real in-process server. Each test is one scenario of
// openspec/specs/permissions-and-roles/spec.md, step by step.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { resolve } from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { rowHref } from 'shared'
import { sql } from 'server/src/db'
import { setUserPassword } from 'server/src/auth'
import { discoverPackages } from 'server/src/runtime-packages'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, renderSession, byTestId, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'permissions-and-roles')

const QUOTES = 'Grant Quote'
const ROLE = 'Grant Quote Title Editor'
const QUOTE = { row_id: 'Q-1', quote_title: 'Steel shelf', unit_cost: 120 }
const DASH_STAND_IN = resolve('../..', 'test-apps/fixtures/dash-stand-in')

type Admin = Parameters<typeof renderApp>[1]

/** Every URL the page asks the server for, from now on. */
function recordCalls(): string[] {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url)
    return real(input, init)
  })
  return urls
}

/** The Roles and Tables the shell scenarios share: a clerk who reads only Shelf Note. */
async function seedShelf(admin: Admin) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await grantRole(admin, { table: 'Shelf Note', role: 'Shelf Clerk', can_read: true })
}

const pathOf = (router: unknown) => (router as { state: { location: { pathname: string } } }).state.location.pathname

describe('permissions-and-roles', () => {
  scenario('A detail that may be read but not changed', async ({ admin, createUser, seed }, step) => {
    let person: TestClient
    let session!: Session
    await step("a role may read a quote's title and unit cost but may change only its title", async () => {
      await admin.post('/api/table_def', {
        name: QUOTES,
        columns: [
          { column_name: 'quote_title', label: 'Title', column_type: 'Data', in_list_view: true },
          { column_name: 'unit_cost', label: 'Unit cost', column_type: 'Float' },
        ],
      })
      await admin.post(`/api/table/${encodeURIComponent(QUOTES)}`, QUOTE)
      await seed('Role', { row_id: ROLE })
      const meta = await admin.get<{ columns: { column_name: string; row_id: string }[] }>(`/api/table/Table/${encodeURIComponent(QUOTES)}`)
      const title = meta.columns.find((column) => column.column_name === 'quote_title')!
      await seed('Permission', { ref_table: QUOTES, role: ROLE, operation: 'read' })
      await seed('Permission', { ref_table: QUOTES, role: ROLE, operation: 'update', column_rule: 'listed', columns: [{ target_column: title.row_id }] })
    })
    await step('the user holds that role', async () => {
      person = await createUser({ roles: [ROLE] })
    })
    await step('the user changes the title and the unit cost of the quote "Q-1" and saves', async () => {
      ;({ session } = await renderSession('/featherbase/admin/table/grant-quote/row/Q-1', person))
      await session
        .assertValue('Title', 'Steel shelf')
        .fillIn('Title', 'Steel shelf, two bays')
        .fillIn('Unit cost', 95)
        .clickButton('Save')
    })
    await step('the save is refused', () =>
      session.within(byTestId('form-banner'), (banner) => banner.assertText('permission').refuteText('Saved')))
    await step('the quote "Q-1" keeps its old title and unit cost', async () => {
      const stored = await admin.get<{ quote_title: string; unit_cost: number }>(`/api/table/${encodeURIComponent(QUOTES)}/Q-1`)
      expect(stored.quote_title).toBe(QUOTE.quote_title)
      expect(Number(stored.unit_cost)).toBe(QUOTE.unit_cost)
    })
  })
  scenario('Refused list', async ({ admin, createUser }, step) => {
    let clerk!: TestClient
    await step('a table "Back Office"', async () => {
      await seedShelf(admin)
    })
    await step(`the user's roles grant no read on "Back Office"`, async () => {
      clerk = await createUser({ email: 'clerk.refused@example.com', roles: ['Shelf Clerk'] })
    })
    await step('the user opens the list of "Back Office"', async () => {
      await renderApp('/featherbase/admin/table/back-office', clerk)
    })
    await step("the user sees a message that they can't read it", async () => {
      const refusal = await screen.findByRole('alert', {}, { timeout: 10_000 })
      expect(refusal).toHaveTextContent(/don't have read permission on Back Office/i)
    })
    await step('the user does not see an empty list', () => {
      expect(screen.queryByText('No rows')).not.toBeInTheDocument()
    })
  })

  scenario('A report-only person never meets the administration menu', async ({ admin, createUser }, step) => {
    let tl!: TestClient
    let urls: string[] = []
    let router: unknown
    await step('the user holds only the Sales Target Viewer role', async () => {
      await seedShelf(admin)
      tl = await createUser({ email: 'tl@example.com', roles: [VIEWER_ROLE] })
    })
    await step('the user opens an administration address', async () => {
      urls = recordCalls()
      ;({ router } = await renderApp('/featherbase/admin/home/home', tl))
      await screen.findByTestId('identity')
    })
    await step('the user is taken to the Sales Target report', async () => {
      await waitFor(() => expect(pathOf(router)).toMatch(/sales-target/))
      expect(screen.getByTestId('identity')).toBeInTheDocument()
    })
    await step('no administration menu appears', () => {
      for (const id of ['new-table-link', 'import-data-link', 'past-imports-link', 'all-tables-link', 'admin-sidebar'])
        expect(screen.queryByTestId(id), id).not.toBeInTheDocument()
    })
    await step('no administration request is made', () => {
      // /api/brand is the shared top bar asking what this address opens (#489).
      const adminCalls = urls.filter((u) => !/^\/api\/(whoami|brand|runtime_app_versions|sales_target\/)/.test(u))
      expect(adminCalls).toEqual([])
    })
  })

  scenario('A person with no access is told so', async ({ createUser }, step) => {
    let nobody!: TestClient
    let page!: HTMLElement
    await step('the user holds no role of use', async () => {
      nobody = await createUser({ email: 'nobody@example.com', roles: [] })
    })
    await step('the user signs in', async () => {
      await renderApp('/featherbase/admin', nobody)
      page = await screen.findByTestId('no-access')
    })
    await step('the user sees that they have no access yet', async () => {
      await waitFor(() => expect(page).toHaveTextContent("You don't have access to Featherbase yet"))
    })
    await step('the user sees that an admin has been told', () => {
      expect(page).toHaveTextContent('An admin has been told')
    })
    await step('the user sees a way to sign out', async () => {
      // #489: signing out is in the shared top bar's Account menu.
      await userEvent.click(await screen.findByTestId('session-user'))
      expect(screen.getByTestId('logout')).toBeVisible()
    })
  })

  scenario('A management address typed by someone else', async ({ admin, createUser }, step) => {
    let clerk!: TestClient
    let router: unknown
    await step('the user is not a System Manager', async () => {
      await seedShelf(admin)
      clerk = await createUser({ email: 'clerk-route@example.com', roles: ['Shelf Clerk'] })
    })
    await step('the user types the address for importing data', async () => {
      ;({ router } = await renderApp('/featherbase/admin/import', clerk))
    })
    await step('the user lands on the administration home', async () => {
      await screen.findByTestId('admin-sidebar')
      await waitFor(() => expect(pathOf(router)).toBe('/featherbase/admin'))
    })
  })

  scenario('Signing in is still recorded', async ({ createUser, api }, step) => {
    const PASSWORD = 'signed-in-pw-12345'
    let manager!: TestClient
    let token = ''
    let rowId = ''
    let before = 0
    await step('the user is a System Manager', async () => {
      manager = await createUser({ email: 'signin.recorded@example.com', roles: ['System Manager'] })
      await setUserPassword(manager.user!, PASSWORD)
    })
    await step('the user signs in', async () => {
      before = (await sql`select count(*)::int as n from activity_log where "user" = ${manager.user!} and operation = 'login'`)[0].n
      const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'signin.recorded@example.com', pwd: PASSWORD }) })
      expect(res.status).toBe(200)
      token = ((await res.json()) as { token: string }).token
    })
    await step('the sign-in appears in the activity record', async () => {
      const rows = await sql`select row_id from activity_log where "user" = ${manager.user!} and operation = 'login' order by created_at desc`
      expect(rows).toHaveLength(before + 1)
      rowId = String(rows[0].row_id)
    })
    await step('the user can read it there', async () => {
      await renderApp(`/featherbase/admin/table/activity-log/row/${rowId}`, { token, user: manager.user } as TestClient)
      const form = await screen.findByTestId('form-view')
      await waitFor(() => expect(form).toHaveTextContent('login'))
    })
    await step('the user sees no way to edit or delete it', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Record actions' }))
      for (const control of ['form-save', 'form-delete', 'form-rename']) expect(screen.queryByTestId(control), control).toBeNull()
    })
  })

  scenario('A store manager who only uses Dash', async ({ admin, createUser }, step) => {
    expect(await discoverPackages([DASH_STAND_IN])).toEqual([])
    try {
      let manager!: TestClient
      let who!: { apps: { name: string }[]; capabilities: { admin: boolean } }
      await step("a store manager whose only grant is to read Dash's own tables", async () => {
        await admin.post('/api/install_app', { name: 'dash' })
        await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Dash Reader' } })
        await grantRole(admin, { table: 'dash.note', role: 'Dash Reader', can_read: true })
        manager = await createUser({ email: 'dash.reader.shell@example.com', roles: ['Dash Reader'] })
      })
      await step('the user opens Dash', async () => {
        who = await manager.get('/api/whoami')
      })
      await step('Dash opens', () => {
        expect(who.apps.map((app) => app.name)).toContain('dash')
      })
      await step('nothing offers the user the administration', async () => {
        expect(who.capabilities.admin).toBe(false)
        const { unmount } = await renderApp('/featherbase/admin', manager)
        await screen.findByTestId('going-to-app')
        expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
        unmount()
      })
      await step('the user types an administration address', async () => {
        await renderApp('/featherbase/admin', manager)
      })
      await step('the user is sent to Dash', async () => {
        const going = await screen.findByTestId('going-to-app')
        const asked = await sql`select count(*)::int as n from access_request where person = ${manager.user!}`
        expect([going.getAttribute('data-path'), screen.queryByTestId('no-access'), asked[0].n]).toEqual(['/dash/', null, 0])
      })
    } finally {
      await discoverPackages([])
    }
  })

  scenario('A person created with a role shows it in Activity', async ({ admin }, step) => {
    let person!: { row_id: string }
    await step('the user is an administrator', async () => {
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Rh Clerk' } })
    })
    await step('the user creates a person with the role "Rh Clerk"', async () => {
      person = await admin.post('/api/save_row', {
        table: 'Person',
        row: { enabled: true, email: 'rh.created@example.com', full_name: 'Rh Created', roles: [{ role: 'Rh Clerk' }] },
      })
      await renderApp(rowHref('Person', person.row_id), admin)
      await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
    })
    await step("the person's Activity shows the user created them", async () => {
      const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
      await waitFor(() => expect(within(timeline).getAllByTestId('activity-version')[0]).toHaveTextContent(/Administrator created/))
    })
    await step('it shows "Roles: ∅ → Rh Clerk"', async () => {
      const timeline = screen.getByTestId('activity-timeline')
      await waitFor(() => {
        const diffs = within(timeline).getAllByTestId('activity-diff').map((d) => d.textContent)
        expect(diffs).toContainEqual(expect.stringContaining('Roles: ∅ → Rh Clerk'))
      })
    })
  })

  scenario("A person's pages say where the role comes from", async ({ admin, createUser }, step) => {
    let person!: TestClient
    let manager!: TestClient
    await step('System Settings gives "Tasker Member" to everyone who signs in', async () => {
      const [have] = await sql`select 1 from role where row_id = 'Tasker Member'`
      if (!have) await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Tasker Member' } })
      await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Tasker Member' } })
    })
    await step('a person holds Tasker Member only through the setting', async () => {
      person = await createUser({ roles: [], fullName: 'Ew Person' })
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step("a System Manager opens the person's access page", async () => {
      await renderApp(`/featherbase/account/access/${encodeURIComponent(person.user!)}`, manager)
    })
    await step('it says "everyone who signs in holds it (System Settings)"', async () => {
      const role = await screen.findByTestId('access-role', {}, { timeout: 10_000 })
      expect(role).toHaveTextContent('Tasker Member — everyone who signs in holds it (System Settings)')
    })
    await step("a System Manager opens the person's Person form", async () => {
      cleanup()
      await renderApp(rowHref('Person', person.user!), manager)
    })
    await step('it says "Everyone who signs in also holds Tasker Member, set in System Settings."', async () => {
      await waitFor(() => expect(screen.getByTestId('everyone-roles-note'))
        .toHaveTextContent('Everyone who signs in also holds Tasker Member, set in System Settings.'), { timeout: 10_000 })
    })
  })
})
