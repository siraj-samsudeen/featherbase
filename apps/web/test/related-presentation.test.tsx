import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { RelatedTabs } from '../src/components/ConnectionsPanel'
import type { Connection } from '../src/lib/connections'
import type { TableMeta } from '../src/lib/meta'

const state = vi.hoisted(() => ({ meta: undefined as TableMeta | undefined, connections: undefined as { connections: Connection[] } | undefined }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('../src/lib/meta', () => ({
  useMeta: (table: string) => table === 'Venue'
    ? { data: state.meta }
    : { data: { columns: [] }, isLoading: false },
  listColumns: () => [{ column_name: 'row_id', column_type: 'Data', label: 'Name' }],
}))
vi.mock('../src/lib/connections', () => ({
  useConnections: () => ({ data: state.connections }),
  connectionLabel: (c: Connection) => c.table,
}))
vi.mock('../src/lib/api', () => ({ listResource: async () => ({ data: [], total: 0 }) }))
vi.mock('../src/lib/settings', () => ({ useSettings: () => ({}), formatValue: () => '' }))
vi.mock('../src/components/Peek', () => ({ usePeek: () => ({ available: false }) }))
vi.mock('../src/lib/row-titles', () => ({ RowTitle: ({ rowId }: { rowId: string }) => rowId }))

const connections: Connection[] = [
  { table: 'Counter', column: 'venue', via: null, count: 2, filters: [] },
  { table: 'Receipts', column: 'venue', via: null, count: 3, filters: [] },
]
const metadata = (column = 'venue') => ({ browse_presentation: { preferred_related: { table: 'Counter', column } } }) as TableMeta
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = (name = 'One') => <QueryClientProvider client={client}><RelatedTabs table="Venue" name={name} /></QueryClientProvider>
  return { ...render(view()), view }
}
beforeEach(() => { state.meta = undefined; state.connections = undefined })

test('connections can arrive before metadata; the matching relation opens when metadata arrives', async () => {
  state.connections = { connections }
  const { rerender, view } = mount()
  expect(screen.getByTestId('related-tab-Counter')).toHaveAttribute('aria-expanded', 'false')
  state.meta = metadata()
  rerender(view())
  await waitFor(() => expect(screen.getByTestId('related-tab-Counter')).toHaveAttribute('aria-expanded', 'true'))
})

test('metadata can arrive before connections, and a closed panel stays closed after refresh', async () => {
  state.meta = metadata()
  const { rerender, view } = mount()
  state.connections = { connections }
  rerender(view())
  const tab = await screen.findByTestId('related-tab-Counter')
  expect(tab).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(tab)
  state.connections = { connections: connections.map((c) => ({ ...c, count: c.count + 1 })) }
  state.meta = metadata()
  rerender(view())
  await waitFor(() => expect(tab).toHaveAttribute('aria-expanded', 'false'))
})

test('a choice before metadata arrives is preserved, and another row gets its own default', async () => {
  state.connections = { connections }
  const { rerender, view } = mount()
  fireEvent.click(screen.getByTestId('related-tab-Receipts'))
  state.meta = metadata()
  rerender(view())
  expect(screen.getByTestId('related-tab-Receipts')).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('related-tab-Counter')).toHaveAttribute('aria-expanded', 'false')
  rerender(view('Two'))
  await waitFor(() => expect(screen.getByTestId('related-tab-Counter')).toHaveAttribute('aria-expanded', 'true'))
})

test('a different reference column or via relation never matches the preferred direct relation', () => {
  state.meta = metadata('other_venue')
  state.connections = { connections: [...connections, { ...connections[0], column: 'other_venue', via: 'Lines' }] }
  mount()
  for (const tab of screen.getAllByTestId('related-tab-Counter')) expect(tab).toHaveAttribute('aria-expanded', 'false')
})
