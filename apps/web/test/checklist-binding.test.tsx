// What QUALIFIES as a checklist and how a run is WORKED, tested at the
// component layer: real ListView / ChecklistView in jsdom, talking through the
// fetch bridge to the in-process server inside a rolled-back transaction.
//
// The binding is generic — it reads metadata, never model names — so its two
// failure modes are both about discovery: qualifying too eagerly (any Check
// column read as completion state) and giving up too early (only the first
// couple of Sub-table columns looked at). One test each.
//
// The run lifecycle below came down from e2e/checklist.spec.ts (#223 batch 1),
// which had to seed two runs and delete them in an afterAll because a
// submitted run is final and its commits outlived the browser. Rollback makes
// each test's run its own. What stayed in e2e is the half jsdom genuinely
// cannot judge: a camera upload's rendered thumbnail and the phone-width
// layout, which need real image decoding and a real box model.

import { screen, waitFor, within } from '@testing-library/react'
import { installApp } from 'server/src/apps'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

async function installChecklists() {
  const [have] = await sql`select 1 from table_def where name = 'Checklist Run'`
  if (!have) await installApp('checklists')
}

const subTable = (name: string, columns: Record<string, unknown>[]) => ({
  name,
  module: 'Custom',
  kind: 'sub_table',
  columns,
})

const dataCol = (column_name: string) => ({ column_name, label: column_name, column_type: 'Data' })
const checkCol = (column_name: string) => ({ column_name, label: column_name, column_type: 'Check' })

// A Table qualifies on the row table's `done` Check — wherever the Sub-table
// column that holds it happens to sit. Here it is the THIRD of three, and
// the two ahead of it are checklist-shaped in every way except the binding
// itself, so a resolver that stops early binds nothing at all.
test('discovery reaches a checklist in the third Sub-table, past two near-misses', async ({
  admin,
}) => {
  for (const child of [
    subTable('Third Sub Attachment', [dataCol('caption')]),
    subTable('Third Sub Approval', [dataCol('approver'), checkCol('mandatory')]),
    subTable('Third Sub Step', [dataCol('item_label'), checkCol('done')]),
  ])
    await admin.post('/api/table_def', child)

  await admin.post('/api/table_def', {
    name: 'Third Sub Parent',
    module: 'Custom',
    title_column: 'run_title',
    columns: [
      dataCol('run_title'),
      { column_name: 'attachments', label: 'Attachments', column_type: 'Sub-table', row_table: 'Third Sub Attachment' },
      { column_name: 'approvals', label: 'Approvals', column_type: 'Sub-table', row_table: 'Third Sub Approval' },
      { column_name: 'steps', label: 'Steps', column_type: 'Sub-table', row_table: 'Third Sub Step' },
    ],
  })

  const run = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Third Sub Parent',
    row: {
      run_title: 'Runs from the third sub-table',
      approvals: [{ approver: 'not a checklist item' }],
      steps: [{ item_label: 'Unlock the shutter' }],
    },
  })

  // The switcher offers it…
  await renderApp('/admin/Third%20Sub%20Parent', admin)
  expect(await screen.findByTestId('open-checklist')).toBeInTheDocument()

  // …and the run pane binds `steps`, the one carrying `done` — not the
  // near-miss ahead of it, and not nothing at all.
  await renderApp(
    `/admin/Third%20Sub%20Parent/view/checklist?run=${encodeURIComponent(run.row_id)}`,
    admin,
  )
  expect(await screen.findByText('Unlock the shutter')).toBeInTheDocument()
  expect(screen.queryByText('not a checklist item')).not.toBeInTheDocument()
})

// Checklist Template Item carries must_do and photo_proof but no `done`: it
// describes the standard rather than executing it. Binding "the first Check"
// turned the shipped template into a tappable checklist whose ticks silently
// rewrote which items were mandatory.
test('the shipped Checklist Template is a standard, not a runnable checklist', async ({ admin }) => {
  await installChecklists()

  await renderApp('/admin/Checklist%20Template', admin)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(screen.queryByTestId('open-checklist')).not.toBeInTheDocument())

  // Reached directly, the view says so rather than rendering must_do as
  // completion state.
  await renderApp('/admin/Checklist%20Template/view/checklist', admin)
  expect(await screen.findByTestId('checklist-no-shape')).toBeInTheDocument()

  // The run, by contrast, still qualifies.
  await renderApp('/admin/Checklist%20Run', admin)
  expect(await screen.findByTestId('open-checklist')).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// Working a run: tick → gate → submit → locked.
// ---------------------------------------------------------------------------

type Admin = Parameters<typeof renderApp>[1]

/** Seed a run off the app's own fixture template — the template-snapshot hook
 *  fills in the items, so the test only supplies the scope. */
async function seedRun(admin: Admin, section: string) {
  await installChecklists()
  const templates = (await admin.get(
    '/api/table/Checklist%20Template?fields=%5B%22row_id%22%5D&limit_page_length=1',
  )) as { data: { row_id: string }[] }
  const template = templates.data[0]?.row_id
  expect(template).toMatch(/\S/)
  const run = (await admin.post('/api/save_row', {
    table: 'Checklist Run',
    row: { template, store: 'ATK', section, team_leader: 'Component TL' },
  })) as { row_id: string }
  return run.row_id
}

async function openRun(admin: Admin, run: string) {
  await renderApp(`/admin/Checklist%20Run/view/checklist?run=${encodeURIComponent(run)}`, admin)
  await screen.findByTestId('checklist-run-view')
  await waitFor(() => expect(screen.getAllByTestId('checklist-item')).toHaveLength(8))
}

const tick = (i: number) =>
  within(screen.getAllByTestId('checklist-item')[i]).getByRole('checkbox').click()

// The fixture template's must-do items sit at 0, 1, 2, 5 and 7.
const MUST_DO = [0, 1, 2, 5, 7]

test('ticking an item saves it immediately and moves the progress count', async ({ admin }) => {
  const run = await seedRun(admin, 'Kurti')
  await openRun(admin, run)
  expect(screen.getByTestId('checklist-progress')).toHaveTextContent('0/8')

  tick(0)
  await waitFor(() => expect(screen.getByTestId('checklist-progress')).toHaveTextContent('1/8'))
  expect(screen.getAllByTestId('checklist-item')[0]).toHaveTextContent('✓')

  // Not just local state: the row's sub-table carries the tick.
  const doc = (await admin.get(
    `/api/table/Checklist%20Run/${encodeURIComponent(run)}`,
  )) as { items: { done: boolean }[] }
  expect(doc.items.filter((i) => i.done)).toHaveLength(1)
})

test('submitting with must-do items open surfaces the server gate verbatim', async ({ admin }) => {
  const run = await seedRun(admin, 'Kurti')
  await openRun(admin, run)
  tick(0)
  await waitFor(() => expect(screen.getByTestId('checklist-progress')).toHaveTextContent('1/8'))

  screen.getByTestId('checklist-submit').click()
  expect(await screen.findByTestId('checklist-error')).toHaveTextContent('must-do')
  // The refusal left the run open, not half-submitted.
  expect(screen.queryByTestId('checklist-locked')).not.toBeInTheDocument()
})

test('a submitted run is final — no ticking, no submitting, no adding', async ({ admin }) => {
  const run = await seedRun(admin, 'Kurti')
  await openRun(admin, run)

  for (const [n, i] of MUST_DO.entries()) {
    tick(i)
    await waitFor(() =>
      expect(screen.getByTestId('checklist-progress')).toHaveTextContent(`${n + 1}/8`),
    )
  }
  screen.getByTestId('checklist-submit').click()

  expect(await screen.findByTestId('checklist-locked')).toHaveTextContent(/final/)
  expect(within(screen.getAllByTestId('checklist-item')[0]).getByRole('checkbox')).toBeDisabled()
  expect(screen.queryByTestId('checklist-submit')).not.toBeInTheDocument()
  expect(screen.queryByTestId('checklist-photo-add')).not.toBeInTheDocument()
  expect(screen.queryByTestId('checklist-add-note')).not.toBeInTheDocument()
})
