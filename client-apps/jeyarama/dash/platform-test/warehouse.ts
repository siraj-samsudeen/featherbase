// The warehouse for a platform refresh of the app's datasets. In production it
// is MotherDuck, which a test cannot reach, so it is played here by an in-memory
// DuckDB laid out like MotherDuck's catalogs `marts` and `gold` (the layout
// src/dataset-query.test.ts uses). Only the connection is replaced: the
// platform's DuckDB driver keeps wrapping the declared query exactly as it does
// for MotherDuck, and the platform shapes, stores, guards and activates the rows
// itself. Made-up store 9901 and subcategories.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { vi } from 'vitest'
import { duckdbDriver } from '../../src/sources/duckdb-driver'
import { datasetQueryText } from '../../src/sources/dataset-query'
import type { TestClient } from 'feather-testing-postgres'

let connection: DuckDBConnection | null = null
let withoutPeriod = false
const run = async (text: string, values: unknown[] = []) =>
  (await connection!.runAndReadAll(text, values as never[])).getRowObjectsJson()

/** Opens the warehouse and routes the platform's DuckDB dataset queries to it. */
export async function openWarehouse() {
  connection = await (await DuckDBInstance.create(':memory:')).connect()
  for (const statement of [
    `attach ':memory:' as marts`, `attach ':memory:' as gold`,
    `create schema marts.sales`, `create schema gold.masters`, `create schema gold.sales`,
    `create table marts.sales.target_vs_actual_daily (plant_code varchar, hierarchy_code varchar, hierarchy_level varchar,
       business_date date, target_daily_before_tax decimal(15,2), actual_before_tax decimal(15,2), actuals_as_of_date date,
       target_quantity decimal(15,3), actual_quantity decimal(15,3))`,
    `create table gold.masters.store (store_code varchar, store_name varchar, short_code varchar)`,
    `create table gold.masters.merchandise_hierarchy (material_group_code varchar, subcategory varchar)`,
    `create table gold.sales.sales_item_daily (store_code varchar, material_group varchar, business_date date,
       sales_before_tax_net decimal(15,2), sale_line_kind varchar, qty_net decimal(15,3))`,
    `insert into gold.masters.store values ('9901', 'Lakeside', 'LKS')`,
  ]) await run(statement)
  // The same wrapping and placeholders as the driver's own `query` (featherbase sources/duckdb-driver.ts).
  vi.spyOn(duckdbDriver, 'query').mockImplementation(async (_source, query, columns, where) => {
    const { text, values } = datasetQueryText(query, columns, where,
      { placeholder: () => '?', asText: (column) => `cast(${column} as varchar)`, asDay: (column) => `cast(cast(${column} as date) as varchar)` })
    const rows = await run(text, values)
    return (withoutPeriod ? rows.map(row => ({ ...row, period_start: null })) : rows) as never
  })
}

/** From now until the warehouse closes, its answers carry no period_start: a query that lost
 *  its period, which the refresh guards must refuse rather than compare. */
export function answerWithoutPeriod() {
  withoutPeriod = true
}

export async function closeWarehouse() {
  vi.restoreAllMocks()
  withoutPeriod = false
  connection?.closeSync()
  connection = null
}

/** The instance's `motherduck` Data Source, which the app's datasets name. */
export const addSource = (admin: TestClient) =>
  admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'FEATHER_DASH_TEST_DUCKDB', access: 'read_only' })

/** A month with a target for each of four subcategories: the good refresh the tests start from. */
export const FOUR_TARGETS = { '010101001': 1000, '010101003': 500, '010909001': 200, '010303001': 100 }

type Day = number | null

/**
 * Store 9901's month so far, one entry per subcategory: a number is that
 * subcategory's target (and a sale) on the 1st; `null` is a sale with no target. Each day sells
 * one piece against a target of two (the quantities, which only 0.9.0's query reads).
 * A list is one such entry per day from the 1st (only days up to today count).
 */
export async function fillWarehouse(targets: Record<string, Day | Day[]>) {
  for (const table of ['marts.sales.target_vs_actual_daily', 'gold.masters.merchandise_hierarchy', 'gold.sales.sales_item_daily'])
    await run(`delete from ${table}`)
  const [{ day1 }] = await run(`select strftime(date_trunc('month', cast(timezone('Asia/Kolkata', now()) as date)), '%Y-%m-%d') as day1`)
  for (const [code, entry] of Object.entries(targets)) {
    await run(`insert into gold.masters.merchandise_hierarchy values (?, ?)`, [code, `Made-up ${code}`])
    for (const [offset, target] of (Array.isArray(entry) ? entry : [entry]).entries()) {
      await run(`insert into gold.sales.sales_item_daily values ('9901', ?, cast(? as date) + ?, 100, 'merchandise', 1)`, [code, day1, offset])
      if (target !== null) await run(`insert into marts.sales.target_vs_actual_daily
        values ('9901', ?, 'material_group', cast(? as date) + ?, ?, 100, cast(? as date) + ?, 2, 1)`, [code, day1, offset, target, day1, offset])
    }
  }
}
