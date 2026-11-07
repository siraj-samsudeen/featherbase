// #910 D5 / checklist 2: a link cell reads the linked row's name, then the
// code people use; a made-up id never shows, and a list's own title cell is
// the name alone.
import { configure, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, PROFIT, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

test("a profit centre's plant reads by its name, then its plant code", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(PROFIT), admin)
  const rows = await screen.findByTestId('list-rows')
  await waitFor(() => expect(within(rows).getAllByTestId('cell-plant')[0]).toHaveTextContent('Enchakkal Supermarket (1503)'))
})

test("a list's own title cell is the name alone", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(PLANT), admin)
  const rows = await screen.findByTestId('list-rows')
  await waitFor(() => expect(within(rows).getByRole('link', { name: 'Enchakkal Supermarket' })).toBeInTheDocument())
})

test('a link to a row with a made-up id shows no code', async ({ admin }) => {
  await seedSites(admin)
  await admin.post('/api/table_def', {
    name: 'Nv Audit', id_pattern: 'hash',
    columns: [
      { column_name: 'topic', column_type: 'Data', in_list_view: true },
      { column_name: 'centre', column_type: 'Reference', reference_table: PROFIT, in_list_view: true },
    ],
  })
  const centres = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(PROFIT)}?fields=${encodeURIComponent('["row_id"]')}`)
  await admin.post('/api/save_row', { table: 'Nv Audit', row: { topic: 'Stock', centre: centres.data[0].row_id } })
  await renderApp(tableHref('Nv Audit'), admin)
  const cell = await screen.findByTestId('cell-centre')
  await waitFor(() => expect(cell).toHaveTextContent(/^EKL - Retail \d\d$/))
})

test("a link cell never shows the linked row's id while its name is on its way", async ({ admin }) => {
  await seedSites(admin)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  const held = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('/api/row_titles')) await gate
    return real(input, init)
  })
  try {
    await renderApp(tableHref(PLANT), admin)
    const rows = await screen.findByTestId('list-rows')
    await waitFor(() => expect(within(rows).getAllByTestId('cell-site')).toHaveLength(4))
    for (const cell of within(rows).getAllByTestId('cell-site')) expect(cell).not.toHaveTextContent(/ENK|TCR/)
    release()
    await waitFor(() => expect(within(rows).getAllByTestId('cell-site')[0]).toHaveTextContent(/\((ENK|TCR)\)$/))
  } finally {
    release()
    held.mockRestore()
  }
})
