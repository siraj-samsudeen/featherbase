// stand-in-datasets' two fenced scenarios a person reads on screen (#1409):
// the line an app's page carries when it shows stand-in rows, and the Datasets
// page. Each test is one scenario of the spec, step by step, in jsdom against
// the real in-process server; the other scenarios are the server's
// (apps/server/test/scenarios/). The app is the Store Sales fixture, its own
// page's script run unchanged under the shared bar; its warehouse is made-up
// rows.
import { describe } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { buildSnapshot } from 'server/src/dataset-snapshot'
import { scenarioFor } from 'server/test/scenario'
import { loadTargets, storeSales, useWarehouse } from 'server/test/stand-in-fixture'
import { fmtDayIST } from 'shared'
import { test, expect, byTestId, onScreen, renderSession } from '../pg-test'
import { openStoreSales, pageTable, useStandInMark } from '../store-sales-page'

const scenario = scenarioFor(test, 'stand-in-datasets')
useWarehouse()
useStandInMark()

const BAR = 'featherbase-bar'
const NOTE = 'From the planning workbook'
const today = () => fmtDayIST(new Date())

/** `sales` copied from the warehouse by a refresh; `targets` loaded from a file. */
async function targetsStandIn(admin: TestClient, createUser: CreateUserFn) {
  const { reader } = await storeSales(admin, createUser)
  expect(await buildSnapshot('storesales.sales')).toMatchObject({ status: 'activated', rowCount: 2 })
  expect(await loadTargets(admin, { note: NOTE })).toMatchObject({ dataset: 'targets', rows: 3 })
  return reader
}

describe('stand-in-datasets', () => {
  scenario('The page says its figures are sample data', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    await step('"targets" is a stand-in and "sales" comes from the warehouse', async () => {
      reader = await targetsStandIn(admin, createUser)
    })
    await step('the user opens the Store Sales page, which shows both', async () => {
      await openStoreSales(reader)
      await onScreen().assertText('Sales Only')
      expect(pageTable('sales')).toHaveLength(2)
      expect(pageTable('targets')).toHaveLength(3)
    })
    await step('the page carries one line saying "targets" is sample data and when it was loaded', async () => {
      await onScreen().within(BAR, (bar) =>
        bar.within(byTestId('stand-in-line'), (line) => line.assertExactText(`Sample data: targets is a stand-in, loaded ${today()}. ${NOTE}`)))
      // One line, and it is the bar's: the app's own page says nothing of it.
      expect(document.querySelector(BAR)!.shadowRoot!.querySelectorAll(byTestId('stand-in-line'))).toHaveLength(1)
      expect(document.getElementById('store-sales-page')).not.toHaveTextContent('Sample data')
    })
    await step('the line does not name "sales"', () =>
      onScreen().within(BAR, (bar) => bar.within(byTestId('stand-in-line'), (line) => line.refuteText('sales'))))
  })

  scenario('Seeing which datasets are stand-ins', async ({ admin, createUser }, step) => {
    let datasets!: Awaited<ReturnType<typeof renderSession>>['session']
    await step('"targets" is a stand-in and "sales" comes from the warehouse', () => targetsStandIn(admin, createUser))
    await step('a System Manager opens the Datasets page', async () => {
      ({ session: datasets } = await renderSession('/featherbase/admin/datasets', admin))
      await datasets.assertText('Datasets')
    })
    await step('"targets" shows as a stand-in with the day it was loaded and its note', () =>
      datasets.within(byTestId('dataset-storesales.targets'), (row) =>
        row.within(byTestId('served-from'), (pill) => pill.assertExactText('Stand-in'))
          .assertText(`Loaded ${today()}`)
          .assertText(NOTE)))
    await step('"sales" shows as served from the warehouse', () =>
      datasets.within(byTestId('dataset-storesales.sales'), (row) =>
        row.within(byTestId('served-from'), (pill) => pill.assertExactText('Warehouse')).refuteText('Stand-in')))
  })
})
