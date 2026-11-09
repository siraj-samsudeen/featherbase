// #1101: a change an agent made through /mcp reads, in the row's Activity and
// on its Version record, "<person> edited via <token label>". The actor stays
// the person; a change by hand reads as before; a row an agent created says
// "created" once, in the "created this" line.
process.env.TZ = 'Asia/Kolkata'

import { rowHref, tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import { sql } from 'server/src/db'
import { connectAgent, issueToken, type Agent } from 'server/test/agent-driver'
import { test, expect, renderApp, renderSession } from './pg-test'

const T = 'Aam Depot'
const LABEL = 'Claude on my laptop'

type Admin = Parameters<typeof renderApp>[1]
type Row = { row_id: string; updated_at: string }

async function depotTable(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    track_changes: true,
    columns: [
      { column_name: 'depot_name', label: 'Depot name', column_type: 'Data' },
      { column_name: 'city', label: 'City', column_type: 'Data' },
    ],
  })
}

/** The agent creates "North depot" in Chennai and moves it to Salem; then the admin moves it to Madurai by hand. */
async function agentThenHand(admin: Admin, agent: Agent) {
  const { row_id } = await agent.ok<Row>('create_row', { table: T, values: { depot_name: 'North depot', city: 'Chennai' } })
  const read = await agent.ok<Row>('get_row', { table: T, id: row_id })
  const moved = await agent.ok<Row>('update_row', { table: T, id: row_id, values: { city: 'Salem' }, updated_at: read.updated_at })
  await admin.post('/api/save_row', { table: T, row: { row_id, updated_at: moved.updated_at, city: 'Madurai' } })
  return row_id
}

async function openActivity(admin: Admin, rowId: string) {
  const { session } = await renderSession(`/featherbase/admin/table/${tableSlug(T)}/row/${rowId}`, admin)
  await session.click('Activity')
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
  await waitFor(() => expect(within(timeline).getAllByTestId('activity-version').length).toBeGreaterThan(0))
  return { session, timeline }
}

const entryFor = (timeline: HTMLElement, change: string) =>
  within(timeline).getAllByTestId('activity-version').find((e) => e.textContent?.includes(change))!

test('an edit through an agent reads "edited via" the token\'s label', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const { session, timeline } = await openActivity(admin, rowId)
  await session.within('[data-testid="activity-timeline"]', (s) => s.assertText(`Administrator edited via ${LABEL} · `))
  expect(entryFor(timeline, 'City: Chennai → Salem')).toHaveTextContent(new RegExp(`^Administrator edited via ${LABEL} · `))
})

test('the agent mark is a subdued chip after the verb', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const { timeline } = await openActivity(admin, rowId)
  const chip = within(entryFor(timeline, 'City: Chennai → Salem')).getByTestId('activity-via')
  expect(chip).toHaveTextContent(`via ${LABEL}`)
  expect(chip).toHaveClass('text-ink-subtle')
})

test('an edit by hand carries no agent mark', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const { timeline } = await openActivity(admin, rowId)
  const byHand = entryFor(timeline, 'City: Salem → Madurai')
  expect(byHand).toHaveTextContent(/^Administrator edited · /)
  expect(within(byHand).queryByTestId('activity-via')).toBeNull()
})

test('a row an agent created opens with "created this via" the token\'s label', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  await openActivity(admin, rowId)
  await waitFor(() => expect(screen.getByTestId('activity-created')).toHaveTextContent(new RegExp(`^Administrator created this via ${LABEL} · `)))
})

test('a row an agent created says "created" once', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const { session, timeline } = await openActivity(admin, rowId)
  await session.within('[data-testid="activity-timeline"]', (s) => s.refuteText('row updated'))
  expect(within(timeline).getAllByTestId('activity-version')).toHaveLength(2)
  expect(timeline.textContent?.match(/created/g)).toHaveLength(1)
})

test('a service account\'s agent reads as the account, via the token\'s label', async ({ admin }) => {
  await depotTable(admin)
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'nightly-sync', roles: ['System Manager'] })
  const agent = await connectAgent(await issueToken(admin, 'Sync agent', account.row_id))
  const rowId = await agentThenHand(admin, agent)
  const { timeline } = await openActivity(admin, rowId)
  await waitFor(() => expect(entryFor(timeline, 'City: Chennai → Salem')).toHaveTextContent(/^nightly-sync edited via Sync agent · /))
})

test('a Version record made through an agent reads "Changed by <person> via" the label', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const [byAgent] = await sql`select row_id from version where ref_table = ${T} and ref_name = ${rowId} and data->'changed' @> '[["city","Chennai","Salem"]]'`
  await renderApp(rowHref('Version', String(byAgent.row_id)), admin)
  const header = await screen.findByTestId('change-header', {}, { timeout: 10_000 })
  await waitFor(() => expect(header).toHaveTextContent(new RegExp(`Changed by Administrator via ${LABEL} · `)))
})

test('a Version record made by hand reads as before', async ({ admin }) => {
  await depotTable(admin)
  const rowId = await agentThenHand(admin, await connectAgent(await issueToken(admin, LABEL)))
  const [byHand] = await sql`select row_id from version where ref_table = ${T} and ref_name = ${rowId} and data->'changed' @> '[["city","Salem","Madurai"]]'`
  await renderApp(rowHref('Version', String(byHand.row_id)), admin)
  const header = await screen.findByTestId('change-header', {}, { timeout: 10_000 })
  await waitFor(() => expect(header).toHaveTextContent(/Changed by Administrator · /))
  expect(within(header).queryByTestId('activity-via')).toBeNull()
})
