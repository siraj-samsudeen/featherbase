// budgets-actuals's fenced scenarios (#1380, #1070): each test is one scenario of the spec, step by step,
// against the installed Budgets app.
import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { invalidateSources } from '../../src/sources/registry'
import { start, type World } from './budgets-scenes'

const scenario = scenarioFor(test, 'budgets-actuals')

describe('budgets-actuals', () => {
  type Actuals = { connected: boolean; rows: { plant_code: string; line_key: string; as_published: number }[] }
  const ask = (client: TestClient) => client.post<{ result: Actuals }>('/api/app_reads/budgets/actuals', { payload: { months: ['2026-10-01'] } }).then(r => r.result)

  scenario('The warehouse is connected', async ({ createUser }, step) => {
    let w!: World
    let answer!: Actuals
    await step('the warehouse holds actual Salaries of 17,42,500 for Hilltop in October', async () => {
      w = await start(createUser)
      // The warehouse, played by a local DuckDB file named as its database is.
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'budgets-')), 'gold_finance.duckdb')
      const { DuckDBInstance } = await import('@duckdb/node-api')
      const connection = await (await DuckDBInstance.create(file)).connect()
      await connection.run(`create schema finance; create table finance.board_pl_by_line (company_code varchar, close_month date, close_version integer, plant_code varchar, line_key varchar, as_posted decimal(18,2), as_published decimal(18,2));
        insert into finance.board_pl_by_line values ('9000', '2026-10-01', 1, '9003', 'salaries', 1700000, 1742500), ('9000', '2026-09-01', 1, '9003', 'salaries', 1650000, 1650000)`)
      connection.closeSync()
      process.env.BUDGETS_TEST_DUCKDB = file
      await w.admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'BUDGETS_TEST_DUCKDB', access: 'read_only' })
      invalidateSources()
    })
    await step("a Budget Viewer asks for October's actuals", async () => { answer = await ask(w.viewer) })
    await step("they get 17,42,500 for Hilltop's Salaries", () => expect(answer.rows.map(row => [row.plant_code, row.line_key, row.as_published])).toEqual([['9003', 'salaries', 1742500]]))
  })

  scenario('No warehouse is connected', async ({ createUser }, step) => {
    let w!: World
    let answer!: Actuals
    await step('no warehouse is connected', async () => { w = await start(createUser); invalidateSources() })
    await step("a Budget Viewer asks for October's actuals", async () => { answer = await ask(w.viewer) })
    await step('they are told that actuals are not connected', () => expect(answer).toEqual({ connected: false, rows: [] }))
  })
})
