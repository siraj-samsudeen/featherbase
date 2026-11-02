// Paths the merged web coverage report (ADR 0012) showed red in the router and
// two forms: /featherbase sending a visitor on, the Admin home for someone who
// sees no Home Page, a new row opened with prefilled values (and an address
// whose prefill is not an object), a yes/no on a public web form, and a yes/no
// in an embedded list. Real server throughout.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
type Router = { state: { location: { pathname: string } } }
const enc = encodeURIComponent
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

test('/featherbase sends a signed-out visitor to sign in, and a signed-in one to their landing', async ({ admin }) => {
  const out = await renderApp('/featherbase', anonymous)
  await waitFor(() => expect((out.router as Router).state.location.pathname).toBe('/featherbase/login'))
  out.unmount()
  const signedIn = await renderApp('/featherbase', admin)
  await waitFor(() => expect((signedIn.router as Router).state.location.pathname).toMatch(/^\/featherbase\/admin/))
})

for (const path of [
  '/featherbase/portal/Orders',
  '/featherbase/portal/Orders/one',
  '/featherbase/print/Orders/one',
  '/featherbase/account/sign-in-methods',
]) {
  test(`signed-out deep link ${path} keeps its destination through the login guard`, async () => {
    const { router } = await renderApp(path, anonymous)
    await screen.findByTestId('login-form')
    const location = (router as { state: { location: { pathname: string; search: { next?: string } } } }).state.location
    expect(location.pathname).toBe('/featherbase/login')
    expect(location.search.next).toBe(path)
  })
}

test('someone with a Table but no Home Page is pointed at All tables', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Rfg Note', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Rfg Clerk' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Rfg Note', role: 'Rfg Clerk', can_read: true } })
  await sql`delete from home_page`
  const clerk = await createUser({ roles: ['Rfg Clerk'] })
  await renderApp('/featherbase/admin', clerk)
  const empty = await screen.findByTestId('admin-index-empty', {}, { timeout: 8000 })
  expect(empty).toHaveTextContent('No Home Pages are visible to you.')
  expect(within(empty).getByRole('link', { name: 'All tables' })).toHaveAttribute('href', '/featherbase/admin/all-tables')
})

async function noteTable(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Rfg Visit',
    columns: [
      { column_name: 'store', column_type: 'Data', label: 'Store' },
      { column_name: 'done', column_type: 'Check', label: 'Done', in_list_view: true },
    ],
  })
}

test('a new row opened with prefilled values starts with them; a prefill that is not an object is ignored', async ({ admin }) => {
  await noteTable(admin)
  // The router writes the search value as JSON, so the prefill string is quoted once more.
  const prefill = (v: unknown) => enc(JSON.stringify(JSON.stringify(v)))
  const first = await renderApp(`/featherbase/admin/${enc('Rfg Visit')}/new?prefill=${prefill({ store: 'ATK' })}`, admin)
  await waitFor(() => expect(field('store')).toHaveValue('ATK'), { timeout: 8000 })
  first.unmount()
  await renderApp(`/featherbase/admin/${enc('Rfg Visit')}/new?prefill=${prefill(['ATK'])}`, admin)
  await waitFor(() => expect(field('store')).toBeInTheDocument(), { timeout: 8000 })
  expect(field('store')).toHaveValue('')
})

test('a public web form takes a yes/no', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Rfg Signup',
    columns: [
      { column_name: 'full_name', label: 'Full name', column_type: 'Data', reqd: true },
      { column_name: 'newsletter', label: 'Newsletter', column_type: 'Check' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Web Form',
    row: { row_id: 'rfg-signup', title: 'Sign up', route: 'rfg-signup', ref_table: 'Rfg Signup', published: true, success_message: 'Done.', web_fields: ['full_name', 'newsletter'] },
  })
  await renderApp('/featherbase/form/rfg-signup', anonymous)
  await userEvent.type(await screen.findByLabelText(/Full name/), 'Ada')
  const box = screen.getByLabelText('Newsletter')
  await userEvent.click(box)
  expect(box).toBeChecked()
  await userEvent.click(box)
  await userEvent.click(box)
  await userEvent.click(screen.getByTestId('web-form-submit'))
  expect(await screen.findByTestId('web-form-success')).toHaveTextContent('Done.')
  const [row] = await sql`select full_name, newsletter from featherbase.rfg_signup`
  expect(row).toMatchObject({ full_name: 'Ada', newsletter: true })
})

test('a yes/no in an embedded list reads ✓ or ✗', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Rfg Store', columns: [{ column_name: 'label', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/table_def', {
    name: 'Rfg Audit',
    columns: [
      { column_name: 'store', column_type: 'Reference', reference_table: 'Rfg Store', label: 'Store' },
      { column_name: 'passed', column_type: 'Check', label: 'Passed', in_list_view: true },
    ],
  })
  const store = (await admin.post('/api/save_row', { table: 'Rfg Store', row: { label: 'ATK' } })) as { row_id: string }
  await admin.post('/api/save_row', { table: 'Rfg Audit', row: { store: store.row_id, passed: true } })
  await admin.post('/api/save_row', { table: 'Rfg Audit', row: { store: store.row_id, passed: false } })
  await renderApp(`/featherbase/admin/${enc('Rfg Store')}/${store.row_id}`, admin)
  await userEvent.click(await screen.findByTestId('related-tab-Rfg Audit', {}, { timeout: 10_000 }))
  const embedded = await screen.findByTestId('embedded-list')
  await waitFor(() => expect(embedded.querySelectorAll('tbody tr')).toHaveLength(2))
  expect([...embedded.querySelectorAll('tbody tr')].map((r) => r.textContent).join(' ')).toMatch(/✓[\s\S]*✗|✗[\s\S]*✓/)
})
