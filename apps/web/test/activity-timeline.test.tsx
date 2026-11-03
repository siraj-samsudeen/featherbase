// #421: the activity timeline on a row's form shows each changed value the way
// the rest of the Admin shows it: a Date as DD-Mon-YYYY, a Datetime on the
// viewer's clock, money the Indian way. Before, a Date change read
// "2026-10-23T00:00:00.000Z → 2026-10-24T00:00:00.000Z".
process.env.TZ = 'Asia/Kolkata'

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

const T = 'Atl Ownership'
const ENC = encodeURIComponent(T)

type Admin = Parameters<typeof renderApp>[1]

async function editedRow(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', label: 'Title', column_type: 'Data' },
      { column_name: 'effective_from', label: 'Effective from', column_type: 'Date' },
      { column_name: 'handed_over', label: 'Handed over', column_type: 'Datetime' },
      { column_name: 'budget', label: 'Budget', column_type: 'Currency' },
    ],
  })
  const doc = (await admin.post('/api/save_row', {
    table: T,
    row: { title: 'North wing', effective_from: '2026-10-23', handed_over: '2026-10-22T20:30:00Z', budget: 1000 },
  })) as { row_id: string; updated_at: string }
  await admin.post('/api/save_row', {
    table: T,
    row: { row_id: doc.row_id, updated_at: doc.updated_at, effective_from: '2026-10-24', budget: 1234567 },
  })
  return doc.row_id
}

async function diffLines(admin: Admin, rowId: string) {
  await renderApp(`/featherbase/admin/${ENC}/${rowId}`, admin)
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
  const diff = await within(timeline).findByTestId('activity-diff')
  return diff
}

test('a changed column uses its metadata display label', async ({ admin }) => {
  await admin.post('/api/table_def', { name: T, columns: [
    { column_name: 'client_id', label: 'OAuth client ID', column_type: 'Data' },
  ] })
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
    table: T, row: { client_id: 'old-client' },
  })
  await admin.post('/api/save_row', { table: T, row: { ...row, client_id: 'new-client' } })
  const diff = await diffLines(admin, row.row_id)
  await waitFor(() => expect(diff).toHaveTextContent('OAuth client ID: old-client → new-client'))
  expect(diff).not.toHaveTextContent('client_id:')
})

test('long unbroken change values remain fully readable with wrapping', async ({ admin }) => {
  await admin.post('/api/table_def', { name: T, columns: [
    { column_name: 'client_id', label: 'Client ID', column_type: 'Data' },
  ] })
  const before = `old${'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3)}.apps.googleusercontent.com`
  const after = `new${'abcdefghijklmnopqrstuvwxyz9876543210'.repeat(3)}.apps.googleusercontent.com`
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', {
    table: T, row: { client_id: before },
  })
  await admin.post('/api/save_row', { table: T, row: { ...row, client_id: after } })
  const diff = await diffLines(admin, row.row_id)
  await waitFor(() => expect(diff).toHaveTextContent(`Client ID: ${before} → ${after}`))
  for (const value of [before, after]) {
    const shown = within(diff).getByText(value, { exact: true })
    expect(shown.textContent).toBe(value)
    expect(shown).not.toHaveClass('whitespace-nowrap')
    expect(shown).toHaveClass('[overflow-wrap:anywhere]')
    expect(shown).not.toHaveClass('truncate', 'line-clamp-1', 'overflow-hidden')
  }
})

test('a Date change reads as the days, and money the Indian way', async ({ admin }) => {
  const rowId = await editedRow(admin)
  const diff = await diffLines(admin, rowId)
  await waitFor(() => expect(diff).toHaveTextContent('Effective from: 23-Oct-2026 → 24-Oct-2026'))
  expect(diff).toHaveTextContent('Budget: ₹1,000.00 → ₹12,34,567.00')
  expect(diff.textContent).not.toMatch(/T00:00:00/)
  // The edit's own time keeps its zone on the same line.
  expect(screen.getByTestId('activity-time')).toHaveTextContent(/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/)
  expect(screen.getByTestId('activity-time')).toHaveClass('whitespace-nowrap')
})

test('nested JSON history shows both saved values and allows long values to wrap', async ({ admin }) => {
  await admin.post('/api/table_def', { name: T, columns: [
    { column_name: 'extra', label: 'Extra', column_type: 'JSON' },
  ] })
  const before = { shelf: 3, nested: { bins: ['old', 'west'] } }
  const after = { shelf: 9, nested: { bins: ['east'], note: 'long-value-'.repeat(60) } }
  const row = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: T, row: { extra: before } })
  await admin.post('/api/save_row', { table: T, row: { ...row, extra: after } })
  const diff = await diffLines(admin, row.row_id)
  await waitFor(() => expect(diff).toHaveTextContent(`Extra: ${JSON.stringify(before)} → ${JSON.stringify(after)}`))
  expect(diff).not.toHaveTextContent('[object Object]')
  for (const value of [before, after]) {
    const shown = within(diff).getByText(JSON.stringify(value))
    expect(shown).not.toHaveClass('whitespace-nowrap')
    expect(shown).toHaveClass('break-all')
  }
})

test('a Date change recorded as a UTC timestamp before #421 also reads as the days', async ({ admin }) => {
  const rowId = await editedRow(admin)
  await sql`
    update version
       set data = ${sql.json({ changed: [['effective_from', '2026-10-23T00:00:00.000Z', '2026-10-24T00:00:00.000Z']] })}
     where ref_table = ${T} and ref_name = ${rowId}`
  const diff = await diffLines(admin, rowId)
  await waitFor(() => expect(diff).toHaveTextContent('Effective from: 23-Oct-2026 → 24-Oct-2026'))
})

test('a Datetime change reads on the viewer\'s clock, and an empty side reads ∅', async ({ admin }) => {
  const rowId = await editedRow(admin)
  await sql`
    update version
       set data = ${sql.json({ changed: [['handed_over', null, '2026-10-22T20:30:00.000Z']] })}
     where ref_table = ${T} and ref_name = ${rowId}`
  const diff = await diffLines(admin, rowId)
  await waitFor(() => expect(diff).toHaveTextContent('Handed over: ∅ → 23-Oct-2026 02:00'))
})

// A Settings Table records its history as stored text, so a checkbox is '1'/'0'; both are truthy
// strings, and switching one off read ✓ → ✓.
test('a Settings checkbox switched off reads ✓ → ✗', async ({ admin }) => {
  const S = 'Atl Store Settings'
  await admin.post('/api/table_def', {
    name: S,
    kind: 'settings',
    columns: [{ column_name: 'open_sundays', label: 'Open Sundays', column_type: 'Check' }],
  })
  await admin.post('/api/save_row', { table: S, row: { open_sundays: true } })
  await admin.post('/api/save_row', { table: S, row: { open_sundays: false } })
  await renderApp(`/featherbase/admin/${encodeURIComponent(S)}`, admin)
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
  await waitFor(() => {
    const diffs = within(timeline).getAllByTestId('activity-diff')
    expect(diffs.at(-1)).toHaveTextContent('Open Sundays: ✓ → ✗')
  })
})

test('import and resolution history says who imported and which decision the person made', async ({ admin }) => {
  await admin.post('/api/table_def', { name: T, columns: [
    { column_name: 'title', label: 'Title', column_type: 'Data' },
    { column_name: 'city', label: 'City', column_type: 'Data' },
    { column_name: 'phone', label: 'Phone', column_type: 'Data' },
  ] })
  const path = `/api/table/${ENC}`
  await admin.post(`${path}:import`, { rows: [{ title: 'North wing', city: 'North', phone: '111' }], context: { run_id: 'timeline-first' } })
  const list = await admin.get<{ data: { row_id: string }[] }>(path)
  const rowId = list.data[0].row_id
  const row = await admin.get<Record<string, unknown>>(`${path}/${rowId}`)
  await admin.post('/api/save_row', { table: T, row: { ...row, city: 'South' } })
  await admin.post(`${path}:import`, { key_column: 'title', rows: [{ title: 'North wing', city: 'East', phone: '222' }], context: { run_id: 'timeline-next' } })
  const { conflicts } = await admin.get<{ conflicts: { id: string }[] }>(`${path}:import-conflicts`)
  await admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflicts[0].id, decision: 'keep' })
  await renderApp(`/featherbase/admin/${ENC}/${rowId}`, admin)
  await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }))
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 8000 })
  await waitFor(() => expect(timeline).toHaveTextContent('Administrator imported'))
  expect(timeline).toHaveTextContent('timeline-next')
  expect(timeline).toHaveTextContent('Administrator kept their correction')
  expect(timeline).toHaveTextContent('City: kept the current value instead of East')
})
