// RT-001/002/003: an open page hears about changes as they happen, with no
// reload. The server's fan-out to two live sockets, and who may subscribe to
// what, is apps/server/test/realtime.test.ts. Here the in-process server's
// real events reach the rendered page through realtime-bridge.ts; the change
// comes from another client of the same server, as a second session's would.
import { tableSlug } from 'shared'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { bridgeRealtime } from './realtime-bridge'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Rt DT'
const enc = encodeURIComponent
const live = () => JSON.parse(document.documentElement.dataset.realtimeChannels ?? '[]') as string[]

let bridge: ReturnType<typeof bridgeRealtime> | undefined
afterEach(() => {
  // Signed out first: a socket closed while a token is stored schedules a
  // reconnect a second later, after jsdom is gone (#1135).
  localStorage.clear()
  bridge?.()
  bridge = undefined
  vi.unstubAllGlobals()
})

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table/Metadata%20Override', { row_id: `rt-${DT}-discussion`, table_name: DT, property: 'enable_discussion', value: 'true' })
}

test('RT-001: a row created elsewhere appears in an open list with no reload', async ({ admin }) => {
  await seed(admin)
  bridge = bridgeRealtime()
  await renderApp(`/featherbase/admin/table/${enc(tableSlug(DT))}`, admin)
  await screen.findByTestId('list-total', {}, { timeout: 8000 })
  await waitFor(() => expect(live()).toContain(`list:${DT}`))

  await admin.post(`/api/table/${enc(DT)}`, { row_id: 'rt-live', title: 'rt-live' })
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('rt-live'), { timeout: 8000 })
})

test('RT-001: a lost connection clears the live subscriptions, and reconnecting restores them without a reload', async ({ admin }) => {
  await seed(admin)
  bridge = bridgeRealtime()
  await renderApp(`/featherbase/admin/table/${enc(tableSlug(DT))}`, admin)
  await screen.findByTestId('list-total', {}, { timeout: 8000 })
  await waitFor(() => expect(live()).toContain(`list:${DT}`))

  bridge.cut()
  expect(live()).toEqual([])
  await waitFor(() => expect(live()).toContain(`list:${DT}`), { timeout: 5000 })
  await admin.post(`/api/table/${enc(DT)}`, { row_id: 'rt-after-reconnect', title: 'rt-after-reconnect' })
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('rt-after-reconnect'), { timeout: 8000 })
})

test('RT-001: the home feed shows a newly recorded row visit with no reload', async ({ admin }) => {
  await seed(admin)
  await admin.post(`/api/table/${enc(DT)}`, { row_id: 'rt-visited', title: 'rt-visited' })
  bridge = bridgeRealtime()
  await renderApp('/featherbase/admin', admin)
  const feed = await screen.findByTestId('activity-feed', {}, { timeout: 8000 })
  await waitFor(() => expect(live()).toContain(`user:${admin.user}`))
  await waitFor(() => expect(feed).not.toHaveTextContent('Loading…'))
  expect(feed).not.toHaveTextContent('rt-visited')

  await admin.post('/api/events', {
    events: [{ kind: 'row', key: `row:${DT}/rt-visited`, label: 'rt-visited', sub: DT, path: `/featherbase/admin/table/${enc(tableSlug(DT))}/row/rt-visited` }],
  })
  await waitFor(() => expect(screen.getByTestId('activity-feed')).toHaveTextContent('rt-visited'), { timeout: 8000 })
})

test('RT-002: a save elsewhere shows a refresh banner on the open row, and Refresh pulls the new value', async ({ admin }) => {
  await seed(admin)
  const row = await admin.post<{ row_id: string; updated_at: string }>(`/api/table/${enc(DT)}`, { row_id: 'rt-doc', title: 'before' })
  bridge = bridgeRealtime()
  await renderApp(`/featherbase/admin/table/${enc(tableSlug(DT))}/row/rt-doc`, admin)
  await waitFor(() => expect(document.querySelector('[data-field=title]')).toHaveValue('before'), { timeout: 8000 })
  await waitFor(() => expect(live()).toContain(`row:${DT}:rt-doc`))
  expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument()

  await admin.post('/api/save_row', { table: DT, row: { ...row, title: 'after' } })
  expect(await screen.findByTestId('stale-banner', {}, { timeout: 8000 })).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('stale-refresh'))
  await waitFor(() => expect(document.querySelector('[data-field=title]')).toHaveValue('after'))
})

test('RT-002: the page that saved shows no refresh banner for its own save', async ({ admin }) => {
  await seed(admin)
  await admin.post(`/api/table/${enc(DT)}`, { row_id: 'rt-own', title: 'before' })
  const events: string[] = []
  bridge = bridgeRealtime()
  const { onEvent } = await import('server/src/realtime')
  const unlisten = onEvent((e) => { if (e.channel === `row:${DT}:rt-own`) events.push(e.event) })
  try {
    const user = userEvent.setup()
    await renderApp(`/featherbase/admin/table/${enc(tableSlug(DT))}/row/rt-own`, admin)
    const title = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field=title]')
      expect(el).toHaveValue('before')
      return el!
    }, { timeout: 8000 })
    await waitFor(() => expect(live()).toContain(`row:${DT}:rt-own`))
    await user.clear(title)
    await user.type(title, 'after')
    await user.click(screen.getByTestId('form-save'))
    expect(await screen.findByTestId('form-banner')).toHaveTextContent('Saved')
    // The update did go out on the row's channel; the page ignores its own.
    await waitFor(() => expect(events).toContain('updated'))
    expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument()
  } finally {
    unlisten()
  }
})

test('RT-003: an @mention shows the mentioned person an unread count with no reload', async ({ admin, createUser }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Rt Admin Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Rt Admin Reader', operation: 'read' } })
  const other = await createUser({ email: 'rt-user@x.com', roles: ['Rt Admin Reader'] })
  const person = await admin.get<Record<string, unknown>>(`/api/table/Person/${other.user}`)
  await admin.post('/api/save_row', { table: 'Person', row: { ...person, username: 'rt.user' } })
  await admin.post(`/api/table/${enc(DT)}`, { row_id: 'rt-mention', title: 'discuss' })

  bridge = bridgeRealtime()
  await renderApp('/featherbase/admin', other)
  await screen.findByTestId('session-user', {}, { timeout: 8000 })
  await waitFor(() => expect(live()).toContain(`user:${other.user}`))
  expect(screen.queryByTestId('unread-count')).not.toBeInTheDocument()

  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: DT, ref_name: 'rt-mention', content: 'ping @rt.user ' } })
  const badge = await screen.findByTestId('unread-count', {}, { timeout: 8000 })
  expect(badge.textContent).toMatch(/[1-9]/)
})
