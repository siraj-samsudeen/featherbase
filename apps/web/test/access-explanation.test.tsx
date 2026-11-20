// #628: "What can this person see, and why". The page lists a person's roles,
// the Tables they reach, the Data Scope rows that limit them and the rows
// shared with them, each with its reason, and never the data itself. It opens
// from the account menu and from a Person's row.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { rowHref } from 'shared'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 10_000 }
const pageOf = (person: string) => `/featherbase/account/access/${encodeURIComponent(person)}`
/** #1224: a reach-table row as its cells: Table, Read, Change[, Through]. */
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent?.trim())
const rowFor = (scope: HTMLElement, table: string) => within(scope).getAllByTestId('access-table-row').find((r) => cells(r)[0] === table)!

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Ax Site', title_column: 'site_name', columns: [{ column_name: 'site_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ax Site Reader' } })
  await grantRole(admin, { table: 'Ax Site', role: 'Ax Site Reader', can_read: true })
  const north = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent('Ax Site')}`, { site_name: 'North' })
  return { north }
}

test('#628 a System Manager sees a person\'s roles, Tables, limits and shares, each with its reason', async ({ admin, createUser }) => {
  const { north } = await seed(admin)
  const person = await createUser({ roles: ['Ax Site Reader'], fullName: 'Ax Person' })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: person.user, allow_table: 'Ax Site', for_value: north.row_id } })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Ax Site', share_name: north.row_id, person: person.user, read: true, write: true } })

  await renderApp(pageOf(person.user!), admin)
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What Ax Person can see'), WAIT)
  await waitFor(() => expect(screen.getAllByTestId('access-role').some((r) => /Ax Site Reader — given by Administrator, /.test(r.textContent ?? ''))).toBe(true), WAIT)
  // #1224: the summary says it in a sentence; the tables are one click away, by area.
  expect(screen.getByTestId('access-summary')).toHaveTextContent('They can read Ax Site.')
  await userEvent.click(screen.getByTestId('access-show-all'))
  expect(cells(rowFor(screen.getByTestId('access-reach-table'), 'Ax Site'))).toEqual(['Ax Site', '✓', '—', 'Ax Site Reader'])
  expect(screen.getByTestId('access-limit')).toHaveTextContent(/Ax Site: North — set by Administrator, /)
  expect(screen.getByTestId('access-share')).toHaveTextContent(/Ax Site: North \(can change\) — shared by Administrator, /)
  // #1006: someone else's page still speaks of them.
  expect(within(screen.getByTestId('access-tables')).getByRole('heading', { level: 2 })).toHaveTextContent('What they can do, in short')
  expect(within(screen.getByTestId('access-shares')).getByRole('heading', { level: 2 })).toHaveTextContent('Shared with them')
})

// #1006: the account pages keep the frame of the product the person came from.
test('#1006 someone who can use Admin reads the account pages in the Admin frame', async ({ admin }) => {
  await renderApp(pageOf('Administrator'), admin)
  expect(await screen.findByTestId('access-explanation', {}, WAIT)).toBeInTheDocument()
  expect(await screen.findByTestId('admin-sidebar', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('awesomebar')).toBeInTheDocument()
  expect(screen.queryByTestId('account-layout')).not.toBeInTheDocument()
})

test('#1006 someone who cannot use Admin keeps the plain top bar', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp(pageOf(me.user!), me)
  expect(await screen.findByTestId('access-explanation', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('account-layout')).toBeInTheDocument()
  expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
})

test('#628 the account menu opens your own page; an empty section says so', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp('/featherbase/account/sign-in-methods', me)
  await userEvent.click(await screen.findByTestId('session-user', {}, WAIT))
  await userEvent.click(within(await screen.findByTestId('account-menu')).getByRole('menuitem', { name: 'What You Can See' }))
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What You Can See'), WAIT)
  // #1224 spec item 8: an empty section is one muted line, not a card.
  expect(await screen.findByTestId('access-shares-empty', {}, WAIT)).toHaveTextContent('no rows are shared directly with you.')
  expect(screen.queryByTestId('access-shares')).toBeNull()
  expect(screen.getByTestId('access-roles-empty')).toHaveTextContent('No roles of your own')
  expect(within(screen.getByTestId('access-tables')).getByRole('heading', { level: 2 })).toHaveTextContent('What you can do, in short')
})

test('#628 a person limited to a row they cannot read sees its id, not its title', async ({ admin, createUser }) => {
  const { north } = await seed(admin)
  const me = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: me.user, allow_table: 'Ax Site', for_value: north.row_id } })
  await renderApp(pageOf(me.user!), me)
  expect(await screen.findByTestId('access-limit', {}, WAIT)).toHaveTextContent(`Ax Site: ${north.row_id} — set by`)
  expect(screen.getByTestId('access-explanation')).not.toHaveTextContent('North')
})

test('#628 a colleague\'s page is refused', async ({ createUser }) => {
  const person = await createUser({ roles: [] })
  const colleague = await createUser({ roles: [] })
  await renderApp(pageOf(person.user!), colleague)
  const refused = await screen.findByTestId('access-explanation-refused', {}, WAIT)
  expect(refused).toHaveTextContent("You can't open this page")
  expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent("Someone else's access")
  expect(screen.getByTestId('access-explanation')).not.toHaveTextContent('Unnamed person')
  // #1224 spec item 9: not a red error, and a way to their own page.
  expect(within(refused).getByRole('link', { name: 'See your own' }).getAttribute('href')).toBe(pageOf(colleague.user!))
  expect(refused.querySelector('[role="alert"]')).toBeNull()
  expect(screen.queryByTestId('access-roles')).not.toBeInTheDocument()
})

test('#628 a Person\'s row links to what they can see', async ({ admin, createUser }) => {
  const person = await createUser({ roles: [] })
  await renderApp(rowHref('Person', person.user!), admin)
  const link = await screen.findByRole('link', { name: 'What they can see' }, WAIT)
  expect(link).toHaveAttribute('href', pageOf(person.user!))
})

test('#628 an app that gives a person no places says so', async ({ admin, createUser }) => {
  expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/place-roster')])).toEqual([])
  await admin.post('/api/install_app', { name: 'placeroster' })
  const me = await createUser({ roles: [] })
  await renderApp(pageOf(me.user!), me)
  expect(await screen.findByTestId('access-places', {}, WAIT)).toHaveTextContent('Place roster proof gives you no places.')
  expect(screen.queryByTestId('access-place')).not.toBeInTheDocument()
})

test('#628 the places an app gives a person show with their reasons and days', async ({ admin, createUser }) => {
  expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/place-roster')])).toEqual([])
  await admin.post('/api/install_app', { name: 'placeroster' })
  const me = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${me.user}-n`, person: me.user, place: 'North / Kids', store: 'N1', section: 'kids' } })
  await admin.post('/api/save_row', { table: 'placeroster.position', row: {
    row_id: `${me.user}-s`, person: me.user, place: 'South / Mens', store: 'S1', section: 'mens', reason: 'Team Leader job assignment', since: '2026-08-06',
  } })
  await renderApp(pageOf(me.user!), me)
  const places = await screen.findAllByTestId('access-place', {}, WAIT)
  expect(places.map((li) => li.textContent)).toEqual([
    'North / Kids — no reason given by Place roster proof',
    'South / Mens — Team Leader job assignment from 06-Aug-2026',
  ])
  expect(screen.getByTestId('access-places')).toHaveTextContent('Places from Place roster proof')
})

test("#628 a System Manager's own page says they reach every Table", async ({ admin }) => {
  await renderApp(pageOf('Administrator'), admin)
  await screen.findByTestId('access-explanation', {}, WAIT)
  await waitFor(() => expect(screen.getByTestId('access-tables')).toHaveTextContent(/every Table/i), WAIT)
})

test('#628 a share that is read only, and may be shared on, says so', async ({ admin, createUser }) => {
  const { north } = await seed(admin)
  const person = await createUser({ roles: [], fullName: 'Ax Sharer' })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Ax Site', share_name: north.row_id, person: person.user, read: true, share: true } })
  await renderApp(pageOf(person.user!), admin)
  expect(await screen.findByTestId('access-share', {}, WAIT)).toHaveTextContent(/Ax Site: North \(read only, can share on\)/)
})

test('#628 the page for someone who is not a person says there is no such person', async ({ admin }) => {
  await renderApp(pageOf('psn_nobodyhereatallnobodyx'), admin)
  expect(await screen.findByText('There is no such person.', {}, WAIT)).toBeInTheDocument()
})

test('#1224 the page shows as a summary, by role or by area, and remembers the choice', async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Ax Brand', module: 'Merchandising', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Ax Brand', role: 'Ax Brand Editor', can_read: true, can_write: true })
  const person = await createUser({ roles: ['Ax Site Reader', 'Ax Brand Editor'], fullName: 'Ax Layouts' })
  localStorage.removeItem('featherbase.access-layout')

  await renderApp(pageOf(person.user!), admin)
  const summary = await screen.findByTestId('access-summary', {}, WAIT)
  expect(summary).toHaveTextContent('They can read and change Ax Brand in Merchandising.')
  expect(summary).toHaveTextContent('No limits are set on their rows.')
  expect(summary).not.toHaveTextContent('stay private')
  expect(summary).not.toHaveTextContent('every row')

  await userEvent.click(screen.getByRole('button', { name: 'By role' }))
  const cards = await screen.findAllByTestId('access-role-card')
  expect(cards.map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(expect.arrayContaining(['Ax Site Reader', 'Ax Brand Editor']))
  expect(localStorage.getItem('featherbase.access-layout')).toBe('roles')

  await userEvent.click(screen.getByRole('button', { name: 'By area' }))
  const areas = within(await screen.findByTestId('access-by-area')).getAllByTestId('access-area-group')
  expect(areas.map((a) => a.querySelector('th')?.textContent)).toEqual([
    expect.stringMatching(/^General · \d+ tables? · read only/), 'Merchandising · 1 table · change all',
  ])
  localStorage.removeItem('featherbase.access-layout')
})

test('#1224 who gave a role is named even when the viewer may not read Person', async ({ admin, createUser }) => {
  await grantRole(admin, { table: [], role: 'Ax Given Role' })
  const giver = await createUser({ roles: ['System Manager'], fullName: 'Ax Giver Name' })
  const viewer = await createUser({ roles: [] })
  const doc = await admin.get<{ updated_at: string; roles: { role: string }[] }>(`/api/table/Person/${viewer.user}`)
  await giver.post('/api/save_row', { table: 'Person', row: { row_id: viewer.user, updated_at: doc.updated_at, roles: [...doc.roles, { role: 'Ax Given Role' }] } })

  await renderApp(pageOf(viewer.user!), viewer)
  await waitFor(() => expect(screen.getAllByTestId('access-role').some((r) => /Ax Given Role — given by Ax Giver Name, /.test(r.textContent ?? ''))).toBe(true), WAIT)
  expect(screen.getByTestId('access-explanation')).not.toHaveTextContent('Unnamed person')
})

test('#1224 a role card says only what that role gives; own-rows reach is per operation and narrows the summary', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ax Order', module: 'Sales', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Ax Order', role: 'Ax Order Reader', can_read: true })
  await grantRole(admin, { table: 'Ax Order', role: 'Ax Order Writer', can_write: true, own_rows_only: true })
  const person = await createUser({ roles: ['Ax Order Reader', 'Ax Order Writer'] })
  localStorage.removeItem('featherbase.access-layout')

  await renderApp(pageOf(person.user!), admin)
  const summary = await screen.findByTestId('access-summary', {}, WAIT)
  // Reader reads every row; only changing is limited to their own (Codex round 9).
  expect(summary).toHaveTextContent('Their access is narrowed: in 1 table they can change only rows they created.')
  expect(summary).not.toHaveTextContent('shows only rows')
  expect(summary).not.toHaveTextContent('every row')

  await userEvent.click(screen.getByRole('button', { name: 'By role' }))
  const card = (await screen.findAllByTestId('access-role-card')).find((c) => within(c).getByRole('heading').textContent === 'Ax Order Reader')!
  expect(card).toHaveTextContent('They can read Ax Order in Sales.')
  // Reader reads every row; the change (own rows only) is Writer's, not Reader's.
  expect(cells(rowFor(card, 'Ax Order'))).toEqual(['Ax Order', '✓', '—'])
  const writer = (await screen.findAllByTestId('access-role-card')).find((c) => within(c).getByRole('heading').textContent === 'Ax Order Writer')!
  expect(cells(rowFor(writer, 'Ax Order'))).toEqual(['Ax Order', '—', 'own rows only'])
  localStorage.removeItem('featherbase.access-layout')
})

test('#1224 a table reached only through what every account holds is explained in every layout', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ax Notice', module: 'Notices', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Ax Notice', role: 'All', can_read: true })
  const person = await createUser({ roles: [] })
  localStorage.removeItem('featherbase.access-layout')

  await renderApp(pageOf(person.user!), admin)
  const summary = await screen.findByTestId('access-summary', {}, WAIT)
  expect(summary).toHaveTextContent('Open to every signed-in account')
  await userEvent.click(screen.getByRole('button', { name: 'By role' }))
  const card = (await screen.findAllByTestId('access-role-card')).find((c) => within(c).getByRole('heading').textContent === 'Every account')!
  expect(card).toHaveTextContent('Every signed-in account has these')
  // Spec item 7: what every account reaches folds into one line per area, opened on demand.
  const notices = within(card).getAllByTestId('access-area-group').find((g) => g.querySelector('th')?.textContent?.startsWith('Notices'))!
  expect(within(notices).getByTestId('access-every-account-line')).toHaveTextContent('Every account can read 1 table here —')
  expect(within(notices).queryAllByTestId('access-table-row')).toEqual([])
  await userEvent.click(within(notices).getByRole('button', { name: 'Show' }))
  expect(cells(rowFor(notices, 'Ax Notice'))).toEqual(['Ax Notice', '✓', '—'])
  localStorage.removeItem('featherbase.access-layout')
})

test('#1224 a role card keeps its own row scope when another role reads every row', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ax Ledger', module: 'Finance', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Ax Ledger', role: 'Ax Own Reader', can_read: true, own_rows_only: true })
  await grantRole(admin, { table: 'Ax Ledger', role: 'Ax Full Reader', can_read: true })
  const person = await createUser({ roles: ['Ax Own Reader', 'Ax Full Reader'] })
  localStorage.setItem('featherbase.access-layout', 'roles')
  await renderApp(pageOf(person.user!), admin)
  const cards = await screen.findAllByTestId('access-role-card', {}, WAIT)
  const rowOf = (role: string) => cells(rowFor(cards.find((c) => within(c).getByRole('heading').textContent === role)!, 'Ax Ledger'))
  expect(rowOf('Ax Own Reader')).toEqual(['Ax Ledger', 'own rows only', '—'])
  expect(rowOf('Ax Full Reader')).toEqual(['Ax Ledger', '✓', '—'])
  localStorage.removeItem('featherbase.access-layout')
})

test('#1224 a System Manager\'s page keeps who gave each role, in the summary and by role', async ({ admin, createUser }) => {
  const manager = await createUser({ roles: ['System Manager'] })
  localStorage.removeItem('featherbase.access-layout')
  await renderApp(pageOf(manager.user!), admin)
  await waitFor(() => expect(screen.getAllByTestId('access-role').map((r) => r.textContent)).toContainEqual(expect.stringMatching(/^System Manager — given by Administrator, /)), WAIT)
  expect(screen.getByTestId('access-summary')).not.toHaveTextContent('reach no tables')
  await userEvent.click(screen.getByRole('button', { name: 'By role' }))
  const card = (await screen.findAllByTestId('access-role-card')).find((c) => within(c).getByRole('heading').textContent === 'System Manager')!
  expect(card).toHaveTextContent(/Given by Administrator, .*can read and change every table/)
  localStorage.removeItem('featherbase.access-layout')
})

test('#1224 each role, table and giver links to its record when the viewer may open it; plain text otherwise', async ({ admin, createUser }) => {
  await seed(admin)
  const person = await createUser({ roles: ['Ax Site Reader'], fullName: 'Ax Linked' })
  localStorage.removeItem('featherbase.access-layout')
  await renderApp(pageOf(person.user!), admin)
  await screen.findByTestId('access-summary', {}, WAIT)
  const links = () => [...document.querySelectorAll<HTMLElement>('[data-record-link="link"]')].map((a) => [a.textContent, a.getAttribute('href')])
  await waitFor(() => expect(links()).toContainEqual(['Ax Site Reader', '/featherbase/admin/table/role/row/Ax%20Site%20Reader']), WAIT)
  expect(links()).toContainEqual(['Administrator', '/featherbase/admin/table/person/row/Administrator'])
  await userEvent.click(screen.getByTestId('access-show-all'))
  expect(links().some(([text, href]) => text === 'Ax Site' && href?.startsWith('/featherbase/admin/table/'))).toBe(true)
})

test('#1224 a person who cannot open roles or people sees them as plain text', async ({ admin, createUser }) => {
  await seed(admin)
  const person = await createUser({ roles: ['Ax Site Reader'] })
  localStorage.removeItem('featherbase.access-layout')
  await renderApp(pageOf(person.user!), person)
  await waitFor(() => expect(screen.getAllByTestId('access-role').some((r) => r.textContent?.includes('Ax Site Reader'))).toBe(true), WAIT)
  const texts = [...document.querySelectorAll<HTMLElement>('[data-record-link="link"]')].map((a) => a.textContent)
  expect(texts).not.toContain('Ax Site Reader')
  expect(texts).not.toContain('Administrator')
})

test('#1224 someone else\'s page names them in the title as a link, and the summary says which apps they can open', async ({ admin, createUser }) => {
  const person = await createUser({ roles: [], fullName: 'Ax Title Person' })
  localStorage.removeItem('featherbase.access-layout')
  await renderApp(pageOf(person.user!), admin)
  const heading = await screen.findByTestId('access-explanation-heading', {}, WAIT)
  await waitFor(() => expect(within(heading).getByRole('link', { name: 'Ax Title Person' }).getAttribute('href')).toBe(`/featherbase/admin/table/person/row/${person.user}`), WAIT)
  expect(heading.textContent).not.toContain('psn_')
  expect(screen.getByTestId('access-at-a-glance')).toHaveTextContent('They can open')
})
