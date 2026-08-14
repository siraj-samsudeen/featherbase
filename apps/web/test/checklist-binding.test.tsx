// What QUALIFIES as a checklist, tested at the component layer: real
// ListView / ChecklistView in jsdom, talking through the fetch bridge to the
// in-process server inside a rolled-back transaction.
//
// The binding is generic — it reads metadata, never model names — so its two
// failure modes are both about discovery: qualifying too eagerly (any Check
// column read as completion state) and giving up too early (only the first
// couple of Sub-table columns looked at). One test each.

import { screen, waitFor } from '@testing-library/react'
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
    await admin.post('/api/doctype', child)

  await admin.post('/api/doctype', {
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

  const run = await admin.post<{ row_id: string }>('/api/save_doc', {
    doctype: 'Third Sub Parent',
    doc: {
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
