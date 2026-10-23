// data-warehouse #4344: every material group in a reader's list shows its hierarchy name and
// what it sold, target or not. The dataset SQL runs here for real — against an in-memory DuckDB
// standing in for MotherDuck, with the same three-part relation names — so the join itself is
// under test, not a stub's idea of it. All figures are synthetic.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'
import { test } from './pg-test'
import { buildSnapshot } from '../src/dataset-snapshot'
import { SALES_TARGET_DATASET, _setSourceReader } from '../src/datasets/sales-target-mtd'
import { reportFor, type Report } from '../src/sales-target-report'
import type { Assignment } from '../src/sales-target'

const savedToday = process.env.SALES_TARGET_TODAY
let instance: DuckDBInstance
let conn: DuckDBConnection

// September, actuals through 02-Sep. Store 1501 is the reader's; 1515 is another store's.
const FIXTURE = `
  attach ':memory:' as marts; create schema marts.sales;
  attach ':memory:' as gold; create schema gold.sales; create schema gold.masters;

  create table marts.sales.target_vs_actual_daily (
    plant_code varchar, hierarchy_level varchar, hierarchy_code varchar, business_date date,
    target_daily_before_tax decimal(15,2), actual_before_tax decimal(15,2), actuals_as_of_date date);
  insert into marts.sales.target_vs_actual_daily values
    -- Shirts: a target, and sales
    ('1501', 'material_group', '010101001', '2026-09-01', 100, 60, '2026-09-02'),
    ('1501', 'material_group', '010101001', '2026-09-02', 100, 60, '2026-09-02'),
    -- Trousers: a target, no sale
    ('1501', 'material_group', '010101002', '2026-09-01', 50, 0, '2026-09-02'),
    ('1501', 'material_group', '010101002', '2026-09-02', 50, 0, '2026-09-02'),
    -- Ties: a ₹0 target row and no sale
    ('1501', 'material_group', '010101004', '2026-09-01', 0, 0, '2026-09-02'),
    -- a future day past the cutoff, and a coarse row: neither is read
    ('1501', 'material_group', '010101001', '2026-09-20', 100, null, '2026-09-02'),
    ('1501', 'line_of_business', '04', '2026-09-01', 999, 0, '2026-09-02');

  create table gold.sales.sales_item_daily (
    store_code varchar, business_date date, item_code_sap varchar, material_group varchar,
    sales_before_tax_net decimal(38,2));
  insert into gold.sales.sales_item_daily values
    -- On 01-Sep the fact holds ₹70 of Shirts while the mart's target row says ₹60: a target day
    -- keeps the MART's actual, so the store's targeted figures never move.
    ('1501', '2026-09-01', 'I1', '010101001', 40), ('1501', '2026-09-01', 'I2', '010101001', 20),
    ('1501', '2026-09-01', 'I4', '010101001', 10),
    ('1501', '2026-09-02', 'I1', '010101001', 60),
    -- Belts: sold with no target; the code arrives without its leading zero, as the fact can carry it
    ('1501', '2026-09-02', 'I3', '10101003', 25.50),
    -- a sale after the actuals cutoff (02-Sep) is not counted yet
    ('1501', '2026-09-05', 'I3', '010101003', 500),
    -- another store's sale of Belts is not this reader's
    ('1515', '2026-09-01', 'I3', '010101003', 99);

  create table gold.masters.merchandise_hierarchy (material_group_code varchar, subcategory varchar);
  insert into gold.masters.merchandise_hierarchy values
    ('010101001', 'Shirts'), ('010101002', 'Trousers'), ('010101003', 'Belts'),
    ('010101004', 'Ties'), ('040101005', 'Bread & Bun');

  create table gold.masters.store (store_code varchar, store_name varchar, short_code varchar);
  insert into gold.masters.store values ('1501', 'Store A', 'STA'), ('1515', 'Store B', 'STB');
`

beforeAll(async () => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  instance = await DuckDBInstance.create(':memory:')
  conn = await instance.connect()
  await conn.run(FIXTURE)
})
afterAll(() => {
  conn.closeSync()
  instance.closeSync()
  if (savedToday === undefined) delete process.env.SALES_TARGET_TODAY
  else process.env.SALES_TARGET_TODAY = savedToday
})
const readerOn = (c: DuckDBConnection) => _setSourceReader(async (text) => (await c.runAndReadAll(text)).getRows() as unknown[][])
const duckdb = () => readerOn(conn)

/** A second warehouse: the same fixture, then `damage` applied to it. */
async function warehouseWith(damage: string): Promise<{ c: DuckDBConnection; close: () => void }> {
  const i = await DuckDBInstance.create(':memory:')
  const c = await i.connect()
  await c.run(FIXTURE)
  await c.run(damage)
  return { c, close: () => { c.closeSync(); i.closeSync() } }
}
afterEach(() => _setSourceReader(null))

const READER: Assignment = {
  plant_code: '1501',
  store_label: 'STA',
  material_groups: ['010101001', '010101002', '010101003', '010101004', '040101005'],
  sections: ['Accessories', 'Food Court', 'Menswear'],
  section_by_material_group: {
    '010101001': 'Menswear', '010101002': 'Menswear',
    '010101003': 'Accessories', '010101004': 'Accessories',
    '040101005': 'Food Court',
  },
  scope_basis: ['section_staff'],
}

const byCode = (r: Report) => Object.fromEntries(r.rows.map((x) => [x.code, x]))

/** Both delivery paths must give the same answer: live first (no snapshot yet), then the snapshot. */
async function bothPaths(): Promise<[Report, Report]> {
  duckdb()
  const live = await reportFor(READER)
  expect(live.source).toBe('live')
  expect(live.targets_unavailable).toBe(false)
  const built = await buildSnapshot(SALES_TARGET_DATASET)
  expect(built.status).toBe('activated')
  // The snapshot's size is its target rows to date: Shirts 2 + Trousers 2 + Ties 1. Not the
  // 20-Sep row (past the cutoff), not the line-of-business row, not the sales-only days.
  expect(built.rowCount).toBe(5)
  const snap = await reportFor(READER)
  expect(snap.source).toBe('snapshot')
  return [live, snap]
}

describe('every group in the reader\'s list (#4344)', () => {
  test('a group that sold with no target shows its hierarchy name and its sales, against a ₹0 target', async () => {
    for (const r of await bothPaths()) {
      expect(byCode(r)['010101003']).toMatchObject({
        subcategory: 'Belts', target: 0, actual: 25.5, gap: 25.5, achievement: null,
        missingActual: false, noTargetNoSale: false,
      })
    }
  })

  test('a group with neither a target nor a sale has its hierarchy name and is classed "no target, no sale"', async () => {
    for (const r of await bothPaths()) {
      expect(byCode(r)['040101005']).toMatchObject({
        subcategory: 'Bread & Bun', target: 0, actual: 0, noTargetNoSale: true, missingActual: false,
      })
      // A ₹0 target row with no sale is the same thing to a reader.
      expect(byCode(r)['010101004']).toMatchObject({ subcategory: 'Ties', target: 0, actual: 0, noTargetNoSale: true })
      // No row reads as a name the hierarchy lacks.
      expect(r.rows.some((x) => x.subcategory === '(name not in hierarchy)')).toBe(false)
    }
  })

  test('a group with a target keeps the mart\'s target and actual; one with a target and no sale is shown', async () => {
    for (const r of await bothPaths()) {
      expect(byCode(r)['010101001']).toMatchObject({ subcategory: 'Shirts', target: 200, actual: 120, noTargetNoSale: false })
      expect(byCode(r)['010101002']).toMatchObject({ subcategory: 'Trousers', target: 100, actual: 0, gap: -100, noTargetNoSale: false })
    }
  })

  test('each Section total is the sum of its rows, and the Sections sum to the store total', async () => {
    for (const r of await bothPaths()) {
      const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((a, v) => a + (v ?? 0), 0) * 100) / 100
      for (const s of r.sections) {
        const mine = r.rows.filter((x) => x.section === s.section)
        expect(s.target).toBe(sum(mine.map((x) => x.target)))
        expect(s.actual).toBe(sum(mine.map((x) => x.actual)))
        expect(s.n).toBe(mine.length)
        expect(s.no_target_no_sale).toBe(mine.filter((x) => x.noTargetNoSale).length)
      }
      expect(r.sections.map(({ section, target, actual, no_target_no_sale, n }) => ({ section, target, actual, no_target_no_sale, n }))).toEqual([
        { section: 'Accessories', target: 0, actual: 25.5, no_target_no_sale: 1, n: 2 },
        { section: 'Food Court', target: 0, actual: 0, no_target_no_sale: 1, n: 1 },
        { section: 'Menswear', target: 300, actual: 120, no_target_no_sale: 0, n: 2 },
      ])
      expect(r.total).toMatchObject({ target: 300, actual: 145.5, no_target_no_sale: 2, missing: 0, n: 5 })
    }
  })
})

// Review of #445: sales-only rows make a candidate look non-empty even when the target mart came
// back empty or half-built. Real sales against ₹0 targets, labelled fresh, must never be served.
describe('an empty or partial target mart', () => {
  test('a snapshot with no target rows is refused, and the last good one keeps serving', async () => {
    duckdb()
    const good = await buildSnapshot(SALES_TARGET_DATASET)
    expect(good.status).toBe('activated')
    const w = await warehouseWith('delete from marts.sales.target_vs_actual_daily')
    try {
      readerOn(w.c)
      const bad = await buildSnapshot(SALES_TARGET_DATASET)
      expect(bad.status).toBe('refused')
      expect(bad.reason).toMatch(/no target rows/)
      expect((await reportFor(READER)).snapshot_id).toBe(good.snapshotId)
    } finally {
      w.close()
    }
  })

  test('a snapshot that lost more than half its target rows is refused', async () => {
    duckdb()
    expect((await buildSnapshot(SALES_TARGET_DATASET)).status).toBe('activated')
    const w = await warehouseWith(`delete from marts.sales.target_vs_actual_daily where hierarchy_code <> '010101001'`)
    try {
      readerOn(w.c)
      const bad = await buildSnapshot(SALES_TARGET_DATASET) // 2 target rows to date against 5
      expect(bad.status).toBe('refused')
      expect(bad.reason).toMatch(/>50% drop/)
    } finally {
      w.close()
    }
  })

  test('a live read with no target rows says targets are unavailable and shows none as ₹0', async () => {
    const w = await warehouseWith('delete from marts.sales.target_vs_actual_daily')
    try {
      readerOn(w.c)
      const r = await reportFor(READER)
      expect(r.source).toBe('live')
      expect(r.targets_unavailable).toBe(true)
      expect(r.rows.every((x) => x.target === null && x.gap === null && x.achievement === null)).toBe(true)
      expect(r.rows.some((x) => x.noTargetNoSale)).toBe(false) // nothing is hidden on a guess
      expect(r.total.target).toBeNull()
      expect(byCode(r)['010101003'].actual).toBeGreaterThan(0) // sales still shown
    } finally {
      w.close()
    }
  })
})
