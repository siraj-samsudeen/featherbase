// #464: the Jobs page. Every scheduled job in one list with an on/off switch,
// its schedule, its last run (time, OK / Failed / Refused, the one-line
// result) and Run now. Item numbers refer to the UI checklist on #464.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { syncScheduledJobs } from 'server/src/jobs'
import { test, expect, renderApp } from './pg-test'

const LAST_RUN = new Date('2026-10-23T04:00:00Z') // 23-Oct-2026 09:30 IST

async function seed() {
  await sql`delete from background_job`
  await sql`delete from scheduled_job`
  const row = (method: string, extra: Record<string, unknown>) => ({
    row_id: method, created_by: 'Administrator', updated_by: 'Administrator', method,
    cadence: 'daily', enabled: true, description: null, last_run_at: null, last_outcome: null, last_result: null,
    ...extra,
  })
  await sql`insert into scheduled_job ${sql([
    row('jp_ok', { cadence: 'every 4 hours', description: 'Rebuild the report snapshots.', last_run_at: LAST_RUN, last_outcome: 'success', last_result: '3 snapshots rebuilt' }),
    row('jp_failed', { last_run_at: LAST_RUN, last_outcome: 'error', last_result: 'the warehouse did not answer' }),
    row('jp_refused', { enabled: false, last_run_at: LAST_RUN, last_outcome: 'refused', last_result: 'disabled nobody: the feed is stale' }),
    row('jp_never', { cadence: 'hourly' }),
  ])}`
  for (const m of ['jp_ok', 'jp_failed', 'jp_never']) await syncScheduledJobs(m)
}

const entry = (method: string) => screen.findByTestId(`scheduled-job-${method}`, {}, { timeout: 10_000 })

test('every scheduled job is listed with its name, switch, schedule and last run (items 1, 3, 5-8)', async ({ admin }) => {
  await seed()
  await renderApp('/featherbase/admin/jobs', admin)

  expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument()
  expect(screen.getByText('Scheduled jobs run on their own. A run that fails or refuses emails every System Manager.')).toBeInTheDocument()

  const ok = await entry('jp_ok')
  expect(ok).toHaveTextContent('Jp ok')
  expect(ok).toHaveTextContent('Rebuild the report snapshots.')
  expect(ok).toHaveTextContent('Every 4 hours')
  expect(ok).toHaveTextContent(/Next run \d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST/)
  expect(within(ok).getByTestId('last-run-state')).toHaveTextContent('OK')
  expect(ok).toHaveTextContent('23-Oct-2026 09:30 IST')
  expect(ok).toHaveTextContent('3 snapshots rebuilt')
  const okSwitch = within(ok).getByRole('switch', { name: 'Run Jp ok on its schedule' })
  expect(okSwitch).toHaveAttribute('aria-checked', 'true')
  expect(ok).toHaveTextContent('On')

  const failed = await entry('jp_failed')
  expect(within(failed).getByTestId('last-run-state')).toHaveTextContent('Failed')
  expect(failed).toHaveTextContent('the warehouse did not answer')

  const refused = await entry('jp_refused')
  expect(within(refused).getByTestId('last-run-state')).toHaveTextContent('Refused')
  expect(refused).toHaveTextContent('disabled nobody: the feed is stale')
  expect(within(refused).getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  expect(refused).toHaveTextContent('Off')
  expect(refused).toHaveTextContent('Not scheduled')

  const never = await entry('jp_never')
  expect(never).toHaveTextContent('Hourly')
  expect(never).toHaveTextContent('Never run')

  // Item 3: in name order.
  const order = screen.getAllByTestId(/^scheduled-job-/).map((el) => el.getAttribute('data-testid'))
  expect(order).toEqual(['scheduled-job-jp_failed', 'scheduled-job-jp_never', 'scheduled-job-jp_ok', 'scheduled-job-jp_refused'])
  // Item 13: the queue is still on the page.
  expect(screen.getByRole('heading', { level: 2, name: 'Queue' })).toBeInTheDocument()
})

test('the switch turns a schedule off and on through the Scheduled Job save (item 6)', async ({ admin }) => {
  await seed()
  await renderApp('/featherbase/admin/jobs', admin)
  const ok = await entry('jp_ok')

  await userEvent.click(within(ok).getByRole('switch'))
  await waitFor(async () => {
    const [row] = await sql`select enabled from scheduled_job where method = 'jp_ok'`
    expect(row.enabled).toBe(false)
  })
  await waitFor(() => expect(within(ok).getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
  expect(await sql`select 1 from background_job where method = 'jp_ok' and job_status = 'queued'`).toHaveLength(0)
  await waitFor(() => expect(ok).toHaveTextContent('Not scheduled'))

  await userEvent.click(within(ok).getByRole('switch'))
  await waitFor(() => expect(within(ok).getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
  expect(await sql`select 1 from background_job where method = 'jp_ok' and job_status = 'queued'`).toHaveLength(1)
})

test('a refused save puts the switch back and says why (item 6)', async ({ admin }) => {
  await seed()
  await renderApp('/featherbase/admin/jobs', admin)
  const ok = await entry('jp_ok')
  // Someone else saved the row since the page loaded: the save is refused.
  await sql`update scheduled_job set updated_at = now() + interval '1 minute' where method = 'jp_ok'`

  await userEvent.click(within(ok).getByRole('switch'))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Jp ok/)
  await waitFor(() => expect(within(ok).getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
  const [row] = await sql`select enabled from scheduled_job where method = 'jp_ok'`
  expect(row.enabled).toBe(true)
})

test('Run now queues one run without moving the schedule, and reads Queued until it lands (item 9)', async ({ admin }) => {
  await seed()
  await renderApp('/featherbase/admin/jobs', admin)
  const ok = await entry('jp_ok')
  const [scheduled] = await sql`select row_id, run_at from background_job where method = 'jp_ok' and job_status = 'queued'`

  await userEvent.click(within(ok).getByRole('button', { name: 'Run Jp ok now' }))

  await waitFor(() => expect(within(ok).getByRole('button', { name: 'Run Jp ok now' })).toHaveTextContent('Queued'))
  expect(within(ok).getByRole('button', { name: 'Run Jp ok now' })).toBeDisabled()
  expect(await screen.findByText('Jp ok queued')).toBeInTheDocument()
  const live = await sql`select row_id, trigger, run_at from background_job where method = 'jp_ok' and job_status = 'queued' order by trigger`
  expect(live.map((r) => r.trigger)).toEqual(['manual', 'schedule'])
  const kept = live.find((r) => r.trigger === 'schedule')!
  expect(kept.row_id).toBe(scheduled.row_id)
  expect(new Date(kept.run_at as string).getTime()).toBe(new Date(scheduled.run_at as string).getTime())
})

test('no scheduled jobs reads as an empty state, not an empty table (item 12)', async ({ admin }) => {
  await sql`delete from background_job`
  await sql`delete from scheduled_job`
  await renderApp('/featherbase/admin/jobs', admin)
  expect(await screen.findByText('No scheduled jobs', {}, { timeout: 10_000 })).toBeInTheDocument()
})

test('the sidebar links to Jobs for a System Manager (item 1)', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  const link = await screen.findByTestId('jobs-link', {}, { timeout: 10_000 })
  expect(link).toHaveAttribute('href', '/featherbase/admin/jobs')
  expect(link).toHaveTextContent('Jobs')
})

test('someone without the System Manager role is sent to the Admin home (item 1)', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true } })
  const clerk = await createUser({ email: 'clerk.jobs@example.com', roles: ['Shelf Clerk'] })
  await renderApp('/featherbase/admin/jobs', clerk)
  await screen.findByTestId('all-tables-link')
  expect(screen.queryByTestId('jobs-page')).not.toBeInTheDocument()
  expect(screen.queryByTestId('jobs-link')).not.toBeInTheDocument()
})
