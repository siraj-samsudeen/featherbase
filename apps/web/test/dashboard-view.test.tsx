// UI-026: a Dashboard shows number cards and a bar chart that match the data.
// Moved down from e2e/dashboard.spec.ts (#1080): the page in jsdom, its counts
// from the real in-process server on the sandboxed database.
import { screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const T = 'Dv Task'
const DASH = 'Dv Board'

test('UI-026: dashboard number cards and bar chart match the underlying data', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed\nPending', in_list_view: true },
    ],
  })
  // 3 Open, 2 Closed, 1 Pending: 6 in all, 3 open.
  for (const stage of ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending'])
    await admin.post('/api/save_row', { table: T, row: { title: 't', stage } })
  await admin.post('/api/save_row', {
    table: 'Dashboard',
    row: {
      row_id: DASH,
      label: 'Dv Board',
      config: JSON.stringify({
        cards: [
          { label: 'All Tasks', table: T },
          { label: 'Open Tasks', table: T, filters: [['stage', '=', 'Open']] },
        ],
        charts: [{ label: 'By Status', table: T, group_by: 'stage' }],
      }),
    },
  })

  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  await screen.findByTestId('dashboard-title', {}, { timeout: 8000 })
  const exact = (id: string, text: string) =>
    waitFor(() => expect(screen.getByTestId(id).textContent?.trim()).toBe(text), { timeout: 8000 })
  await exact('card-value-All Tasks', '6')
  await exact('card-value-Open Tasks', '3')
  await exact('bar-value-Open', '3')
  await exact('bar-value-Closed', '2')
  await exact('bar-value-Pending', '1')
})

async function stages(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: T, row: { title: 'staged', stage: 'Open' } })
  await admin.post('/api/save_row', { table: T, row: { title: 'unstaged' } })
}

function dropNetwork(lost: (url: string) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    lost(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url))
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

// Defect (issue to be filed): the page reads the row's name from `name`, a
// field the server no longer sends (rows carry `row_id`), so a dashboard with
// no label has an empty heading.
test.fails('a dashboard with no label is headed by its name', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Dv Bare' } })
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent('Dv Bare')}`, admin)
  expect(await screen.findByTestId('dashboard-title', {}, { timeout: 8000 })).toHaveTextContent(/^Dv Bare$/)
})

test('a dashboard with no settings shows nothing to count', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Dv Bare', label: 'Dv Bare' } })
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent('Dv Bare')}`, admin)
  await screen.findByTestId('dashboard', {}, { timeout: 8000 })
  expect(screen.queryByTestId(/^card-/)).not.toBeInTheDocument()
})

test('a chart bar for rows with no value in the grouped column is labelled with a dash', async ({ admin }) => {
  await stages(admin)
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: DASH, label: DASH, config: { charts: [{ label: 'By Status', table: T, group_by: 'stage' }] } } })
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  await waitFor(() => expect(screen.getByTestId('dashboard')).toHaveTextContent('—'), { timeout: 8000 })
})

test('a card and a chart the network drops show a dash and say they failed to load', async ({ admin }) => {
  await stages(admin)
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: DASH, label: DASH, config: {
    cards: [{ label: 'All Tasks', table: T }],
    charts: [{ label: 'By Status', table: T, group_by: 'stage' }],
  } } })
  dropNetwork((url) => url.startsWith('/api/dashboard/'))
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  await waitFor(() => expect(screen.getByTestId('card-value-All Tasks').textContent?.trim()).toBe('—'), { timeout: 8000 })
  expect(await screen.findByText('Failed to load')).toBeInTheDocument()
})

test('a dashboard the network drops says it was not found', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: DASH, label: DASH } })
  dropNetwork((url) => url.startsWith('/api/table/Dashboard/'))
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  expect(await screen.findByTestId('dashboard-error', {}, { timeout: 8000 })).toHaveTextContent('Dashboard not found')
})
