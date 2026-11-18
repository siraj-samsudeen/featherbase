// #1282 Why mode on the record Map (E1, E6–E8; checklist "Slice B" on #1282). An
// installed app explains a record of a Table it declares in its manifest's `why`;
// the Map offers "Neighbours | <label>" only where the server says this viewer may
// have this record explained, and draws the checked answer as columns of boxes.
// Fixture: a copy of test-apps/fixtures/bar-proof with a `why` for its notes.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tableHref } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
const NOTE = 'barproof.note'
const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

const directories: string[] = []
const hook = () => ((globalThis as unknown as { __why1282?: { answer: unknown; asked: unknown[]; may?: boolean } }).__why1282 ??= { answer: null, asked: [] })
afterEach(async () => {
  hook().answer = null
  delete hook().may
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A floor manager's access, as an app would explain it. */
const ACCESS = {
  version: 1,
  columns: [
    { heading: 'Person', boxes: [{ id: 'p', name: 'The note', record: { table: NOTE, row: 'n1' } }] },
    { heading: 'Business Role · Area', boxes: [
      { id: 'fm', name: 'Floor Manager', detail: 'Store C · First floor', source: 'hr' },
      { id: 'buyer', name: 'Buyer', detail: 'Kids Ethnic', source: 'hand' },
    ] },
    { heading: 'App · Level', boxes: [{ id: 'dash', name: 'Dash · Reader' }, { id: 'tasker', name: 'Tasker · Manager' }] },
    { heading: 'What They Can Do', boxes: [{ id: 'view', name: 'View reports', reach: 'Area' }, { id: 'hidden', name: 'Secret', record: { table: 'Person', row: 'psn_nobody_anyone_may_read' } }] },
  ],
  edges: [['p', 'fm'], ['p', 'buyer'], ['fm', 'dash'], ['buyer', 'dash'], ['fm', 'tasker'], ['dash', 'view']],
}

async function install(admin: Client, label?: string) {
  const directory = await mkdtemp(resolve('test/.why-1282-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader', 'Bar Explainer']
  manifest.reads.operations = { ...manifest.reads.operations, may_explain: tableRead, explain: tableRead }
  manifest.why = { [NOTE]: { explain: 'explain', may: 'may_explain', ...(label ? { label } : {}) } }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const why = (globalThis.__why1282 ??= { answer: null, asked: [] })
reads.may_explain = ({ roles }) => why.may !== false && (roles.includes('Bar Explainer') || roles.includes('System Manager'))
reads.explain = () => why.answer
`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'kept' } })
  hook().answer = ACCESS
}

async function openMap(client: Client) {
  const view = await renderApp(`${tableHref(NOTE)}/row/n1`, client)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  await screen.findByTestId('relation-map')
  return view
}

const toggle = () => screen.findByRole('group', { name: 'Map view' })
const showWhy = async (label = 'Why: Access') => fireEvent.click(within(await toggle()).getByRole('button', { name: label }))
const boxNamed = (name: string) => screen.getAllByTestId('why-box').find((b) => b.textContent?.includes(name))!

test('Why is offered beside Neighbours, which is on, with the label the app gives', async ({ admin }) => {
  await install(admin, 'Why: Her Access')
  await openMap(admin)
  const group = await toggle()
  expect(within(group).getByRole('button', { name: 'Neighbours' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(group).getByRole('button', { name: 'Why: Her Access' })).toHaveAttribute('aria-pressed', 'false')
})

test('someone the app does not let explain sees no toggle, only the neighbours', async ({ admin }) => {
  await install(admin)
  hook().may = false
  await openMap(admin)
  await screen.findByTestId('map-center')
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByRole('group', { name: 'Map view' })).not.toBeInTheDocument()
})

test('a record no app explains has no toggle', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Why Plain', id_pattern: 'prompt', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Why Plain', row: { row_id: 'p1', title: 'Plain' } })
  await renderApp(`${tableHref('Why Plain')}/row/p1`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  await screen.findByTestId('map-center')
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByRole('group', { name: 'Map view' })).not.toBeInTheDocument()
})

test('Why draws the chain in columns: roles say HR or by hand, permissions their reach, records are links', async ({ admin }) => {
  await install(admin)
  await openMap(admin)
  await showWhy()
  await waitFor(() => expect(screen.getAllByTestId('why-box')).toHaveLength(7))
  const map = screen.getByTestId('why-map')
  expect(within(map).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Person', 'Business Role · Area', 'App · Level', 'What They Can Do'])
  expect(boxNamed('Floor Manager')).toHaveTextContent('Store C · First floor · HR')
  expect(boxNamed('Buyer')).toHaveTextContent('Kids Ethnic · by hand')
  expect(within(boxNamed('View reports')).getByTestId('why-reach')).toHaveTextContent('Area')
  expect(within(boxNamed('The note')).getByRole('link', { name: 'The note' })).toHaveAttribute('href', expect.stringContaining('/row/n1'))
  // A record the viewer may not read is named neutrally, with nothing to open (the server scrubbed it).
  expect(map).not.toHaveTextContent('Secret')
  expect(within(boxNamed('A row you cannot see')).queryByRole('link')).not.toBeInTheDocument()
  // Back to the neighbours, on the same record.
  fireEvent.click(within(await toggle()).getByRole('button', { name: 'Neighbours' }))
  expect(await screen.findByTestId('relation-map')).toBeInTheDocument()
})

test('clicking a box lights every chain that leads to it, back to the person; clicking again clears it', async ({ admin }) => {
  await install(admin)
  await openMap(admin)
  await showWhy()
  await waitFor(() => expect(screen.getAllByTestId('why-box')).toHaveLength(7))
  const lit = () => screen.getAllByTestId('why-box').filter((b) => b.dataset.lit === 'true').map((b) => b.dataset.whyBox).sort()
  fireEvent.click(boxNamed('Dash · Reader'))
  expect(lit()).toEqual(['buyer', 'dash', 'fm', 'p'])
  fireEvent.click(boxNamed('Dash · Reader'))
  expect(lit()).toEqual([])
  // A click on a record's link opens it rather than lighting.
  fireEvent.click(boxNamed('View reports'))
  expect(lit()).toEqual(['buyer', 'dash', 'fm', 'p', 'view'])
})

test('every box is reached by its Show Chain button, which Enter or Space presses', async ({ admin }) => {
  await install(admin)
  await openMap(admin)
  await showWhy()
  await waitFor(() => expect(screen.getAllByTestId('why-box')).toHaveLength(7))
  const button = within(boxNamed('Tasker · Manager')).getByRole('button', { name: 'Show the chain to Tasker · Manager' })
  expect(button.tagName).toBe('BUTTON')
  fireEvent.click(button)
  expect(boxNamed('Tasker · Manager')).toHaveAttribute('data-lit', 'true')
  expect(boxNamed('Floor Manager')).toHaveAttribute('data-lit', 'true')
  expect(boxNamed('Buyer')).not.toHaveAttribute('data-lit')
  expect(within(boxNamed('Tasker · Manager')).getByRole('button', { name: 'Hide the chain to Tasker · Manager' })).toHaveAttribute('aria-pressed', 'true')
})

test("an answer the server will not pass shows Can't explain this right now, never a half-drawn map", async ({ admin }) => {
  await install(admin)
  hook().answer = { version: 1, columns: [{ heading: 'A', boxes: [{ id: 'a', name: 'A' }] }], edges: [['a', 'missing']] }
  await openMap(admin)
  await showWhy()
  expect(await screen.findByText("Can't explain this right now")).toBeInTheDocument()
  expect(screen.queryAllByTestId('why-box')).toHaveLength(0)
})

test('the chain lines join each box to the next, measured where the boxes fall, the lit ones in colour', async ({ admin }) => {
  await install(admin)
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const columnOf: Record<string, number> = { p: 0, fm: 1, buyer: 1, dash: 2, tasker: 2, view: 3, hidden: 3 }
  const placed = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id = this.getAttribute('data-why-box')
    return id ? rect(columnOf[id]! * 300, 100, 200, 60) : rect(0, 0, 1200, 400)
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  try {
    await openMap(admin)
    await showWhy()
    await waitFor(() => expect([...screen.getByTestId('why-edges').querySelectorAll('path')].map((p) => p.getAttribute('d'))).toHaveLength(6))
    expect(screen.getByTestId('why-edges').querySelector('path')!.getAttribute('d')).toBe('M200 130 C 250 130, 250 130, 300 130')
    fireEvent.click(boxNamed('View reports'))
    expect(screen.getByTestId('why-edges').querySelectorAll('path[data-lit="true"]')).toHaveLength(5)
  } finally {
    placed.mockRestore()
    vi.unstubAllGlobals()
  }
})
