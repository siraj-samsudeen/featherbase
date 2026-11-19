// The `sales_to_date` query, run for real on an in-memory DuckDB laid out like
// the warehouse (catalogs `marts` and `gold`), with the DuckDB package of this
// repository's apps/server (the engine the platform runs dataset queries on). Made-up stores, subcategories and figures.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }

type Row = Record<string, unknown>
const query = (name: string) => (manifest as unknown as { datasets: { name: string; query: string }[] }).datasets.find(d => d.name === name)!.query

let run: (sql: string) => Promise<Row[]>
// The first of this month in IST, as the query works it out: from DuckDB's own clock.
let day1: string

beforeAll(async () => {
  // This repository's root (client-apps/jeyarama/dash/src → four levels up), with `pnpm install` run.
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/server/package.json'))
  const { DuckDBInstance } = require('@duckdb/node-api') as { DuckDBInstance: { create(path: string): Promise<{ connect(): Promise<{ runAndReadAll(sql: string): Promise<{ getRowObjectsJS(): unknown[] }> }> }> } }
  const connection = await (await DuckDBInstance.create(':memory:')).connect()
  run = async (sql: string) => (await connection.runAndReadAll(sql)).getRowObjectsJS() as Row[]
  const [first] = await run(`select strftime(date_trunc('month', cast(timezone('Asia/Kolkata', now()) as date)), '%Y-%m-%d') as day1`)
  day1 = String(first.day1)
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
    `insert into gold.masters.merchandise_hierarchy values ('010101001', 'Silk sarees'), ('010101002', 'Cotton sarees'),
       ('010909001', 'Gift vouchers'), ('010303001', 'Scarves')`,
    // Silk sarees: a target and a sale on day 1. Cotton sarees: a target and no sale (the mart
    // fills a zero actual). Scarves: a sale that nets to zero, with no target.
    // Quantities: Silk sarees' mart row says 4 sold of a target of 5 (its sales lines say 3, which
    // the mart's day row overrides, as it does for the value); Scarves sold 2 with no mart row.
    `insert into marts.sales.target_vs_actual_daily values
       ('9901', '010101001', 'material_group', date '${day1}', 1000, 800, date '${day1}', 5, 4),
       ('9901', '010101002', 'material_group', date '${day1}', 500, 0, date '${day1}', 2.5, 0)`,
    `insert into gold.sales.sales_item_daily values
       ('9901', '010101001', date '${day1}', 800, 'merchandise', 3),
       ('9901', '010303001', date '${day1}', 0, 'merchandise', 2),
       ('9901', '010909001', date '${day1}', 2500, 'gift_voucher_issuance', 1)`,
  ]) await run(statement)
})

const rowOf = async (code: string) => (await run(query('sales_to_date'))).find(r => r.subcategory_code === code)

// Parity first (owner's rule, 28-Oct-2026): the move changes no number. Two behaviours of the
// old report are kept on purpose, each a follow-up for Siraj to decide:
//  - the mart fills a zero actual on a target day with no sale, and that day counts as a day of
//    sales (the subcategory shows ₹0.00 sales, not "—");
//  - gift-voucher issuance with no target counts as sales (the mart excludes it; the fallback
//    sales side does not).
describe('the sales_to_date query on the warehouse, as the old report computed it', () => {
  it('counts the days with recorded sales for a subcategory that sold', async () => {
    expect(Number((await rowOf('010101001'))!.days_with_actual)).toBe(1)
  })

  it("counts the mart's zero-filled actual as a day of sales, as the old report did (follow-up)", async () => {
    expect(Number((await rowOf('010101002'))!.days_with_actual)).toBe(1)
  })

  it('keeps a genuinely recorded zero sale as a day of sales', async () => {
    expect(Number((await rowOf('010303001'))!.days_with_actual)).toBe(1)
  })

  it('counts gift-voucher issuance with no target as sales, as the old report did (follow-up)', async () => {
    expect(Number((await rowOf('010909001'))!.actual)).toBe(2500)
  })
})

// The refresh guards compare a snapshot with the active one only within one period_start
// (featherbase #676), and refuse a candidate that holds several or none, so every row carries it.
describe('the period of a sales_to_date refresh', () => {
  it("gives every row this month's first day as period_start", async () => {
    const rows = await run(query('sales_to_date'))
    expect([...new Set(rows.map(r => (r.period_start as Date).toISOString().slice(0, 10)))]).toEqual([day1])
  })
})

// The old report refused a refresh that lost more than half its target day rows (featherbase
// sales-target-mtd.ts `validate`). Each row carries its pair's share of that count, so the
// refresh guard can sum it over a snapshot (#4449).
describe('the target days of a sales_to_date row', () => {
  it('count the days with a target, as the old report counted its target rows', async () => {
    expect(Number((await rowOf('010101002'))!.target_days)).toBe(1)
  })

  it('count no day for a subcategory that only sold', async () => {
    expect(Number((await rowOf('010303001'))!.target_days)).toBe(0)
  })
})

// The Dive's cached rows carry quantities beside the values (#4453), taken from the same rows:
// the mart's day row when there is one, else the day's sales lines.
describe('the quantities of a sales_to_date row', () => {
  it("give a subcategory the month's target quantity from the mart", async () => {
    expect(Number((await rowOf('010101002'))!.target_quantity)).toBe(2.5)
  })

  it("take the actual quantity from the mart's day row when there is one", async () => {
    expect(Number((await rowOf('010101001'))!.actual_quantity)).toBe(4)
  })

  it('take the actual quantity from the sales lines on a day the mart has no row for', async () => {
    expect(Number((await rowOf('010303001'))!.actual_quantity)).toBe(2)
  })

  it('give no target quantity to a subcategory that only sold', async () => {
    expect((await rowOf('010303001'))!.target_quantity).toBeNull()
  })
})

describe('the sales_month query on the warehouse', () => {
  it('names every store, figures or not', async () => {
    const rows = await run(query('sales_month'))
    expect([...new Set(rows.map(r => `${r.store_code} ${r.store_name}`))]).toEqual(['9901 Lakeside'])
  })
})

// The months side by side (ask-questions-of-app-data): this month and the three before it, each
// counted over the same days of the month as this month so far, so "compare with last month" is
// fair partway through a month. The data here runs to the 1st, so each month counts its 1st only.
describe('the sales_by_month query on the warehouse', () => {
  let rows: Row[]
  let lastMonth: string
  const of = (code: string, monthsAgo: number) => rows.find(r => r.subcategory_code === code && Number(r.months_ago) === monthsAgo)

  beforeAll(async () => {
    const [labels] = await run(`select strftime(date '${day1}' - interval 1 month, '%Y-%m') as last_month`)
    lastMonth = String(labels.last_month)
    // Last month: Silk sarees had a target and a sale on the 1st and again on the 2nd, and Scarves
    // sold on the 1st with no target. Five months ago is further back than the query looks.
    await run(`insert into marts.sales.target_vs_actual_daily values
      ('9901', '010101001', 'material_group', cast(date '${day1}' - interval 1 month as date), 900, 700, date '${day1}', 4, 3),
      ('9901', '010101001', 'material_group', cast(date '${day1}' - interval 1 month + interval 1 day as date), 900, 650, date '${day1}', 4, 3),
      ('9901', '010101001', 'material_group', cast(date '${day1}' - interval 5 month as date), 400, 300, date '${day1}', 2, 1)`)
    await run(`insert into gold.sales.sales_item_daily values
      ('9901', '010303001', cast(date '${day1}' - interval 1 month as date), 300, 'merchandise', 1)`)
    rows = await run(query('sales_by_month'))
  })

  it("gives this month the same figures as sales_to_date, row for row", async () => {
    const toDate = await run(query('sales_to_date'))
    const figures = (r: Row) => [r.subcategory_code, r.target === null ? null : Number(r.target), r.actual === null ? null : Number(r.actual),
      r.target_quantity === null ? null : Number(r.target_quantity), r.actual_quantity === null ? null : Number(r.actual_quantity)]
    const sorted = (list: Row[]) => list.map(figures).sort((a, b) => String(a[0]) < String(b[0]) ? -1 : 1)
    expect(sorted(rows.filter(r => Number(r.months_ago) === 0))).toEqual(sorted(toDate))
  })

  it('counts last month over the same days as this month so far, and no later day', async () => {
    const silk = of('010101001', 1)!
    expect([Number(silk.target), Number(silk.actual), Number(silk.target_quantity), Number(silk.actual_quantity)]).toEqual([900, 700, 4, 3])
    expect((silk.data_through as Date).toISOString().slice(0, 10).slice(8)).toBe('01')
  })

  it('takes a month with no mart row from the sales lines, with no target', async () => {
    const scarves = of('010303001', 1)!
    expect([scarves.target, Number(scarves.actual), Number(scarves.actual_quantity)]).toEqual([null, 300, 1])
  })

  it('names each month YYYY-MM and says how many months ago it was', async () => {
    expect([...new Set(rows.map(r => `${r.months_ago} ${r.month_label}`))].sort()).toEqual([`0 ${day1.slice(0, 7)}`, `1 ${lastMonth}`])
  })

  it('names the store and subcategory on every row, and looks back three months only', async () => {
    expect(rows.every(r => r.store_name === 'Lakeside' && r.subcategory !== null)).toBe(true)
    expect(rows.some(r => Number(r.months_ago) > 3 || Number(r.target) === 400)).toBe(false)
  })
})
