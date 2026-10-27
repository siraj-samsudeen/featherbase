// Board, Calendar and Timeline when a drag cannot be saved, and when the press
// lands on a card's title link rather than the card. Gaps the merged web
// coverage report (ADR 0012) showed. The refusal is real: the row was deleted
// by someone else between the page loading and the drop. Pointer landing
// places are stubbed as in board-views.test.tsx (jsdom has no layout).
import { afterEach } from 'vitest'
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const BOARD = 'Brf Deals'
const SCHED = 'Brf Schedule'

const pointer = (el: Element, type: string, clientX = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0 }))

afterEach(() => {
  // @ts-expect-error jsdom has no elementFromPoint; the tests that need one install it
  delete document.elementFromPoint
})
function landOn(testid: string) {
  document.elementFromPoint = () => screen.getByTestId(testid)
}

async function seedBoard(admin: Admin) {
  await admin.post('/api/table_def', {
    name: BOARD,
    id_pattern: 'prompt',
    title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nWon' },
    ],
  })
  await admin.post('/api/save_row', { table: BOARD, row: { row_id: 'd1', title: 'Deal One', stage: 'Open' } })
}

async function seedSchedule(admin: Admin, row: Record<string, unknown>) {
  await admin.post('/api/table_def', {
    name: SCHED,
    id_pattern: 'prompt',
    title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'start_date', column_type: 'Date' },
      { column_name: 'end_date', column_type: 'Date' },
    ],
  })
  await admin.post('/api/save_row', { table: SCHED, row })
}

const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = (day: number) => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`
}

test('Board: a card dropped after someone else deleted its row says why it did not move', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/${enc(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(1))
  await admin.delete(`/api/table/${enc(BOARD)}/d1`)
  fireEvent.pointerDown(document.querySelector('[data-card="d1"]') as HTMLElement)
  landOn('kanban-column-Won')
  fireEvent.pointerUp(screen.getByTestId('kanban-view'))
  expect(await screen.findByTestId('kanban-error')).toHaveTextContent(/not found/i)
})

test('Board: pressing a card\'s title link does not pick the card up', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/${enc(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(1))
  const before = ((await admin.get(`/api/table/${enc(BOARD)}/d1`)) as { updated_at: string }).updated_at
  fireEvent.pointerDown(within(screen.getByTestId('kanban-card')).getByRole('link', { name: 'Deal One' }))
  landOn('kanban-column-Won')
  fireEvent.pointerUp(screen.getByTestId('kanban-view'))
  await new Promise((r) => setTimeout(r, 200))
  expect(within(screen.getByTestId('kanban-column-Open')).getByText('Deal One')).toBeInTheDocument()
  expect(((await admin.get(`/api/table/${enc(BOARD)}/d1`)) as { updated_at: string }).updated_at).toBe(before)
})

test('Calendar: an event dropped after someone else deleted its row says why it did not move', async ({ admin }) => {
  await seedSchedule(admin, { row_id: 's1', title: 'Kickoff', start_date: thisMonth(3) })
  await renderApp(`/featherbase/admin/${enc(SCHED)}/view/calendar`, admin)
  await waitFor(() => expect(within(screen.getByTestId(`cal-cell-${thisMonth(3)}`)).getByText('Kickoff')).toBeInTheDocument())
  await admin.delete(`/api/table/${enc(SCHED)}/s1`)
  fireEvent.pointerDown(document.querySelector('[data-event="s1"]') as HTMLElement)
  landOn(`cal-cell-${thisMonth(5)}`)
  fireEvent.pointerUp(screen.getByTestId('calendar-view'))
  expect(await screen.findByTestId('calendar-error')).toHaveTextContent(/not found/i)
})

test('Calendar: pressing an event\'s title link does not pick the event up', async ({ admin }) => {
  await seedSchedule(admin, { row_id: 's1', title: 'Kickoff', start_date: thisMonth(3) })
  await renderApp(`/featherbase/admin/${enc(SCHED)}/view/calendar`, admin)
  const from = await screen.findByTestId(`cal-cell-${thisMonth(3)}`)
  fireEvent.pointerDown(await within(from).findByRole('link', { name: 'Kickoff' }))
  landOn(`cal-cell-${thisMonth(5)}`)
  fireEvent.pointerUp(screen.getByTestId('calendar-view'))
  await new Promise((r) => setTimeout(r, 200))
  expect(within(screen.getByTestId(`cal-cell-${thisMonth(3)}`)).getByText('Kickoff')).toBeInTheDocument()
  expect(String(((await admin.get(`/api/table/${enc(SCHED)}/s1`)) as { start_date: string }).start_date).slice(0, 10)).toBe(thisMonth(3))
})

test('Timeline: a bar resized after someone else deleted its row says why it did not change', async ({ admin }) => {
  await seedSchedule(admin, { row_id: 't1', title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' })
  await renderApp(`/featherbase/admin/${enc(SCHED)}/view/gantt`, admin)
  const handle = await screen.findByTestId('gantt-resize-t1')
  await admin.delete(`/api/table/${enc(SCHED)}/t1`)
  pointer(handle, 'pointerdown', 100)
  pointer(screen.getByTestId('gantt-view'), 'pointermove', 100 + 3 * 40)
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  expect(await screen.findByTestId('gantt-error')).toHaveTextContent(/not found/i)
})
