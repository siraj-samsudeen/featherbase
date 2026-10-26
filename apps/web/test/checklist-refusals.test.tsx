// Working a checklist run when things go wrong, and the two run gestures no
// other test makes. Gaps the merged web coverage report (ADR 0012) showed: a
// run that cannot be opened, a note saved by leaving the box rather than
// pressing Enter, the camera button opening the picker, and a photo the
// server refuses. Each refusal is a real server answer.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { installApp } from 'server/src/apps'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

type Admin = Parameters<typeof renderApp>[1]

afterEach(() => vi.unstubAllGlobals())

async function seedRun(admin: Admin): Promise<string> {
  const [have] = await sql`select 1 from table_def where name = 'Checklist Run'`
  if (!have) await installApp('checklists')
  const templates = (await admin.get(
    '/api/table/Checklist%20Template?fields=%5B%22row_id%22%5D&limit_page_length=1',
  )) as { data: { row_id: string }[] }
  const run = (await admin.post('/api/save_row', {
    table: 'Checklist Run',
    row: { template: templates.data[0].row_id, store: 'ATK', section: 'Kurti', team_leader: 'Component TL' },
  })) as { row_id: string }
  return run.row_id
}

const runPath = (run: string) => `/featherbase/admin/Checklist%20Run/view/checklist?run=${encodeURIComponent(run)}`

async function openRun(admin: Admin, run: string) {
  await renderApp(runPath(run), admin)
  await screen.findByTestId('checklist-run-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(screen.getAllByTestId('checklist-item')).toHaveLength(8))
}

test('a run that does not exist says so, and Back returns to the runs', async ({ admin }) => {
  const user = userEvent.setup()
  await seedRun(admin)
  await renderApp(runPath('no-such-run'), admin)
  expect(await screen.findByText(/not found/i, {}, { timeout: 10_000 })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByTestId('checklist-view')).toBeInTheDocument()
})

test('a note is saved when the person leaves the box, without pressing Enter', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  const item = () => screen.getAllByTestId('checklist-item')[3]
  await user.click(within(item()).getByTestId('checklist-add-note'))
  await user.type(within(item()).getByTestId('checklist-note-input'), 'Shutter stuck')
  fireEvent.blur(within(item()).getByTestId('checklist-note-input'))
  await waitFor(() => expect(item()).toHaveTextContent('Note: Shutter stuck'))
  const doc = (await admin.get(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)) as { items: { note: string | null }[] }
  expect(doc.items.map((i) => i.note)).toContain('Shutter stuck')
})

test('the camera button opens the picker; a photo the server refuses offers a retry', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  // Not every item asks for a photo; take the first that does.
  const add = screen.getAllByTestId('checklist-photo-add')[0]
  const input = screen.getAllByTestId('checklist-photo-input')[0]
  let opened = 0
  input.addEventListener('click', () => opened++)
  await user.click(add)
  expect(opened).toBe(1)

  // The run is deleted meanwhile, so the item the photo hangs on is gone.
  await admin.delete(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)
  await useNodeMultipart()
  fireEvent.change(input, { target: { files: [pickedFile('shelf.jpg', 'jpeg bytes', 'image/jpeg')] } })
  await waitFor(() => expect(screen.getAllByTestId('checklist-photo-add')[0]).toHaveTextContent('📷 Retry'))
  const [stored] = await sql`select count(*)::int as n from file where file_name = 'shelf.jpg'`
  expect(stored.n).toBe(0)
})
