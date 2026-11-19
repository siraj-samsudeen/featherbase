// #1340: an app's facts drawn by Featherbase's own pages: the list's columns and Record actions, the record page's
// header line, chips and Links groups in the app's words and order, a tick list's notes, and an action's preview as an
// ordinary page. With no facts (the app refuses), the pages draw as they always did. Fixture: record-facts-fixture.ts.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { NOTE, NOTE_TAG, PREVIEW, hook, installFacts } from './record-facts-fixture'

configure({ asyncUtilTimeout: 10_000 })

const openRecord = async (admin: Parameters<typeof renderApp>[1]) => {
  const view = await renderApp(`${tableHref(NOTE)}/row/n1`, admin)
  await screen.findByTestId('record-header-line')
  return view
}

test("the list shows the app's columns after the Table's own: words, a pill for a toned fact, and a dash for none", async ({ admin }) => {
  await installFacts(admin)
  await renderApp(tableHref(NOTE), admin)
  expect(await screen.findByTestId('fact-col-people')).toHaveTextContent('People')
  const row = (await screen.findAllByTestId('fact-people'))[0]!.closest('tr')!
  expect(within(row).getByTestId('fact-people')).toHaveTextContent('15')
  expect(within(row).getByTestId('fact-state')).toHaveTextContent('Live')
  expect(within(row).getByTestId('fact-kind').querySelector('span')).toHaveTextContent('Plain')
  expect(within(row).getByTestId('fact-missing')).toHaveTextContent('—')
})

test('Record actions say each action in a line; one runs the app action in place and says it is done', async ({ admin }) => {
  await installFacts(admin)
  await renderApp(tableHref(NOTE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }))
  expect(screen.getByTestId('record-action-tidy')).toHaveTextContent('Tidy The NotesTidies every note. Running it again changes nothing.')
  fireEvent.click(screen.getByTestId('record-action-tidy'))
  expect(await screen.findByTestId('record-action-said')).toHaveTextContent('Tidy The Notes: done.')
  expect(hook().runs).toBe(1)
})

test("an action the app refuses says the app's own words", async ({ admin }) => {
  await installFacts(admin)
  hook().runFails = true
  await renderApp(tableHref(NOTE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }))
  fireEvent.click(screen.getByTestId('record-action-tidy'))
  expect(await screen.findByTestId('record-action-said')).toHaveTextContent('The notes are busy')
})

test('an action that opens a Featherbase page opens it in place: the preview of the action', async ({ admin }) => {
  await installFacts(admin)
  await renderApp(tableHref(NOTE), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }))
  expect(screen.getByTestId('record-action-away')).toHaveAttribute('href', '/barproof/')
  // A modified click is the browser's own (a new tab): left alone.
  fireEvent.click(screen.getByTestId('record-action-away'), { metaKey: true })
  fireEvent.click(screen.getByTestId('record-action-preview'))
  expect(await screen.findByTestId('action-preview-sentence')).toHaveTextContent('Tidies the note.')
})

test('with no facts (the app refuses this viewer), the list has no app columns and no Record actions', async ({ admin }) => {
  await installFacts(admin)
  hook().refuse = true
  await renderApp(tableHref(NOTE), admin)
  await screen.findByTestId('list-rows')
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTestId('fact-col-people')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Record actions' })).not.toBeInTheDocument()
})

test("the record page says the app's header line, and its chips carry the app's headings, its own group among them", async ({ admin }) => {
  await installFacts(admin)
  await openRecord(admin)
  expect(screen.getByTestId('record-header-line')).toHaveTextContent('Note · 15 people · from HR and by hand')
  const chips = await screen.findByRole('region', { name: 'Connections' })
  await waitFor(() => expect(within(chips).getByRole('button', { name: /What It Says/ })).toBeInTheDocument())
  expect(within(chips).getByRole('button', { name: /People/ })).toHaveTextContent('15')
  fireEvent.click(within(chips).getByRole('button', { name: /People/ }))
  expect(await screen.findByRole('region', { name: 'People' })).toHaveAttribute('data-testid', 'app-link-group')
})

// Verifier round 2: a jump chip counts what its group shows: the app's count, not rows it marks taken away.
test("a link group's jump chip counts as the app does", async ({ admin }) => {
  await installFacts(admin)
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n1', tag: 't2', removed: true } })
  await openRecord(admin)
  const chips = await screen.findByRole('region', { name: 'Connections' })
  await waitFor(() => expect(within(chips).getByRole('button', { name: /Tags It Has/ })).toHaveTextContent('1'))
})

test("the Links tab draws the app's groups in its order: a link group in its words, a tick list with notes, and its own group", async ({ admin }) => {
  await installFacts(admin)
  await openRecord(admin)
  fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
  const says = await screen.findByRole('region', { name: 'What It Says' })
  await waitFor(() => expect(within(says).getByTestId('app-line')).toHaveTextContent('The first line says this note Area'))
  expect(within(says).getByTestId('link-line-note')).toHaveTextContent('In the note')
  // A row the app gives no words for reads as it always did.
  expect(within(says).getByTestId('linked-row')).toHaveTextContent('Second')
  expect(within(says).getByTestId('app-group-link')).toHaveAttribute('href', '/featherbase/admin/table/barproof.line')
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Tags It Has' })).getAllByTestId('tick-note').map((n) => n.textContent)).toEqual(['Also on two other notes', 'On no other note']))
  const people = screen.getByRole('region', { name: 'People' })
  expect(within(people).getAllByTestId('app-line')).toHaveLength(10)
  expect(within(people).getAllByTestId('source-chip')[0]).toHaveTextContent('given by hand')
  expect(within(people).getByRole('link', { name: 'Open as list' })).toHaveAttribute('href', '/featherbase/admin/table/Person')
  fireEvent.click(within(people).getByTestId('app-group-fold'))
  expect(within(people).getAllByTestId('app-line')).toHaveLength(11)
  fireEvent.click(within(people).getByTestId('app-group-fold'))
  expect(within(people).getAllByTestId('app-line')).toHaveLength(10)
  expect(screen.getByRole('region', { name: 'Nobody Yet' })).toHaveTextContent('None yet')
  // In the app's order: its groups first, the rest after.
  const order = [...document.querySelectorAll('[data-testid="record-links"] section[aria-label]')].map((s) => s.getAttribute('aria-label'))
  expect(order.slice(0, 4)).toEqual(['What It Says', 'Tags It Has', 'People', 'Nobody Yet'])
})

// Verifier round 1 (blocker 1): a row naming no choice (it points elsewhere) cannot be ticked or counted.
test('a tick list whose rows come to include one naming no choice turns into a list, every row said as it is', async ({ admin }) => {
  await installFacts(admin)
  await openRecord(admin)
  fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
  const tags = () => screen.getByRole('region', { name: 'Tags It Has' })
  await waitFor(() => expect(within(tags()).getByRole('button', { name: 'Tick Later' })).toBeInTheDocument())
  // A link naming a line, not a tag, arrives (as a copied grant names a bundle, not a report); the next save reads the rows again.
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n1', line: 'l2' } })
  fireEvent.click(within(tags()).getByRole('button', { name: 'Tick Later' }))
  const add = within(tags()).queryByRole('button', { name: /^Add/ })
  if (add) fireEvent.click(add)
  await waitFor(() => expect(within(tags()).queryByTestId('tick-box')).not.toBeInTheDocument())
  expect(within(tags()).getAllByTestId('linked-row').length).toBeGreaterThanOrEqual(1)
})

// Codex round 3: a link the app marks taken away is history: not ticked, and ticking it again gives the same row back.
test('a link marked taken away is not ticked; ticking it again gives its row back, and unticking marks it rather than deleting it', async ({ admin }) => {
  await installFacts(admin)
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n1', tag: 't2', removed: true } })
  await openRecord(admin)
  fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
  const tags = () => screen.getByRole('region', { name: 'Tags It Has' })
  await waitFor(() => expect(within(tags()).getByRole('button', { name: 'Tick Later' })).toBeInTheDocument())
  expect(within(tags()).getByTestId('tick-count')).toHaveTextContent('1 of 2')
  fireEvent.click(within(tags()).getByRole('button', { name: 'Tick Later' }))
  // One click: the app asks for no field, so no form opens.
  expect(within(tags()).queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument()
  await waitFor(() => expect(within(tags()).getByTestId('tick-count')).toHaveTextContent('2 of 2'))
  expect(await sql`select removed from barproof.note_tag where tag = 't2'`).toEqual([{ removed: false }])
  fireEvent.click(await within(tags()).findByRole('button', { name: 'Untick Urgent' }))
  await waitFor(() => expect(within(tags()).getByTestId('tick-count')).toHaveTextContent('1 of 2'))
  expect(await sql`select removed from barproof.note_tag where tag = 't1'`).toEqual([{ removed: true }])
})

test('a list leaves out a row the app marks taken away', async ({ admin }) => {
  await installFacts(admin)
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n2', body: 'Second note' } })
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n2', line: 'l2' } })
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n2', line: 'l1', removed: true } })
  hook().facts = { version: 1, rows: { n2: { header: 'Note', groups: [{ key: 'tags', heading: 'Tags It Has', table: NOTE_TAG, removedColumn: 'removed' }] } } }
  await renderApp(`${tableHref(NOTE)}/row/n2`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Tags It Has' })).getAllByTestId('linked-row')).toHaveLength(1))
  expect(screen.getByRole('region', { name: 'Tags It Has' })).toHaveTextContent('Tags It Has 1')
})

test("a save on the record page reads the app's facts again", async ({ admin }) => {
  await installFacts(admin)
  await openRecord(admin)
  fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
  const tags = () => screen.getByRole('region', { name: 'Tags It Has' })
  await waitFor(() => expect(within(tags()).getByRole('button', { name: 'Tick Later' })).toBeInTheDocument())
  hook().facts = { version: 1, rows: { n1: { header: 'Note · 16 people · from HR and by hand' } } }
  fireEvent.click(within(tags()).getByRole('button', { name: 'Tick Later' }))
  const add = within(tags()).queryByRole('button', { name: /^Add/ })
  if (add) fireEvent.click(add)
  await waitFor(() => expect(screen.getByTestId('record-header-line')).toHaveTextContent('Note · 16 people'))
})

test("an own group past what the app sent says how many more, when it gives no page with them all", async ({ admin }) => {
  await installFacts(admin)
  hook().facts = { version: 1, rows: { n1: { header: 'Note', groups: [{ key: 'people', heading: 'People', count: 15,
    lines: Array.from({ length: 4 }, (_, i) => ({ parts: [`Person ${i + 1}`] })) }] } } }
  await openRecord(admin)
  fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
  const people = await screen.findByRole('region', { name: 'People' })
  expect(people).toHaveTextContent('and 11 more')
})

test('the preview page: path, title with Cancel and Run, the sentence, filters with counts, the rows and the note', async ({ admin }) => {
  await installFacts(admin)
  await renderApp(`${tableHref(NOTE)}/run/tidy`, admin)
  expect(await screen.findByTestId('action-preview-sentence')).toHaveTextContent('Tidies the note.')
  // #1340 (verifier round 3): the path starts at the Table's module, as its list and record do.
  expect(screen.getByTestId('page-header-breadcrumb').textContent).toMatch(/^\S.* \/ note \/ Tidy The Notes$/)
  expect(screen.getByTestId('page-header-status')).toHaveTextContent(PREVIEW.status)
  expect(screen.getByTestId('action-preview-cancel')).toHaveAttribute('href', tableHref(NOTE))
  const filters = screen.getByRole('group', { name: 'Show' })
  expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual(['All 2', 'Will be added 1', 'Already there 1'])
  expect(screen.getAllByTestId('action-preview-row')).toHaveLength(2)
  // A short column the app keeps on one line; the others wrap.
  expect([within(screen.getAllByTestId('action-preview-row')[0]).getByText('Will be added').closest('.whitespace-nowrap'), within(screen.getAllByTestId('action-preview-row')[0]).getByText('Kept').closest('.whitespace-nowrap')])
    .toEqual([expect.anything(), null])
  fireEvent.click(within(filters).getByRole('button', { name: 'Already there 1' }))
  expect(screen.getAllByTestId('action-preview-row')).toHaveLength(1)
  expect(screen.getByTestId('action-preview-row')).toHaveTextContent('Second')
  expect(screen.getByTestId('action-preview-note')).toHaveTextContent('Running this again adds nothing.')
  fireEvent.click(screen.getByTestId('action-preview-run'))
  expect(await screen.findByText(/Tidy The Notes: done\./)).toBeInTheDocument()
  expect(hook().runs).toBe(1)
})

// #1340 (verifier round 3): after Run the page says what happened, in the app's words, with the record that keeps the run.
test("after Run the preview says what the run did, a link to its record, and that the list now shows a second run", async ({ admin }) => {
  await installFacts(admin)
  hook().done = { said: ['1 added · 1 already there. ', { record: { table: NOTE, row: 'n1', name: 'Open the run' } }], run: 'n1' }
  await renderApp(`${tableHref(NOTE)}/run/tidy`, admin)
  await screen.findByTestId('action-preview-sentence')
  fireEvent.click(screen.getByTestId('action-preview-run'))
  const done = await screen.findByTestId('action-preview-done')
  expect(done).toHaveTextContent('Tidy The Notes: 1 added · 1 already there. Open the run')
  expect(within(done).getByRole('link', { name: 'Open the run' })).toHaveAttribute('href', expect.stringContaining('n1'))
  expect(screen.getByTestId('page-header-status')).toHaveTextContent('Done · the list now shows what running it again would do')
})

test("a preview with a refused run says the app's words; a filter with nothing in it says so", async ({ admin }) => {
  await installFacts(admin)
  hook().runFails = true
  hook().preview = { ...PREVIEW, rows: [PREVIEW.rows[0]] }
  await renderApp(`${tableHref(NOTE)}/run/tidy`, admin)
  await screen.findByTestId('action-preview-sentence')
  fireEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Already there 0' }))
  expect(screen.getByText('Nothing here')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('action-preview-run'))
  expect(await screen.findByText('The notes are busy')).toBeInTheDocument()
})

// Codex round 3: an app sending only the first lines of a long plan: counts are the whole plan's, and the page says so.
test('a preview of a long plan counts the whole plan and says it shows the first lines', async ({ admin }) => {
  await installFacts(admin)
  hook().preview = { ...PREVIEW, total: 900, filters: [{ key: 'add', label: 'Will be added', count: 600 }, { key: 'there', label: 'Already there', count: 300 }] }
  await renderApp(`${tableHref(NOTE)}/run/tidy`, admin)
  await screen.findByTestId('action-preview-sentence')
  expect(within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['All 900', 'Will be added 600', 'Already there 300'])
  expect(screen.getByTestId('action-preview-shown')).toHaveTextContent('Showing the first 2 of 900 lines; Run carries out all of them.')
})

test('a preview the page cannot draw is said, never half drawn', async ({ admin }) => {
  await installFacts(admin)
  hook().preview = { version: 1, title: 'Broken' }
  await renderApp(`${tableHref(NOTE)}/run/tidy`, admin)
  expect(await screen.findByText("The app's preview is not one this page can draw")).toBeInTheDocument()
  expect(screen.queryByTestId('action-preview-run')).not.toBeInTheDocument()
})
