// naming-and-numbering's scenarios that the server alone proves (#1070).
// Each test is one fenced scenario of
// openspec/specs/naming-and-numbering/spec.md, step by step; the scenarios a
// person reads on screen are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { expectApiError, makeTable } from '../fixtures'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'naming-and-numbering')

async function addRow(admin: TestClient, table: string, row: Record<string, unknown> = { title: 'a row' }) {
  return (await admin.post<{ row_id: string }>('/api/save_row', { table, row })).row_id
}

const plantTable = (admin: TestClient, prefix: string) =>
  makeTable(admin, { name: 'Plant', module: 'Custom', id_pattern: `${prefix}{plant_code}`, columns: ['plant_code', 'city'] })

describe('naming-and-numbering', () => {
  scenario('The first rows of a new table are 1, 2 and 3', async ({ admin }, step) => {
    const added: string[] = []
    await step('the user creates a table "Plant" without choosing how its rows are named', () =>
      makeTable(admin, { name: 'Plant', module: 'Custom', columns: ['title'] }))
    await step('the user adds three plants', async () => {
      for (let i = 0; i < 3; i++) added.push(await addRow(admin, 'Plant'))
    })
    await step('the plants are numbered 1, 2 and 3', () => expect(added).toEqual(['1', '2', '3']))
  })

  scenario('Two tables with the same prefix both start at 001', async ({ admin }, step) => {
    const tables = ['Store', 'Store Copy']
    const added: string[] = []
    await step(/two tables "Store" and "Store Copy" both named by a series with the prefix "STORE-"/, async () => {
      for (const name of tables) await makeTable(admin, { name, module: 'Custom', id_pattern: 'STORE-.###', columns: ['title'] })
    })
    await step('the user adds a store to each', async () => {
      for (const name of tables) added.push(await addRow(admin, name))
    })
    await step('each store is numbered STORE-001', () => expect(added).toEqual(['STORE-001', 'STORE-001']))
  })

  scenario('An imported row already holds the next number', async ({ admin }, step) => {
    let next = ''
    await step('a table "Bin" whose rows are numbered 1, 2, 3', () =>
      makeTable(admin, { name: 'Bin', module: 'Custom', id_pattern: 'integer', columns: ['title'] }))
    await step('the user has added bin 1 and imported a bin with the id 2', async () => {
      expect(await addRow(admin, 'Bin')).toBe('1')
      // An import supplies its own ids through the same create the API offers.
      await admin.post('/api/table/Bin', { row_id: '2', title: 'imported' })
    })
    await step('the user adds another bin', async () => {
      next = await addRow(admin, 'Bin')
    })
    await step('it is numbered 3', () => expect(next).toBe('3'))
  })

  scenario('A plant is named after its plant code', async ({ admin }, step) => {
    let id = ''
    await step('a table "Plant" whose rows are named "PLANT-" followed by their plant code', () => plantTable(admin, 'PLANT-'))
    await step('the user adds a plant with the plant code 8151', async () => {
      id = await addRow(admin, 'Plant', { plant_code: '8151', city: 'Chennai' })
    })
    await step('the plant is named PLANT-8151', () => expect(id).toBe('PLANT-8151'))
  })

  scenario('Two plants with the same code', async ({ admin }, step) => {
    let refusal: Promise<unknown> = Promise.resolve()
    await step('plant PLANT-8151 exists', async () => {
      await plantTable(admin, 'PLANT-')
      expect(await addRow(admin, 'Plant', { plant_code: '8151', city: 'Chennai' })).toBe('PLANT-8151')
    })
    await step('the user adds another plant with the plant code 8151', () => {
      refusal = admin.post('/api/save_row', { table: 'Plant', row: { plant_code: '8151', city: 'Madurai' } })
    })
    await step('the save is refused, naming the plant code', async () => {
      const err = await expectApiError(refusal, { status: 417 })
      expect(err.message).toMatch(/plant_code/)
    })
    await step('PLANT-8151 is unchanged', async () => {
      const row = await admin.get<{ city: string }>(`/api/table/Plant/${encodeURIComponent('PLANT-8151')}`)
      expect(row.city).toBe('Chennai')
    })
  })
})
