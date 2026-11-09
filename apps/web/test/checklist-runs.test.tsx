// The checklist view's run list: runs grouped by day (Today, Yesterday, an
// older date, undated last), each card with its title, status and progress;
// tapping a card opens the run and Back returns to the list. The merged web
// coverage report (ADR 0012) showed this list taken by no test — e2e and
// checklist-binding.test.tsx open runs directly by URL.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { dayLabel } from '../src/components/ChecklistView'
import { timelineDayKey } from '@featherbase/shop-floor'

const T = 'Cr Opening'
const ENC = encodeURIComponent(T)
// The run's day on the reader's own calendar, as the run list reads it (#539).
const day = (offset: number) => {
  const now = new Date()
  return timelineDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset))
}

async function seedTables(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', {
    name: 'Cr Opening Step',
    kind: 'sub_table',
    columns: [
      { column_name: 'item_label', label: 'Item', column_type: 'Data' },
      { column_name: 'done', label: 'Done', column_type: 'Check' },
    ],
  })
  await admin.post('/api/table_def', {
    name: T,
    title_column: 'run_title',
    columns: [
      { column_name: 'run_title', label: 'Title', column_type: 'Data' },
      { column_name: 'stage', label: 'Stage', column_type: 'Choice', choices: 'Open\nDone' },
      { column_name: 'run_date', label: 'Date', column_type: 'Date' },
      { column_name: 'progress', label: 'Progress', column_type: 'Data' },
      { column_name: 'steps', label: 'Steps', column_type: 'Sub-table', row_table: 'Cr Opening Step' },
    ],
  })
}

test('runs are grouped by day, newest first, and a card opens its run', async ({ admin }) => {
  const user = userEvent.setup()
  await seedTables(admin)
  const save = (row: Record<string, unknown>) => admin.post('/api/save_row', { table: T, row })
  await save({ run_title: 'Old opening', run_date: '2026-01-05', stage: 'Done', progress: '3/3' })
  await save({ run_title: 'Undated opening' })
  await save({ run_title: 'Yesterday opening', run_date: day(1), progress: '1/3' })
  await save({ run_title: 'Today opening', run_date: day(0), stage: 'Open', progress: '0/2', steps: [{ item_label: 'Unlock the shutter' }] })

  await renderApp(`/featherbase/admin/table/${tableSlug(decodeURIComponent(ENC))}/view/checklist`, admin)
  const view = await screen.findByTestId('checklist-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(within(view).getAllByTestId('checklist-run-card')).toHaveLength(4))
  expect(view).toHaveTextContent('4 runs')
  const cards = within(view).getAllByTestId('checklist-run-card').map((c) => c.textContent)
  expect(cards).toEqual(['Today openingOpen0/2', 'Yesterday opening1/3', 'Old openingDone3/3', 'Undated opening'])
  // Day headings, in the same order; an older day reads DD-Mon-YYYY (#539).
  const text = view.textContent ?? ''
  expect(text).not.toContain('2026-01-05')
  const order = ['Today', 'Yesterday', '05-Jan-2026', 'Old opening', 'Undated'].map((h) => text.indexOf(h))
  expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true)
  expect(within(view).getByTestId('checklist-new')).toHaveTextContent('+ New')

  await user.click(within(view).getAllByTestId('checklist-run-card')[0])
  const run = await screen.findByTestId('checklist-run-view')
  expect(await within(run).findByText('Unlock the shutter')).toBeInTheDocument()
  await user.click(within(run).getByRole('button', { name: 'Back to runs' }))
  expect(await screen.findByTestId('checklist-view')).toBeInTheDocument()
})

test('a checklist with no runs yet says so', async ({ admin }) => {
  await seedTables(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(decodeURIComponent(ENC))}/view/checklist`, admin)
  const view = await screen.findByTestId('checklist-view', {}, { timeout: 10_000 })
  expect(await within(view).findByText('No runs yet.')).toBeInTheDocument()
  expect(view).toHaveTextContent('0 runs')
})

test('runs on the same date are ordered by latest update rather than title', async ({ admin }) => {
  await seedTables(admin)
  for (const [title, date, updated] of [
    ['A older update', '2026-01-05', '2026-02-03T00:00:00Z'],
    ['Z newer update', '2026-01-05', '2026-02-04T00:00:00Z'],
    ['Later calendar day', '2026-01-06', '2026-02-01T00:00:00Z'],
    ['A older undated', null, '2026-02-05T00:00:00Z'],
    ['Z newer undated', null, '2026-02-06T00:00:00Z'],
  ]) {
    const saved = await admin.post<{ row_id: string }>('/api/save_row', {
      table: T, row: { run_title: title, run_date: date },
    })
    // Independent of transaction time: date ordering must beat update time,
    // while two runs on the same date must use update time as the tie-break.
    await sql`update featherbase.cr_opening set updated_at = ${updated} where row_id = ${saved.row_id}`
  }
  await renderApp(`/featherbase/admin/table/${tableSlug(decodeURIComponent(ENC))}/view/checklist`, admin)
  await waitFor(() => expect(screen.getAllByTestId('checklist-run-card')).toHaveLength(5))
  expect(screen.getAllByTestId('checklist-run-card').map((card) => card.textContent)).toEqual([
    'Later calendar day', 'Z newer update', 'A older update',
    'Z newer undated', 'A older undated',
  ])
})

test('a checklist without date or summary columns lists only titles in update order', async ({ admin }) => {
  await seedTables(admin)
  await admin.post('/api/table_def', {
    name: 'Cr Minimal',
    title_column: 'title',
    columns: [
      { column_name: 'title', label: 'Title', column_type: 'Data' },
      { column_name: 'steps', label: 'Steps', column_type: 'Sub-table', row_table: 'Cr Opening Step' },
    ],
  })
  for (const [title, updated] of [
    ['A older run', '2026-01-01T00:00:00Z'],
    ['Z newest run', '2026-01-03T00:00:00Z'],
    ['M middle run', '2026-01-02T00:00:00Z'],
  ]) {
    const saved = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Cr Minimal', row: { title },
    })
    await sql`update featherbase.cr_minimal set updated_at = ${updated} where row_id = ${saved.row_id}`
  }
  await renderApp('/featherbase/admin/table/cr-minimal/view/checklist', admin)
  await waitFor(() => expect(screen.getAllByTestId('checklist-run-card')).toHaveLength(3))
  expect(screen.getAllByTestId('checklist-run-card').map((card) => card.textContent)).toEqual([
    'Z newest run', 'M middle run', 'A older run',
  ])
  expect(screen.queryByText('Undated')).not.toBeInTheDocument()
})

test('an empty run displays zero progress without a completed bar', async ({ admin }) => {
  await seedTables(admin)
  const saved = await admin.post<{ row_id: string }>('/api/save_row', {
    table: T, row: { run_title: 'Awaiting steps', progress: '0/0', steps: [] },
  })
  await renderApp(`/featherbase/admin/table/${tableSlug(decodeURIComponent(ENC))}/view/checklist?run=${encodeURIComponent(saved.row_id)}`, admin)
  const view = await screen.findByTestId('checklist-run-view')
  expect(within(view).getByTestId('checklist-progress')).toHaveTextContent('0/0')
  expect(within(view).getByText('This run has no items.')).toBeInTheDocument()
  expect(within(view).queryByRole('checkbox')).not.toBeInTheDocument()
  const bar = view.querySelector('[style*="width"]')
  expect(bar).toHaveStyle({ width: '0%' })
  expect(bar).toHaveAttribute('style', expect.stringContaining('background: var(--color-action)'))
})

// #539: Today and Yesterday are the reader's own days, not UTC's: at 02:00 IST the UTC
// calendar is still on the day before.
test('day headings follow the reader\'s calendar, and an older day reads DD-Mon-YYYY', () => {
  const before = process.env.TZ
  process.env.TZ = 'Asia/Kolkata'
  try {
    const now = new Date('2026-10-26T20:30:00Z') // 27-Oct-2026 02:00 IST
    expect(dayLabel('2026-10-27', now)).toBe('Today')
    expect(dayLabel('2026-10-26', now)).toBe('Yesterday')
    expect(dayLabel('2026-10-25', now)).toBe('25-Oct-2026')
    expect(dayLabel('2026-01-05', now)).toBe('05-Jan-2026')
    expect(dayLabel('', now)).toBe('Undated')
  } finally {
    process.env.TZ = before
  }
})

test('a run opened with no connection saves nothing when its status is pressed', async ({ admin }) => {
  await seedTables(admin)
  const run = await admin.post<{ row_id: string }>('/api/save_row', { table: T, row: { run_title: 'Offline opening' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(T)}/view/checklist`, admin)
  await screen.findByTestId('checklist-run-card', {}, { timeout: 10_000 })
  // The connection drops: the run's own read waits for it to come back.
  onlineManager.setOnline(false)
  try {
    const saves = vi.spyOn(globalThis, 'fetch')
    await userEvent.click(screen.getByTestId('checklist-run-card'))
    await userEvent.click(await screen.findByTestId('checklist-submit'))
    expect(saves.mock.calls.filter(([input]) => String(input).includes('/api/save_row'))).toEqual([])
    expect(((await admin.get(`/api/table/${ENC}/${run.row_id}`)) as { stage: string | null }).stage).toBeNull()
  } finally {
    onlineManager.setOnline(true)
  }
})
