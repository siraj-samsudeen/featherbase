// #627: a change an approval rule holds. The maker's form says it waits and for
// whom; the row shows each proposal; only an approver sees Approve and Reject;
// a rejection needs a reason; an approval applies it and names the approver in
// the row's Activity; a new row waits without opening a row page; and an
// approver finds everything waiting for them on one page.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { sql } from 'server/src/db'
import { discoverPackages } from 'server/src/runtime-packages'
import { grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
type CreateUser = (options: { roles: string[]; fullName?: string; email?: string }) => Promise<Admin>
const WAIT = { timeout: 10_000 }
const SHELF = '/featherbase/admin/table/apr-shelf'

async function world(admin: Admin, createUser: CreateUser, rule: Record<string, unknown> = {}) {
  await admin.post('/api/table_def', { name: 'Apr Shelf', id_pattern: 'prompt', track_changes: true, columns: [
    { column_name: 'label', label: 'Label', column_type: 'Data' }, { column_name: 'bay', label: 'Bay', column_type: 'Int' }] })
  for (const role of ['Apr Lead', 'Apr Helper', 'Apr Reader'])
    await grantRole(admin, { role, table: 'Apr Shelf', can_read: true, ...(role === 'Apr Reader' ? {} : { can_write: true, can_create: true }) })
  const user = async (name: string, role: string) => {
    const client = await createUser({ roles: [role], fullName: name, email: `${name.split(' ')[0].toLowerCase()}-${randomUUID()}@example.test` })
    await sql`update person set password_hash = 'made-up' where row_id = ${client.user!}`
    return client
  }
  const lead = await user('Asha Lead', 'Apr Lead')
  const helper = await user('Hari Helper', 'Apr Helper')
  const reader = await user('Ravi Reader', 'Apr Reader')
  await admin.post('/api/table/Apr Shelf', { row_id: 'S-1', label: 'Blue box', bay: 1 })
  await admin.post('/api/table/Apr Shelf', { row_id: 'S-2', label: 'Green box', bay: 1 })
  await admin.post('/api/save_row', { table: 'Approval Rule', row: { description: 'Helpers ask a lead', ref_table: 'Apr Shelf',
    operations: 'Changes and new rows', outcome: 'Route to approvers', approvals_needed: 'All', maker_role: 'Apr Helper',
    approvers: [{ role: 'Apr Lead' }], ...rule } })
  await admin.post('/api/save_row', { table: 'Approval Rule', row: { description: 'Leads decide', ref_table: 'Apr Shelf',
    operations: 'Changes and new rows', outcome: 'Apply and log', maker_role: 'Apr Lead' } })
  return { lead, helper, reader }
}

async function propose(helper: Admin, id: string, values: Record<string, unknown>) {
  const row = await helper.get<{ updated_at: string }>(`/api/table/Apr Shelf/${id}`)
  const response = await helper.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'Apr Shelf', row: { row_id: id, updated_at: row.updated_at, ...values } }) })
  expect(response.status).toBe(202)
  return (await response.json() as { pending_proposal: { row_id: string } }).pending_proposal.row_id
}

const label = () => document.querySelector<HTMLInputElement>('input[data-field=label]')!

test('a Helper\'s save waits: the form names who it waits for and keeps the row\'s value', async ({ admin, createUser }) => {
  const { helper } = await world(admin, createUser as CreateUser)
  await renderApp(`${SHELF}/row/S-1`, helper)
  await waitFor(() => expect(label()).toHaveValue('Blue box'), WAIT)
  await userEvent.clear(label())
  await userEvent.type(label(), 'Red box')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  const notice = await screen.findByTestId('form-waiting', {}, WAIT)
  expect(notice).toHaveTextContent('Your change is waiting for approval.')
  expect(notice).toHaveTextContent('Waiting for approval from anyone with the role Apr Lead.')
  await waitFor(() => expect(label()).toHaveValue('Blue box'))
  const strip = await screen.findByTestId('pending-changes', {}, WAIT)
  expect(within(strip).getByTestId('proposal-changes')).toHaveTextContent('Label: Blue box → Red box')
  expect(within(strip).getByTestId('proposal-maker')).toHaveTextContent('Hari Helper')
  // The maker can't decide their own change.
  expect(within(strip).queryByTestId('proposal-approve')).toBeNull()
  await userEvent.click(within(notice).getByRole('button', { name: 'dismiss' }))
  expect(screen.queryByTestId('form-waiting')).toBeNull()
})

test('a reader sees the proposal but not Approve or Reject', async ({ admin, createUser }) => {
  const { helper, reader } = await world(admin, createUser as CreateUser)
  await propose(helper, 'S-1', { label: 'Red box' })
  await renderApp(`${SHELF}/row/S-1`, reader)
  const strip = await screen.findByTestId('pending-changes', {}, WAIT)
  expect(strip).toHaveTextContent('Waiting for approval (1)')
  expect(within(strip).getByTestId('proposal-changes')).toHaveTextContent('Label: Blue box → Red box')
  expect(within(strip).queryByTestId('proposal-approve')).toBeNull()
  expect(within(strip).queryByTestId('proposal-reject')).toBeNull()
})

test('the lead rejects with a reason, and the row is unchanged', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser)
  await propose(helper, 'S-1', { label: 'Red box' })
  await renderApp(`${SHELF}/row/S-1`, lead)
  const strip = await screen.findByTestId('pending-changes', {}, WAIT)
  await userEvent.click(await within(strip).findByTestId('proposal-reject', {}, WAIT))
  await userEvent.click(within(strip).getByTestId('proposal-reject-send'))
  expect(within(strip).getByTestId('proposal-error')).toHaveTextContent('Say why you are rejecting this')
  await userEvent.type(within(strip).getByTestId('proposal-reject-reason'), 'Wrong shelf')
  await userEvent.click(within(strip).getByTestId('proposal-reject-send'))
  await waitFor(() => expect(within(screen.getByTestId('pending-changes')).getByTestId('proposal-state')).toHaveTextContent('Rejected'), WAIT)
  expect(screen.getByTestId('proposal-decision')).toHaveTextContent('Rejected by Asha Lead')
  expect(screen.getByTestId('proposal-reason')).toHaveTextContent('Reason: Wrong shelf')
  expect(label()).toHaveValue('Blue box')
})

test('the lead approves: the form shows the new value, and Activity names maker and approver', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser)
  await propose(helper, 'S-1', { label: 'Red box' })
  await renderApp(`${SHELF}/row/S-1`, lead)
  await userEvent.click(await screen.findByTestId('proposal-approve', {}, WAIT))
  await waitFor(() => expect(label()).toHaveValue('Red box'), WAIT)
  expect(screen.getByTestId('proposal-state')).toHaveTextContent('Applied')
  expect(screen.getByTestId('proposal-decision')).toHaveTextContent('Approved by Asha Lead')
  expect(screen.queryByTestId('stale-banner')).toBeNull()
  await userEvent.click(screen.getByRole('tab', { name: 'Activity' }))
  const timeline = await screen.findByTestId('activity-timeline', {}, WAIT)
  await waitFor(() => expect(within(timeline).getByTestId('activity-approved-by')).toHaveTextContent('approved by Asha Lead'), WAIT)
  expect(within(timeline).getAllByTestId('activity-version').at(-1)).toHaveTextContent(/Hari Helper edited/)
})

test('with two approvals needed, the strip says who approved and who it still waits for', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser, { approvers: [{ role: 'Apr Lead' }, { role: 'Apr Reader' }] })
  const id = await propose(helper, 'S-1', { label: 'Red box' })
  await lead.post(`/api/change_proposals/${id}/approve`, {})
  await renderApp(`${SHELF}/row/S-1`, helper)
  const strip = await screen.findByTestId('pending-changes', {}, WAIT)
  expect(within(strip).getByTestId('proposal-approved-by')).toHaveTextContent('Approved by Asha Lead.')
  expect(within(strip).getByTestId('proposal-waiting-for')).toHaveTextContent('Waiting for approval from anyone with the role Apr Reader.')
})

test('a change made meanwhile asks for a fresh review with the original, current and proposed values', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser)
  await propose(helper, 'S-1', { label: 'Red box' })
  const row = await lead.get<{ updated_at: string }>('/api/table/Apr Shelf/S-1')
  await lead.post('/api/save_row', { table: 'Apr Shelf', row: { row_id: 'S-1', updated_at: row.updated_at, label: 'Teal box' } })
  await renderApp(`${SHELF}/row/S-1`, lead)
  await userEvent.click(await screen.findByTestId('proposal-approve', {}, WAIT))
  expect(await screen.findByTestId('proposal-fresh-review', {}, WAIT)).toHaveTextContent('needs a fresh review')
  expect(screen.getByTestId('proposal-changes')).toHaveTextContent('Label: was Blue box when proposed, now Teal box → Red box')
  const again = screen.getByRole('button', { name: 'Approve again' })
  await waitFor(() => expect(again).toBeEnabled())
  await userEvent.click(again)
  await waitFor(() => expect(label()).toHaveValue('Red box'), WAIT)
})

test('a new row waits on its form, and the approver finds it on their approvals page', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser)
  await renderApp(`${SHELF}/new`, helper)
  const id = await waitFor(() => {
    const input = document.querySelector<HTMLInputElement>('input[data-field=row_id]')
    expect(input).not.toBeNull()
    return input!
  }, WAIT)
  await userEvent.type(id, 'S-9')
  await userEvent.type(label(), 'New box')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByTestId('form-waiting', {}, WAIT)).toHaveTextContent('Your new Apr Shelf row is waiting for approval.')
  expect(label()).toHaveValue('')
  const [proposal] = await sql`select row_id from change_proposal where target_table = 'Apr Shelf' and target_row is null`
  await renderApp(`/featherbase/account/approvals?proposal=${proposal.row_id}`, lead)
  const linked = await screen.findByTestId('approvals-linked', {}, WAIT)
  expect(within(linked).getByTestId('proposal-target')).toHaveTextContent('Apr Shelf')
  await waitFor(() => expect(within(linked).getByTestId('proposal-changes')).toHaveTextContent('Label: New box'), WAIT)
  await userEvent.click(within(linked).getByTestId('proposal-approve'))
  await waitFor(() => expect(within(screen.getByTestId('approvals-linked')).getByTestId('proposal-state')).toHaveTextContent('Applied'), WAIT)
  expect(screen.getByTestId('proposal-result-row')).toHaveTextContent('open the new row')
})

test('the approvals page lists what waits for the lead, and the menu counts it', async ({ admin, createUser }) => {
  const { lead, helper } = await world(admin, createUser as CreateUser)
  await propose(helper, 'S-1', { label: 'Red box' })
  await propose(helper, 'S-2', { bay: 7 })
  await renderApp('/featherbase/account/approvals', lead)
  const list = await screen.findByTestId('approvals-list', {}, WAIT)
  expect(within(list).getAllByTestId('proposal')).toHaveLength(2)
  expect(within(list).getAllByTestId('proposal-target').map((a) => a.textContent).sort()).toEqual(['Apr Shelf S-1', 'Apr Shelf S-2'])
  await waitFor(() => expect(screen.getByTestId('approvals-count')).toHaveTextContent('2'), WAIT)
  await renderApp('/featherbase/account/approvals', helper)
  expect(await screen.findByTestId('approvals-empty', {}, WAIT)).toHaveTextContent('Nothing waits for your approval.')
})

test('a bulk edit by a Helper says the rows wait for approval', async ({ admin, createUser }) => {
  const { helper } = await world(admin, createUser as CreateUser)
  await renderApp(SHELF, helper)
  for (const title of ['Blue box', 'Green box']) await userEvent.click(await screen.findByLabelText(`Select ${title}`, {}, WAIT))
  await userEvent.selectOptions(await screen.findByTestId('bulk-edit-field', {}, WAIT), 'label')
  await userEvent.type(screen.getByTestId('bulk-edit-value'), 'Red box')
  await userEvent.click(screen.getByTestId('bulk-edit-apply'))
  expect(await screen.findByTestId('bulk-waiting', {}, WAIT)).toHaveTextContent('2 rows are waiting for approval and did not change yet.')
})

test('a rule\'s form offers the names running apps give for "Maker is" and "Person named by"', async ({ admin }) => {
  expect(await discoverPackages([resolve('../..', 'test-apps/approval-proof')])).toEqual([])
  await admin.post('/api/install_app', { name: 'approvalproof' })
  await renderApp('/featherbase/admin/table/approval-rule/new', admin)
  const names = await waitFor(() => {
    const list = screen.getByTestId('approval-resolver-names')
    expect(list.querySelectorAll('option')).toHaveLength(7)
    return list
  }, WAIT)
  expect([...names.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['approvalproof.broken', 'approvalproof.by_id', 'approvalproof.forgotten',
    'approvalproof.not_a_list', 'approvalproof.racing', 'approvalproof.related', 'approvalproof.site_lead'])
  expect(document.querySelector('input[data-field=maker_resolver]')).toHaveAttribute('list', names.id)
})
