// #1237 (ticket-page items 13, 14 and 17): a record page names Tables as people
// read them, by label, never by internal name, and offers the app's own view of
// the row where the app has one.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { rowHref } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { test, expect, renderApp } from './pg-test'

afterEach(() => vi.restoreAllMocks())

type Admin = Parameters<typeof renderApp>[1]
const VISIT = 'rpl visit raw'
const NOTE = 'rpl note raw'
const T = { timeout: 10_000 }

/** Two Tables whose labels differ from their names, the way an app's Tables are
 *  installed (an app's manifest names "tickets.ticket" and labels it "Ticket"). */
async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: VISIT, id_pattern: 'prompt', title_column: 'place',
    columns: [{ column_name: 'place', column_type: 'Data', label: 'Place', in_list_view: true }] })
  await admin.post('/api/table_def', { name: NOTE, id_pattern: 'prompt',
    columns: [{ column_name: 'visit', column_type: 'Reference', reference_table: VISIT, label: 'Visit', in_list_view: true }] })
  await sql`update table_def set label = case name when ${VISIT} then 'Store visit' else 'Visit note' end where name in (${VISIT}, ${NOTE})`
  invalidateMeta()
  await admin.post('/api/save_row', { table: VISIT, row: { row_id: 'V1', place: 'Lakeside' } })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'N1', visit: 'V1' } })
}

test("the title, the breadcrumb and the related groups name Tables by their labels", async ({ admin }) => {
  await seed(admin)
  await renderApp(rowHref(VISIT, 'V1'), admin)
  expect(await screen.findByRole('heading', { level: 1, name: /^Store visit: Lakeside/ }, T)).toBeInTheDocument()
  expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Store visit')
  // The Map, the Tree and Recently opened still name Tables: their own issue.
  expect(screen.getByTestId('breadcrumbs')).not.toHaveTextContent(VISIT)
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(VISIT)
  const connections = await screen.findByRole('region', { name: 'Connections' }, T)
  await waitFor(() => expect(connections).toHaveTextContent('Visit note'), T)
  expect(connections).not.toHaveTextContent(NOTE)
})

test("a row whose app has its own page for it offers Open in that app; others do not", async ({ admin }) => {
  await seed(admin)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path === '/api/app_catalog')
      return Response.json([{ name: 'visits', title: 'Visits', href: '/visits/', recordPages: { [VISIT]: '/visits/?visit={row}' } }])
    return real(input, init)
  })
  await renderApp(rowHref(VISIT, 'V1'), admin)
  const open = await screen.findByTestId('open-in-app', {}, T)
  expect(open).toHaveTextContent('Open in Visits')
  expect(open).toHaveAttribute('href', '/visits/?visit=V1')

  await renderApp(rowHref(NOTE, 'N1'), admin)
  await screen.findAllByRole('heading', { level: 1 }, T)
  await new Promise((r) => setTimeout(r, 200))
  expect(within(document.body).getAllByTestId('open-in-app')).toHaveLength(1)
})
