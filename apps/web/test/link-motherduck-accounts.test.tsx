// #1396: MotherDuck Accounts › Link to people, as a System Manager works through it:
// accounts still to link, each with the people its username reads as; one click links,
// Undo takes it back, and Close their tickets now queues the sync.
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { makePerson } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

const PAGE = '/featherbase/admin/link-motherduck-accounts'

async function accounts() {
  const priya = await makePerson({ full_name: 'Priya Raman' })
  const priyanka = await makePerson({ full_name: 'Priyanka S' })
  const done = await makePerson({ full_name: 'Done Person' })
  await sql`insert into motherduck_account (row_id, username, full_name, email, account_status, service_account, review_ticket, person) values
    ('md-priya', 'priya', 'Priya R', 'priya@elsewhere.example', 'Active', false, 'FT-1396A', null),
    ('md-zed', 'zed_nobody', null, 'zed@elsewhere.example', 'Deprovisioned', false, 'FT-1396B', null),
    ('md-done', 'done_one', null, null, 'Active', false, null, ${done}),
    ('md-bot', 'loader_bot', null, null, 'Active', true, null, null)`
  return { priya, priyanka, done }
}

test('lists the accounts to link with their suggestions; the filters count and switch', async ({ admin }) => {
  await accounts()
  await renderApp(PAGE, admin)
  const page = await screen.findByTestId('link-motherduck-accounts')
  expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Link MotherDuck Accounts to People')
  const filters = within(page).getByTestId('md-filters')
  expect(await within(filters).findByRole('button', { name: /To link · 2/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(filters).getByRole('button', { name: /Linked · 1/ })).toBeInTheDocument()
  expect(within(filters).getByRole('button', { name: /Service accounts · 1/ })).toBeInTheDocument()

  const rows = await within(page).findAllByTestId('md-account')
  expect(rows.map((r) => r.getAttribute('data-username'))).toEqual(['priya', 'zed_nobody'])
  expect(rows[0]).toHaveTextContent('Priya R')
  expect(rows[0]).toHaveTextContent('priya@elsewhere.example')
  expect(rows[0]).toHaveTextContent('Active')
  expect(rows[0]).toHaveTextContent('FT-1396A')
  const picks = within(rows[0]).getAllByTestId('md-suggestion')
  expect(picks.map((p) => p.textContent)).toEqual([expect.stringContaining('Priya Raman'), expect.stringContaining('Priyanka S')])
  expect(rows[1]).toHaveTextContent("No one's name reads as this username")

  await userEvent.click(within(filters).getByRole('button', { name: /Linked · 1/ }))
  const linked = await within(page).findAllByTestId('md-account')
  expect(linked.map((r) => r.getAttribute('data-username'))).toEqual(['done_one'])
  expect(linked[0]).toHaveTextContent('Done Person')
  await userEvent.click(within(filters).getByRole('button', { name: /Service accounts · 1/ }))
  await waitFor(() => expect(within(page).getAllByTestId('md-account').map((r) => r.getAttribute('data-username'))).toEqual(['loader_bot']))
})

test('a suggestion links at once; Undo takes it back', async ({ admin }) => {
  const { priya } = await accounts()
  await renderApp(PAGE, admin)
  const page = await screen.findByTestId('link-motherduck-accounts')
  const row = (await within(page).findAllByTestId('md-account'))[0]
  await userEvent.click(within(row).getAllByTestId('md-suggestion')[0])
  await waitFor(async () => expect((await sql`select person from motherduck_account where row_id = 'md-priya'`)[0].person).toBe(priya))
  const done = await within(page).findByTestId('md-linked-now')
  expect(done).toHaveTextContent('priya')
  expect(done).toHaveTextContent('Priya Raman')
  expect(within(page).getByRole('button', { name: /To link · 1/ })).toBeInTheDocument()

  await userEvent.click(within(done).getByRole('button', { name: 'Undo' }))
  await waitFor(async () => expect((await sql`select person from motherduck_account where row_id = 'md-priya'`)[0].person).toBeNull())
  expect(await within(page).findByRole('button', { name: /To link · 2/ })).toBeInTheDocument()
})

test('keys: 1 picks the first suggestion of the row in focus; Close their tickets now queues the sync', async ({ admin }) => {
  const { priya } = await accounts()
  await renderApp(PAGE, admin)
  const page = await screen.findByTestId('link-motherduck-accounts')
  const row = (await within(page).findAllByTestId('md-account'))[0]
  expect(row).toHaveAttribute('data-current', 'true')
  await userEvent.keyboard('1')
  await waitFor(async () => expect((await sql`select person from motherduck_account where row_id = 'md-priya'`)[0].person).toBe(priya))

  await userEvent.click(within(page).getByRole('button', { name: 'Close their tickets now' }))
  await waitFor(async () => expect(await sql`select 1 from background_job where method = 'sync_motherduck_accounts' and job_status = 'queued'`).not.toHaveLength(0))
  expect(await within(page).findByTestId('md-sync-queued')).toHaveTextContent(/queued/i)
})
