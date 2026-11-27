// #1409 (issue points 11 to 15): the line under the top bar that says a page's
// figures are sample data. The platform draws it, in the shared bar over an
// app's own page and in the Admin shell, from the header the real server puts
// on an answer that carried stand-in rows. The app is the Store Sales fixture,
// its page's own script run unchanged (store-sales-page.ts); its warehouse is
// made-up rows.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { buildSnapshot } from 'server/src/dataset-snapshot'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import { READ, TARGETS, WAREHOUSE_TARGETS, loadTargets, storeSales, useWarehouse, warehouseTargets } from 'server/test/stand-in-fixture'
import { fmtDayIST } from 'shared'
import { DATASETS_PATH } from '../src/lib/stand-in-mark'
import { test, expect } from './pg-test'
import { loadStoreSales, openStoreSales, pageTable, useStandInMark } from './store-sales-page'

useWarehouse()
useStandInMark()

const T = { timeout: 8000 }
const SALES_CSV = ['store,business_day,amount,units', 'N1,2026-11-26,100,1', ''].join('\n')
const today = () => fmtDayIST(new Date())

/** Store Sales with `sales` from the warehouse and `targets` a stand-in. */
async function standingIn(admin: TestClient, createUser: Parameters<typeof storeSales>[1], more: Record<string, unknown> = { note: 'From the planning workbook', expected_by: '2026-12-15' }) {
  const { reader } = await storeSales(admin, createUser)
  expect(await buildSnapshot('storesales.sales')).toMatchObject({ status: 'activated' })
  await loadTargets(admin, more)
  return reader
}

describe("over an app's own page", () => {
  test('a page that received stand-in rows carries one line naming the stand-in, its load day, its expected day and its note (points 11, 12, 13)', async ({ admin, createUser }) => {
    const bar = await openStoreSales(await standingIn(admin, createUser))
    const line = await bar.findByTestId('stand-in-line', {}, T)
    expect(line).toHaveAttribute('role', 'status')
    expect(line).toHaveTextContent(`Sample data: targets is a stand-in, loaded ${today()}. Real data expected by 15-Dec-2026. From the planning workbook`)
    expect(within(line).getAllByTestId('stand-in')).toHaveLength(1)
    expect(line).not.toHaveTextContent('sales')
    // The app drew its own tables; the line is the platform's, in the bar.
    expect(pageTable('targets')).toHaveLength(3)
    expect(pageTable('sales')).toHaveLength(2)
    expect(document.getElementById('store-sales-page')).not.toHaveTextContent('Sample data')
  })

  test('a stand-in with no expected day and no note says only that it is one', async ({ admin, createUser }) => {
    const bar = await openStoreSales(await standingIn(admin, createUser, {}))
    expect((await bar.findByTestId('stand-in-line', {}, T)).textContent).toBe(`Sample data: targets is a stand-in, loaded ${today()}.`)
  })

  test('a page that received no stand-in rows carries no line (point 11)', async ({ admin, createUser }) => {
    const bar = await openStoreSales(await standingIn(admin, createUser), '/storesales/?only=sales')
    await bar.findByTestId('top-bar-name', {}, T)
    expect(pageTable('sales')).toHaveLength(2)
    expect(pageTable('targets')).toBeNull()
    expect(bar.queryByTestId('stand-in-line')).toBeNull()
  })

  test('two stand-ins on one page share the one line (point 12)', async ({ admin, createUser }) => {
    const reader = await standingIn(admin, createUser)
    await admin.post('/api/datasets/storesales/sales/load_stand_in', { csv: SALES_CSV, note: 'A day of sales, typed in' })
    const bar = await openStoreSales(reader)
    const line = await bar.findByTestId('stand-in-line', {}, T)
    expect(bar.getAllByTestId('stand-in-line')).toHaveLength(1)
    expect(within(line).getAllByTestId('stand-in').map((each) => each.textContent)).toEqual([
      `Sample data: sales is a stand-in, loaded ${today()}. A day of sales, typed in`,
      `Sample data: targets is a stand-in, loaded ${today()}. Real data expected by 15-Dec-2026. From the planning workbook`,
    ])
  })

  test('the dataset is plain text for someone who is not a System Manager (point 14)', async ({ admin, createUser }) => {
    const bar = await openStoreSales(await standingIn(admin, createUser))
    const line = await bar.findByTestId('stand-in-line', {}, T)
    await bar.findByTestId('session-user', {}, T)
    expect(within(line).queryByRole('link')).toBeNull()
  })

  test('for a System Manager the dataset opens the Datasets page, leaving the app (point 14)', async ({ admin, createUser }) => {
    await standingIn(admin, createUser)
    const left: string[] = []
    const bar = await openStoreSales(admin, '/storesales/', (href) => left.push(href))
    const link = await within(await bar.findByTestId('stand-in-line', {}, T)).findByRole('link', { name: 'targets' }, T)
    expect(link).toHaveAttribute('href', DATASETS_PATH)
    await userEvent.click(link)
    await waitFor(() => expect(left).toEqual([DATASETS_PATH]))
  })

  test('a click that opens a new tab is left to the browser', async ({ admin, createUser }) => {
    await standingIn(admin, createUser)
    const left: string[] = []
    const bar = await openStoreSales(admin, '/storesales/', (href) => left.push(href))
    const link = await within(await bar.findByTestId('stand-in-line', {}, T)).findByRole('link', { name: 'targets' }, T)
    // jsdom follows no link; the click is only seen not to be taken over.
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link, { metaKey: true })
    expect(left).toEqual([])
  })

  test('the line goes when the same data is read again and is no longer a stand-in (point 15)', async ({ admin, createUser }) => {
    const reader = await standingIn(admin, createUser)
    const bar = await openStoreSales(reader)
    await bar.findByTestId('stand-in-line', {}, T)
    await warehouseTargets(WAREHOUSE_TARGETS)
    expect(await admin.post(`${TARGETS}switch_to_warehouse`, {})).toMatchObject({ switched: true })
    await loadStoreSales(reader)
    await waitFor(() => expect(bar.queryByTestId('stand-in-line')).toBeNull())
    // The warehouse's own targets, with the app's page unchanged.
    expect(pageTable('targets')).toEqual([['N1', '01-Nov-2026', '60,000', '150', 'Yes'], ['S1', '01-Nov-2026', '40,000', '90', 'Yes']])
  })

  test("the line belongs to the page that received the rows: another page of the app has none, and going back shows it again", async ({ admin, createUser }) => {
    const bar = await openStoreSales(await standingIn(admin, createUser))
    await bar.findByTestId('stand-in-line', {}, T)
    act(() => window.history.pushState(null, '', '/storesales/help'))
    await waitFor(() => expect(bar.queryByTestId('stand-in-line')).toBeNull())
    act(() => window.history.back())
    expect(await bar.findByTestId('stand-in-line', {}, T)).toHaveTextContent('targets is a stand-in')
  })
})

describe('in the Admin', () => {
  let copy = 0
  /** The Admin as its entry mounts it (src/main.tsx), on the document's own address. */
  async function openAdmin(as: TestClient, path: string) {
    await settleSandboxRequests()
    localStorage.setItem('fc_token', as.token!)
    localStorage.setItem('fc_user', JSON.stringify({ row_id: as.user }))
    window.history.replaceState(null, '', path)
    document.body.innerHTML = '<div id="root"></div>'
    await act(() => import(/* @vite-ignore */ `../src/main?stand-in=${++copy}`))
  }
  /** An Admin page reading an app's dataset, as the app's own page does. */
  const readOverview = (as: TestClient) => act(async () => {
    const answer = await fetch(`${READ}overview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${as.token}`, 'X-Featherbase-App-Version': 'storesales@1.0.0' },
      body: JSON.stringify({ payload: {} }),
    })
    expect(answer.status).toBe(200)
  })

  test('a page that received stand-in rows carries the line under the bar; the dataset opens the Datasets page, which has none (points 11, 13, 14)', async ({ admin, createUser }) => {
    await standingIn(admin, createUser)
    await openAdmin(admin, '/featherbase/admin/jobs')
    await screen.findByRole('heading', { level: 1, name: 'Jobs' }, T)
    expect(screen.queryByTestId('stand-in-line')).toBeNull()
    await readOverview(admin)
    const line = await screen.findByTestId('stand-in-line', {}, T)
    expect(line).toHaveTextContent(`Sample data: targets is a stand-in, loaded ${today()}. Real data expected by 15-Dec-2026. From the planning workbook`)
    // Under the bar, above the sidebar and the page.
    expect(line.compareDocumentPosition(screen.getByTestId('admin-sidebar')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(within(line).getByRole('link', { name: 'targets' }))
    await screen.findByRole('heading', { level: 1, name: 'Datasets' }, T)
    expect(window.location.pathname).toBe(DATASETS_PATH)
    await waitFor(() => expect(screen.queryByTestId('stand-in-line')).toBeNull())
  })
})
