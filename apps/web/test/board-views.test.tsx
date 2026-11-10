// Board, Calendar and Timeline views (spec: board-calendar-and-timeline-views). The drag
// gestures run here with the pointer's landing place stubbed (jsdom has no layout), so what
// is under test is what the page writes back to the server and what it shows afterwards.
import { tableSlug } from 'shared'
import { afterEach, vi } from 'vitest'
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

// The suite shares a busy machine with other runs: give each wait room.
configure({ asyncUtilTimeout: 10_000 })

type Admin = Parameters<typeof renderApp>[1]

const BOARD = 'Bv Deals'
const PLAIN = 'Bv Notes'
const SCHED = 'Bv Schedule'

const enc = encodeURIComponent
const rowOf = async (admin: Admin, table: string, id: string) =>
  (await admin.get(`/api/table/${enc(table)}/${enc(id)}`)) as Record<string, unknown>

// jsdom has no PointerEvent, so a pointer event carrying coordinates is built from a MouseEvent.
const pointer = (el: Element, type: string, clientX = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 0 }))

afterEach(() => {
  vi.restoreAllMocks()
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
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nWon\nLost' },
    ],
  })
  for (const [id, title, stage] of [['d1', 'Deal One', 'Open'], ['d2', 'Deal Two', 'Open'], ['d3', 'Deal Three', 'Won']])
    await admin.post('/api/save_row', { table: BOARD, row: { row_id: id, title, stage } })
}

test('Board: one column per choice, each with its cards and a count', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await screen.findByTestId('kanban-view')
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(3))
  expect(screen.getByTestId('kanban-count-Open')).toHaveTextContent('2')
  expect(screen.getByTestId('kanban-count-Won')).toHaveTextContent('1')
  expect(screen.getByTestId('kanban-count-Lost')).toHaveTextContent('0')
  expect(within(screen.getByTestId('kanban-column-Won')).getByText('Deal Three')).toBeInTheDocument()
})

test('Board: dragging a card into another column sets the row\'s value to that column', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(3))
  const card = document.querySelector('[data-card="d1"]') as HTMLElement
  fireEvent.pointerDown(card)
  landOn('kanban-column-Won')
  fireEvent.pointerUp(screen.getByTestId('kanban-view'))
  await waitFor(() => expect(within(screen.getByTestId('kanban-column-Won')).getAllByTestId('kanban-card')).toHaveLength(2))
  expect(within(screen.getByTestId('kanban-column-Open')).getAllByTestId('kanban-card')).toHaveLength(1)
  expect((await rowOf(admin, BOARD, 'd1')).stage).toBe('Won')
})

test('Board: dropping a card back where it started changes nothing', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(3))
  const before = (await rowOf(admin, BOARD, 'd1')).updated_at
  fireEvent.pointerDown(document.querySelector('[data-card="d1"]') as HTMLElement)
  landOn('kanban-column-Open')
  fireEvent.pointerUp(screen.getByTestId('kanban-view'))
  await new Promise((r) => setTimeout(r, 200))
  expect((await rowOf(admin, BOARD, 'd1')).updated_at).toBe(before)
})

test('Board: a table with no choice column says there is nothing to group by', async ({ admin }) => {
  await admin.post('/api/table_def', { name: PLAIN, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/table/${tableSlug(PLAIN)}/view/kanban`, admin)
  expect(await screen.findByTestId('kanban-no-select')).toHaveTextContent('no Choice column')
})

test('Board: a row whose value is not one of the choices still shows, in a column of its own', async ({ admin }) => {
  await seedBoard(admin)
  await admin.post('/api/save_row', { table: BOARD, row: { row_id: 'd4', title: 'Odd Deal', stage: '' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(4))
  expect(within(screen.getByTestId('kanban-column-empty')).getByText('Odd Deal')).toBeInTheDocument()
})

async function seedSchedule(admin: Admin) {
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
}
const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = (day: number) => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`
}

test('Calendar: a row shows on the day its date falls on, and dragging it to another day changes its date', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 's1', title: 'Kickoff', start_date: thisMonth(3), end_date: thisMonth(9) } })
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 'undated', title: 'Not scheduled' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`, admin)
  const from = await screen.findByTestId(`cal-cell-${thisMonth(3)}`)
  await waitFor(() => expect(within(from).getByText('Kickoff')).toBeInTheDocument())
  expect(screen.queryByText('Not scheduled')).not.toBeInTheDocument()
  const before = await rowOf(admin, SCHED, 's1')
  fireEvent.pointerDown(document.querySelector('[data-event="s1"]') as HTMLElement)
  landOn(`cal-cell-${thisMonth(3)}`)
  fireEvent.pointerUp(screen.getByTestId('calendar-view'))
  expect((await rowOf(admin, SCHED, 's1')).updated_at).toBe(before.updated_at)

  fireEvent.pointerDown(document.querySelector('[data-event="s1"]') as HTMLElement)
  landOn(`cal-cell-${thisMonth(5)}`)
  fireEvent.pointerUp(screen.getByTestId('calendar-view'))
  await waitFor(() => expect(within(screen.getByTestId(`cal-cell-${thisMonth(5)}`)).getByText('Kickoff')).toBeInTheDocument())
  expect(within(screen.getByTestId(`cal-cell-${thisMonth(3)}`)).queryByText('Kickoff')).not.toBeInTheDocument()
  expect(String((await rowOf(admin, SCHED, 's1')).start_date).slice(0, 10)).toBe(thisMonth(5))
})

test('Calendar: months can be paged, and a table with no date column says so', async ({ admin }) => {
  await admin.post('/api/table_def', { name: PLAIN, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/table/${tableSlug(PLAIN)}/view/calendar`, admin)
  expect(await screen.findByTestId('calendar-no-date')).toHaveTextContent('no Date column')
})

test('Calendar: next and previous month page the grid', async ({ admin }) => {
  await seedSchedule(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`, admin)
  const month = await screen.findByTestId('cal-month')
  const first = month.textContent
  fireEvent.click(screen.getByTestId('cal-next'))
  await waitFor(() => expect(screen.getByTestId('cal-month').textContent).not.toBe(first))
  fireEvent.click(screen.getByTestId('cal-prev'))
  await waitFor(() => expect(screen.getByTestId('cal-month').textContent).toBe(first))
})

// From the deleted e2e/calendar.spec.ts (UI-021): the calendar is reached from
// the list's View menu, and its header keeps the Table's name and a way back.
const pathOf = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('Calendar: the View menu of the list opens the calendar', async ({ admin }) => {
  await seedSchedule(admin)
  const app = await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}`, admin)
  fireEvent.click(await screen.findByRole('button', { name: 'View: List' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Calendar' }))
  expect(await screen.findByTestId('calendar-view')).toBeInTheDocument()
  expect(pathOf(app)).toBe(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`)
})

test('Calendar: the header names the Table, and its List view link goes back to the list', async ({ admin }) => {
  await seedSchedule(admin)
  const app = await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`, admin)
  const heading = await screen.findByRole('heading', { level: 1 })
  expect(heading.textContent).toBe(`${SCHED} — Calendar`)
  fireEvent.click(screen.getByTestId('cal-to-list'))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  expect(pathOf(app)).toBe(`/featherbase/admin/table/${tableSlug(SCHED)}`)
})

test('Calendar: the next month shows the rows dated in it', async ({ admin }) => {
  await seedSchedule(admin)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 20)
  const nextDay = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-20`
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 'n1', title: 'Stocktake', start_date: nextDay, end_date: nextDay } })
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 'n2', title: 'Kickoff', start_date: thisMonth(15), end_date: thisMonth(15) } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`, admin)
  await waitFor(() => expect(within(screen.getByTestId(`cal-cell-${thisMonth(15)}`)).getByText('Kickoff')).toBeInTheDocument())
  expect(screen.queryByText('Stocktake')).not.toBeInTheDocument()
  const first = screen.getByTestId('cal-month').textContent

  fireEvent.click(screen.getByTestId('cal-next'))
  await waitFor(() => expect(screen.getByTestId('cal-month').textContent).not.toBe(first))
  expect(screen.getByTestId('cal-month')).toHaveTextContent(String(next.getFullYear()))
  await waitFor(() => expect(within(screen.getByTestId(`cal-cell-${nextDay}`)).getByText('Stocktake')).toBeInTheDocument())
  expect(screen.queryByText('Kickoff')).not.toBeInTheDocument()
})

test('Timeline: each row is a bar from its first date to its second; a row missing a date has no bar', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 't1', title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' } })
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 't2', title: 'Undated', start_date: '2026-03-02' } })
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 'reversed', title: 'Reversed dates', start_date: '2026-03-04', end_date: '2026-03-01' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/gantt`, admin)
  const bar = await screen.findByTestId('gantt-bar-t1')
  expect(bar).toHaveAttribute('data-start', '2026-03-02')
  expect(bar).toHaveAttribute('data-end', '2026-03-05')
  expect(bar).toHaveAttribute('data-days', '4')
  expect(screen.queryByTestId('gantt-bar-t2')).not.toBeInTheDocument()
  expect(screen.getByTestId('gantt-bar-reversed')).toHaveAttribute('data-days', '1')
  expect(screen.getByTestId('gantt-bar-reversed')).toHaveAttribute('data-end', '2026-03-04')
})

test('Timeline: moving the pointer over the chart without holding a bar end changes nothing', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 't1', title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/gantt`, admin)
  const bar = await screen.findByTestId('gantt-bar-t1')
  pointer(screen.getByTestId('gantt-view'), 'pointermove', 400)
  expect(bar).toHaveAttribute('data-end', '2026-03-05')
})

test('Timeline: dragging a bar\'s end three days later moves the row\'s second date, never before the first', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 't1', title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/gantt`, admin)
  const handle = await screen.findByTestId('gantt-resize-t1')
  const before = await rowOf(admin, SCHED, 't1')
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  pointer(handle, 'pointerdown', 100)
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  expect((await rowOf(admin, SCHED, 't1')).updated_at).toBe(before.updated_at)
  pointer(handle, 'pointerdown', 100)
  pointer(screen.getByTestId('gantt-view'), 'pointermove', 100 + 3 * 40)
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  await waitFor(async () => expect(String((await rowOf(admin, SCHED, 't1')).end_date).slice(0, 10)).toBe('2026-03-08'))
  await waitFor(() => expect(screen.getByTestId('gantt-bar-t1')).toHaveAttribute('data-end', '2026-03-08'))

  // Dragged far to the left, the end stops at the start day.
  pointer(screen.getByTestId('gantt-resize-t1'), 'pointerdown', 500)
  pointer(screen.getByTestId('gantt-view'), 'pointermove', 500 - 20 * 40)
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  await waitFor(async () => expect(String((await rowOf(admin, SCHED, 't1')).end_date).slice(0, 10)).toBe('2026-03-02'))
})

/** The network drops every save from here on; reads still answer. */
function dropSaves() {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    init?.method === 'PATCH' ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init))
}

test('Board: a move the network drops says the move failed', async ({ admin }) => {
  await seedBoard(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await waitFor(() => expect(screen.getAllByTestId('kanban-card')).toHaveLength(3))
  dropSaves()
  fireEvent.pointerDown(document.querySelector('[data-card="d1"]') as HTMLElement)
  landOn('kanban-column-Won')
  fireEvent.pointerUp(screen.getByTestId('kanban-view'))
  expect(await screen.findByText('Move failed')).toBeInTheDocument()
})

test('Calendar: a move the network drops says the move failed', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 's1', title: 'Kickoff', start_date: thisMonth(3) } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/calendar`, admin)
  await waitFor(() => expect(within(screen.getByTestId(`cal-cell-${thisMonth(3)}`)).getByText('Kickoff')).toBeInTheDocument())
  dropSaves()
  fireEvent.pointerDown(document.querySelector('[data-event="s1"]') as HTMLElement)
  landOn(`cal-cell-${thisMonth(5)}`)
  fireEvent.pointerUp(screen.getByTestId('calendar-view'))
  expect(await screen.findByText('Move failed')).toBeInTheDocument()
})

test('Timeline: a resize the network drops says the resize failed', async ({ admin }) => {
  await seedSchedule(admin)
  await admin.post('/api/save_row', { table: SCHED, row: { row_id: 't1', title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(SCHED)}/view/gantt`, admin)
  const handle = await screen.findByTestId('gantt-resize-t1')
  dropSaves()
  pointer(handle, 'pointerdown', 100)
  pointer(screen.getByTestId('gantt-view'), 'pointermove', 100 + 3 * 40)
  pointer(screen.getByTestId('gantt-view'), 'pointerup')
  expect(await screen.findByText('Resize failed')).toBeInTheDocument()
})

test('Timeline: a table without two date columns says so', async ({ admin }) => {
  await admin.post('/api/table_def', { name: PLAIN, columns: [{ column_name: 'due', column_type: 'Date' }] })
  await renderApp(`/featherbase/admin/table/${tableSlug(PLAIN)}/view/gantt`, admin)
  expect(await screen.findByTestId('gantt-no-dates')).toHaveTextContent('two Date columns')
})

test('Board: with two choice columns the user picks which one the board follows', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: BOARD, id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nWon' },
      { column_name: 'priority', column_type: 'Choice', choices: 'High\nLow' },
    ],
  })
  await admin.post('/api/save_row', { table: BOARD, row: { row_id: 'd1', title: 'Deal One', stage: 'Open', priority: 'High' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`, admin)
  await screen.findByTestId('kanban-column-Open')
  fireEvent.change(screen.getByTestId('kanban-groupby'), { target: { value: 'priority' } })
  await waitFor(() => expect(within(screen.getByTestId('kanban-column-High')).getByText('Deal One')).toBeInTheDocument())
  expect(screen.queryByTestId('kanban-column-Open')).not.toBeInTheDocument()
})

// Moved from e2e/kanban.spec.ts (#1080): the Board is reached from the list.
test('Board: the list\'s view menu opens the Board', async ({ admin }) => {
  await seedBoard(admin)
  const { router } = await renderApp(`/featherbase/admin/table/${tableSlug(BOARD)}`, admin)
  fireEvent.click(await screen.findByRole('button', { name: 'View: List' }))
  fireEvent.click(await screen.findByTestId('open-kanban'))
  await screen.findByTestId('kanban-view')
  await waitFor(() => expect(within(screen.getByTestId('kanban-column-Open')).getAllByTestId('kanban-card')).toHaveLength(2))
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(`/featherbase/admin/table/${tableSlug(BOARD)}/view/kanban`)
})
