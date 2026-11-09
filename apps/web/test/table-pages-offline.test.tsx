// A Table's pages when the network drops as they ask for the Table's details:
// with nothing read before, the page cannot open; with details read a while
// ago, it opens from them and each page says it cannot load the Table now.
import { QueryClient, onlineManager } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }
const TABLE = 'Tpo Shelf'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: TABLE, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
}

function networkDown() {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.includes(':meta')) throw new TypeError('Failed to fetch')
    return real(input, init)
  })
}

/** A client holding the Table's details as read two minutes ago. */
async function readEarlier(admin: Admin) {
  const meta = await admin.get(`/api/table/${encodeURIComponent(TABLE)}:meta`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  for (const key of [TABLE, 'tpo-shelf']) queryClient.setQueryData(['meta', key], meta, { updatedAt: Date.now() - 120_000 })
  return queryClient
}

test("a Table's page whose details the network drops on first opening says why it cannot open", async ({ admin }) => {
  await seed(admin)
  networkDown()
  await renderApp(tableHref(TABLE), admin)
  expect(await screen.findByRole('alert', {}, T)).toHaveTextContent('Failed to fetch')
})

test("with no connection, a list whose own details have not come yet makes no view everyone's default", async ({ admin }) => {
  await seed(admin)
  // Online once, so the page knows who is looking; then the connection drops
  // and the list's own read of the Table's details waits for it to return.
  const queryClient = await readEarlier(admin)
  const first = await renderApp(tableHref(TABLE), admin, { queryClient })
  await screen.findByTestId('list-columns', {}, T)
  first.unmount()
  queryClient.removeQueries({ queryKey: ['meta', TABLE] })
  onlineManager.setOnline(false)
  try {
    const sent = vi.spyOn(globalThis, 'fetch')
    await renderApp(tableHref(TABLE), admin, { queryClient })
    await userEvent.click(await screen.findByTestId('list-columns', {}, T))
    await userEvent.click(await screen.findByTestId('list-make-default', {}, T))
    expect(sent.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([])
  } finally {
    onlineManager.setOnline(true)
  }
})

test.for([
  ['report', `${tableHref(TABLE)}/view/report`, `Cannot load ${TABLE}`],
  ['merge', `${tableHref(TABLE)}/merge`, 'Could not load'],
  ['naming', `${tableHref(TABLE)}/naming`, 'Cannot load this Table'],
] as const)('the %s page, opened from details read earlier while the network is down, says it cannot load the Table', async ([, path, says], { admin }) => {
  await seed(admin)
  const queryClient = await readEarlier(admin)
  networkDown()
  await renderApp(path, admin, { queryClient })
  expect(await screen.findByText(says, {}, T)).toBeInTheDocument()
})
