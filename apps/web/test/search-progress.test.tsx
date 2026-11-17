// #1265: Search or Command shows its work. The search's answer is a stream the
// test controls, so each moment (searching, a slow group, done) is checked as
// a person sees it.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

/** A controllable /api/search: lines are sent when the test says, per query. */
function fakeSearch() {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
  const opened = new Map<string, () => void>()
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = new URL(String(url), 'http://localhost')
    if (u.pathname !== '/api/search') return real(url, init)
    const q = u.searchParams.get('q') ?? ''
    const body = new ReadableStream<Uint8Array>({ start(c) { streams.set(q, c); opened.get(q)?.() } })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
  })
  const enc = new TextEncoder()
  return {
    asked: (q: string) => new Promise<void>((resolve) => (streams.has(q) ? resolve() : opened.set(q, resolve))),
    send: async (q: string, line: unknown) => {
      await act(async () => { streams.get(q)!.enqueue(enc.encode(JSON.stringify(line) + '\n')) })
    },
    end: async (q: string) => { await act(async () => { streams.get(q)!.close() }) },
    restore: () => spy.mockRestore(),
  }
}

const GROUPS = [{ table: 'Person', label: 'Person' }, { table: 'Job Assignment', label: 'Job Assignment' }, { table: 'tickets.ticket', label: 'Ticket' }]

async function openBar(admin: Parameters<typeof renderApp>[1], text: string) {
  await renderApp('/featherbase/admin', admin)
  const bar = await screen.findByLabelText('Search or type a command', {}, { timeout: 8000 })
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: text } })
  return bar
}

test('the bar shows it is searching, group by group, and names a slow group', async ({ admin }) => {
  const search = fakeSearch()
  try {
    await openBar(admin, 'Mohammad')
    // 1. Go To and Actions answer before the server does; the line runs at once.
    expect(await screen.findByTestId('search-progress')).toHaveTextContent('Searching people, records and tables…')
    await search.asked('Mohammad')
    await search.send('Mohammad', { groups: GROUPS })
    // 3. Each group still on its way shows quiet rows.
    await waitFor(() => expect(screen.getAllByTestId('search-group-pending')).toHaveLength(3))
    await search.send('Mohammad', { table: 'Person', hits: [{ table: 'Person', row_id: 'psn_aaaaaaaaaaaaaaaaaaaa', title: 'Mohammad Rafi' }] })
    await search.send('Mohammad', { table: 'tickets.ticket', hits: [] })
    await waitFor(() => expect(screen.getAllByTestId('search-group-pending')).toHaveLength(1))
    const row = screen.getByTestId('awesomebar-doc')
    // 6, 7. The name, then the Table's label; never an id, never "row in".
    expect(row).toHaveTextContent('Mohammad Rafi')
    expect(within(row).getByTestId('awesomebar-doc-table')).toHaveTextContent('Person')
    expect(row.textContent).not.toMatch(/psn_|row in/)
    // 4. After 1.5s the wait names what is still coming.
    await waitFor(() => expect(screen.getByTestId('search-progress-text')).toHaveTextContent('Still searching Job Assignment…'), { timeout: 3000 })
    // 9. Under reduced motion the running line is hidden; the words stay.
    expect(screen.getByTestId('search-progress').firstElementChild).toHaveClass('motion-reduce:hidden')
    await search.send('Mohammad', { table: 'Job Assignment', hits: [] })
    await search.send('Mohammad', { done: true })
    await search.end('Mohammad')
    // 2. The line stops when the search ends; empty groups are gone.
    await waitFor(() => expect(screen.queryByTestId('search-progress')).not.toBeInTheDocument())
    expect(screen.queryAllByTestId('search-group-pending')).toHaveLength(0)
    expect(screen.getAllByTestId('awesomebar-doc')).toHaveLength(1)
  } finally {
    search.restore()
  }
})

test('nothing anywhere says so, with a hint', async ({ admin }) => {
  const search = fakeSearch()
  try {
    await openBar(admin, 'zqxjkv')
    await search.asked('zqxjkv')
    await search.send('zqxjkv', { groups: GROUPS.slice(0, 1) })
    await search.send('zqxjkv', { table: 'Person', hits: [] })
    await search.send('zqxjkv', { done: true })
    await search.end('zqxjkv')
    // 5.
    expect(await screen.findByTestId('search-no-match')).toHaveTextContent('No matches for “zqxjkv”')
    expect(screen.getByTestId('search-no-match')).toHaveTextContent('Try part of the name, or a code.')
  } finally {
    search.restore()
  }
})

test('an older answer that arrives late never replaces the newer one', async ({ admin }) => {
  const search = fakeSearch()
  try {
    const bar = await openBar(admin, 'Moh')
    await search.asked('Moh')
    fireEvent.change(bar, { target: { value: 'Mohammad' } })
    await search.asked('Mohammad')
    await search.send('Mohammad', { groups: GROUPS.slice(0, 1) })
    await search.send('Mohammad', { table: 'Person', hits: [{ table: 'Person', row_id: 'p-1', title: 'Mohammad Rafi' }] })
    await search.send('Mohammad', { done: true })
    await waitFor(() => expect(screen.getByTestId('awesomebar-doc')).toHaveTextContent('Mohammad Rafi'))
    // 8. The old request was aborted; anything it still says changes nothing.
    await search.send('Moh', { groups: GROUPS.slice(0, 1) }).catch(() => {})
    await search.send('Moh', { table: 'Person', hits: [{ table: 'Person', row_id: 'p-2', title: 'Mohan Stale' }] }).catch(() => {})
    await new Promise((done) => setTimeout(done, 200))
    expect(screen.getAllByTestId('awesomebar-doc')).toHaveLength(1)
    expect(screen.getByTestId('awesomebar-doc')).toHaveTextContent('Mohammad Rafi')
  } finally {
    search.restore()
  }
})
