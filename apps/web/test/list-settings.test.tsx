// UI-013: a customized list stays customized. Hiding a column and choosing a
// sort are stored per user on the server (PUT /api/user_settings/:table), and
// the ListView reads them back on mount — which is why the customization
// outlives the page that made it. Pushed down from e2e/list-settings.spec.ts
// (#223 batch 1); the spec proved "outlives" by logging out and back in, but
// the durable thing is the server row, and a fresh mount reads it through the
// same code path a fresh login would.
//
// Three claims, one test each: the hidden column leaves the header, the sort
// reorders the rows, and both survive a mount that starts from nothing.
//
// Every test ends by waiting for the settings PUT to arrive. That is not
// belt-and-braces: ListView queues it without awaiting the write in the event handler, so a test that
// returns without waiting lets the request execute AFTER its sandbox
// transaction ended — committing for real, and handing the next test (and
// the developer's database) a pre-customized list. `settledSettings` keeps
// the write inside the transaction, where rollback can undo it.

import { tableSlug } from 'shared'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { setSession } from '../src/lib/api'
import { test, expect, renderApp } from './pg-test'

const DT = 'Ls Settings'

type Admin = Parameters<typeof renderApp>[1]
type Stored = { settings: { sort: { field: string; dir: string } | null; hiddenCols: string[] } }

async function seedList(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
      { column_name: 'rank', column_type: 'Int', label: 'Rank', in_list_view: true },
    ],
  })
  for (const [title, city, rank] of [
    ['alpha', 'NYC', 3],
    ['bravo', 'LA', 1],
    ['charlie', 'SF', 2],
  ] as [string, string, number][])
    await admin.post('/api/save_row', { table: DT, row: { title, city, rank } })
}

/** Mount the list and wait for its rows — settings load on mount, so every
 *  assertion below has to come after this resolves. */
async function openList(admin: Admin) {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, admin)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(screen.getByTestId('col-title')).toBeInTheDocument())
  await waitFor(() =>
    expect(within(screen.getByTestId('list-rows')).getByText('alpha')).toBeInTheDocument(),
  )
}

/** Wait until the server row matches `want`, and return it. */
async function settledSettings(admin: Admin, want: Stored['settings']): Promise<Stored> {
  let stored!: Stored
  await waitFor(async () => {
    stored = (await admin.get(`/api/user_settings/${encodeURIComponent(DT)}`)) as Stored
    expect(stored.settings).toMatchObject(want)
  })
  return stored
}

const firstRowText = () => screen.getByTestId('list-rows').querySelector('tr')?.textContent ?? ''

async function hideCity() {
  screen.getByTestId('list-columns').click()
  ;(await screen.findByTestId('list-col-toggle-city')).click()
  await waitFor(() => expect(screen.queryByTestId('col-city')).not.toBeInTheDocument())
}

test('unchecking a column in the picker removes its header', async ({ admin }) => {
  await seedList(admin)
  await openList(admin)

  expect(screen.getByTestId('col-city')).toBeInTheDocument()
  await hideCity()
  expect(screen.getByTestId('col-title')).toBeInTheDocument()

  await settledSettings(admin, { sort: null, hiddenCols: ['city'] })
  screen.getByTestId('list-col-toggle-city').click()
  await waitFor(() => expect(screen.getByTestId('col-city')).toBeInTheDocument())
  await settledSettings(admin, { sort: null, hiddenCols: [] })
})

test('a click before saved settings arrive cannot overwrite the saved configuration', async ({ admin }) => {
  await seedList(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: [] })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  const delayed = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    if (String(input).includes(`/api/user_settings/${encodeURIComponent(DT)}`) && (!init?.method || init.method === 'GET')) await gate
    return response
  })
  try {
    await openList(admin)
    screen.getByTestId('col-rank').click()
    await waitFor(() => expect(firstRowText()).toContain('bravo'))
    release()
    await waitFor(() => expect(firstRowText()).toContain('alpha'))
    await settledSettings(admin, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: [] })
  } finally {
    release()
    delayed.mockRestore()
  }
})

test('clicking a column header sorts the rows by it, ascending first', async ({ admin }) => {
  await seedList(admin)
  await openList(admin)

  screen.getByTestId('col-rank').click()
  // rank asc puts bravo (1) on top, ahead of charlie (2) and alpha (3).
  await waitFor(() => expect(firstRowText()).toContain('bravo'))

  await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: [] })
  screen.getByTestId('col-rank').click()
  await waitFor(() => expect(firstRowText()).toContain('alpha'))
  await settledSettings(admin, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: [] })
  screen.getByTestId('col-rank').click()
  await waitFor(() => expect(firstRowText()).toContain('bravo'))
  expect(screen.getByTestId('col-rank')).toHaveTextContent('↑')
  await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: [] })
})

test('a fresh mount restores the hidden column and the sort from the server', async ({
  admin,
}) => {
  await seedList(admin)
  await openList(admin)

  await hideCity()
  screen.getByTestId('col-rank').click()
  await waitFor(() => expect(firstRowText()).toContain('bravo'))

  // The customization reached the server, not just this component's state.
  await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: ['city'] })

  // Throw the whole tree away — new mount, new QueryClient, nothing carried
  // over but the token — and the list comes back customized.
  cleanup()
  await openList(admin)
  expect(screen.queryByTestId('col-city')).not.toBeInTheDocument()
  expect(screen.getByTestId('col-title')).toBeInTheDocument()
  await waitFor(() => expect(firstRowText()).toContain('bravo'))
})

test('rapid list customizations persist the newest snapshot when an earlier request is delayed', async ({ admin }) => {
  await seedList(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent(DT)}`, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: [] })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let firstFinished!: () => void
  const firstDone = new Promise<void>(resolve => { firstFinished = resolve })
  let newerStarted = false
  let newerFinished!: () => void
  const newerDone = new Promise<void>(resolve => { newerFinished = resolve })
  const real = globalThis.fetch
  const delayed = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes(`/api/user_settings/${encodeURIComponent(DT)}`) && init?.method === 'PUT') {
      const settings = JSON.parse(String(init.body)) as Stored['settings']
      if (settings.sort?.dir === 'desc' && settings.hiddenCols.includes('city')) {
        await gate
        try { return await real(input, init) } finally { firstFinished() }
      }
      if (settings.sort?.dir === 'asc') {
        newerStarted = true
        try { return await real(input, init) } finally { newerFinished() }
      }
    }
    return real(input, init)
  })
  try {
    await openList(admin)
    // The restored arrow proves initial settings have arrived before either
    // edit. Responses are real; only the first write's dispatch is held.
    await waitFor(() => expect(screen.getByTestId('col-rank')).toHaveTextContent('↓'))
    await hideCity()
    screen.getByTestId('col-rank').click()
    await waitFor(() => expect(firstRowText()).toContain('bravo'))
    // A serialized writer will not start its second request yet. For an
    // overlapping writer, let that newer write commit before releasing the
    // older one, reproducing the destructive request order deterministically.
    if (newerStarted) await newerDone
    release()
    await firstDone
    await settledSettings(admin, { sort: { field: 'rank', dir: 'asc' }, hiddenCols: ['city'] })
    cleanup()
    await openList(admin)
    expect(screen.queryByTestId('col-city')).not.toBeInTheDocument()
    await waitFor(() => expect(firstRowText()).toContain('bravo'))
  } finally {
    release()
    delayed.mockRestore()
  }
})


test('queued list customizations do not write into a subsequent sign-in', async ({ admin, createUser }) => {
  await seedList(admin)
  const nextPerson = await createUser({ email: 'list.next@example.test', roles: ['System Manager'] })
  const settingsPath = `/api/user_settings/${encodeURIComponent(DT)}`
  const untouched = { sort: { field: 'title', dir: 'desc' }, hiddenCols: ['rank'] }
  await nextPerson.put(settingsPath, untouched)
  await admin.put(settingsPath, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: [] })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let firstFinished!: () => void
  const firstDone = new Promise<void>(resolve => { firstFinished = resolve })
  let firstStarted = false
  let laterWrites = 0
  const real = globalThis.fetch
  const delayed = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes(settingsPath) && init?.method === 'PUT') {
      if (!firstStarted) {
        firstStarted = true
        await gate
        try { return await real(input, init) } finally { firstFinished() }
      }
      laterWrites++
    }
    return real(input, init)
  })
  try {
    await openList(admin)
    await waitFor(() => expect(screen.getByTestId('col-rank')).toHaveTextContent('↓'))
    await hideCity()
    await waitFor(() => expect(firstStarted).toBe(true))
    screen.getByTestId('col-rank').click()
    await waitFor(() => expect(firstRowText()).toContain('bravo'))
    setSession(nextPerson.token!, { row_id: nextPerson.user!, email: null, full_name: null })
    release()
    await firstDone
    await settledSettings(admin, { sort: { field: 'rank', dir: 'desc' }, hiddenCols: ['city'] })
    expect(laterWrites).toBe(0)
    expect((await nextPerson.get(settingsPath) as Stored).settings).toMatchObject(untouched)
  } finally {
    release()
    delayed.mockRestore()
  }
})
