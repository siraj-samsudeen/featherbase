// Builds the demo instance's made-up warehouse (#1123): `gold.duckdb` and `marts.duckdb` in one
// folder, holding the four tables Dash's datasets read, laid out as MotherDuck's catalogs are.
// A DuckDB source on that folder reading `gold` and `marts` answers Dash's own queries.
//
// The figures cover every day from 1 Jan 2025 to 31 Dec 2027, made up from a hash of store,
// subcategory and day, so each build is the same. Actuals stop at yesterday (India time) through a
// view, so the month to date always ends yesterday without a rebuild.
//
//   node client-apps/jeyarama/instances/demo/data/warehouse.mjs <folder>
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { banyan } from './banyan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const checkout = resolve(here, '../../../../..')
const require = createRequire(resolve(checkout, 'apps/server/package.json'))
const { DuckDBInstance } = await import(pathToFileURL(require.resolve('@duckdb/node-api')).href)

export const FIRST_DAY = '2025-01-01'
export const LAST_DAY = '2027-12-31'

/** Rupees a large store sells of one subcategory on an ordinary day, and its average price, by category. */
const SCALE = {
  'Silk sarees': [42000, 9500], Bridal: [30000, 24000], 'Cotton sarees': [16000, 1400], 'Fancy sarees': [14000, 2600],
  Kurtis: [12000, 900], 'Salwar sets': [9000, 1800], 'Dress materials': [6000, 1200], 'Dupattas and shawls': [3000, 600], Blouses: [3500, 700],
  Tops: [6000, 700], Bottoms: [6500, 900], Dresses: [5000, 1600], Innerwear: [3500, 350],
  'Formal wear': [9000, 1500], 'Casual wear': [9500, 1100], 'Ethnic wear': [6500, 1300],
  'Girls wear': [5000, 700], 'Boys wear': [4500, 650], 'Infant wear': [2500, 450], 'School wear': [3000, 500],
  Footwear: [5000, 900], Accessories: [3500, 800], Linen: [4000, 850], Packing: [900, 15], Alterations: [700, 120],
}
const STORE_SIZE = { '7101': 1.35, '7102': 0.55, '7103': 1.0, '7104': 0.9 }
/** Each store's habit against its targets: Vijayawada runs ahead, Udupi behind. */
const STORE_FORM = { '7101': 1.0, '7102': 0.88, '7103': 0.97, '7104': 1.07 }

export async function buildWarehouse(folder, group = banyan()) {
  mkdirSync(folder, { recursive: true })
  for (const name of ['gold', 'marts']) for (const suffix of ['.duckdb', '.duckdb.wal'])
    if (existsSync(resolve(folder, name + suffix))) rmSync(resolve(folder, name + suffix))
  const instance = await DuckDBInstance.create(':memory:')
  const db = await instance.connect()
  const run = (text, values) => values ? db.run(text, values) : db.run(text)
  await run(`attach '${resolve(folder, 'gold.duckdb').replaceAll("'", "''")}' as gold`)
  await run(`attach '${resolve(folder, 'marts.duckdb').replaceAll("'", "''")}' as marts`)
  await run(`create schema gold.masters; create schema gold.sales; create schema marts.sales`)

  const sites = Object.fromEntries(group.Site.map(s => [s.code, s]))
  await run(`create table gold.masters.store (store_code varchar, store_name varchar, short_code varchar, store_status varchar)`)
  for (const p of group.Plant.filter(p => p.plant_type === 'Store'))
    await run(`insert into gold.masters.store values (?, ?, ?, ?)`, [p.plant_code, sites[p.site].name, p.site, sites[p.site].status])
  await run(`create table gold.masters.merchandise_hierarchy (material_group_code varchar, subcategory varchar, category varchar, subdivision varchar, division varchar)`)
  // The figures' inputs, one row per selling store and subcategory: the day's base and the price.
  await run(`create temp table lines (plant_code varchar, code varchar, base double, price double, targeted boolean)`)
  for (const s of group.Subcategory) {
    await run(`insert into gold.masters.merchandise_hierarchy values (?, ?, ?, ?, ?)`, [s.row_id, s.subcategory, s.category, s.subdivision, s.division])
    const [base, price] = SCALE[s.category] ?? [3000, 700]
    for (const [plant, size] of Object.entries(STORE_SIZE))
      await run(`insert into lines values (?, ?, ?, ?, ?)`, [plant, s.row_id, base * size, price, s.subcategory_type === 'Merchandise'])
  }

  // A day's weight: weekends, the festival and wedding months, and slow monsoon weeks.
  await run(`create temp table days as
    select d::date as business_date,
      (case dayofweek(d) when 0 then 1.45 when 6 then 1.3 when 5 then 1.05 else 0.9 end)
      * (case month(d) when 1 then 1.15 when 4 then 1.2 when 5 then 1.25 when 6 then 0.8 when 7 then 0.75 when 8 then 1.35
           when 9 then 1.3 when 10 then 1.45 when 11 then 1.35 when 12 then 1.1 else 1.0 end)
      * (1 + 0.06 * (year(d) - 2025)) as weight
    from generate_series(date '${FIRST_DAY}', date '${LAST_DAY}', interval 1 day) t(d)`)
  // hash() is DuckDB's own, so the same store, line and day always make the same figure.
  const noise = (salt) => `((hash(l.plant_code || l.code || d.business_date::varchar || '${salt}') % 1000000) / 1000000.0)`
  await run(`create table marts.sales.target_vs_actual_daily_made_up as
    select l.plant_code, l.code as hierarchy_code, 'material_group' as hierarchy_level, d.business_date,
      round(l.base * d.weight * (0.85 + 0.3 * ((hash(l.code || 'target') % 1000) / 1000.0)), 2)::decimal(15,2) as target_daily_before_tax,
      round(l.base * d.weight * (0.85 + 0.3 * ((hash(l.code || 'target') % 1000) / 1000.0))
        * s.form * (0.55 + 0.85 * ${noise('actual')}), 2)::decimal(15,2) as actual_before_tax,
      round(l.base * d.weight / l.price, 3)::decimal(15,3) as target_quantity,
      round(l.base * d.weight * s.form * (0.55 + 0.85 * ${noise('actual')}) / l.price, 3)::decimal(15,3) as actual_quantity
    from lines l cross join days d join (values ${Object.entries(STORE_FORM).map(([p, f]) => `('${p}', ${f})`).join(', ')}) s(plant, form) on s.plant = l.plant_code
    where l.targeted`)
  await run(`create view marts.sales.target_vs_actual_daily as
    select plant_code, hierarchy_code, hierarchy_level, business_date, target_daily_before_tax,
      case when business_date < cast(timezone('Asia/Kolkata', now()) as date) then actual_before_tax end as actual_before_tax,
      cast(timezone('Asia/Kolkata', now()) as date) - 1 as actuals_as_of_date,
      target_quantity,
      case when business_date < cast(timezone('Asia/Kolkata', now()) as date) then actual_quantity end as actual_quantity
    from marts.sales.target_vs_actual_daily_made_up`)
  // Item sales for the lines without a target (carry bags, alterations), which the report adds as they are.
  await run(`create table gold.sales.sales_item_daily_made_up as
    select l.plant_code as store_code, l.code as material_group, d.business_date,
      round(l.base * d.weight * (0.6 + 0.8 * ${noise('item')}), 2)::decimal(15,2) as sales_before_tax_net,
      round(l.base * d.weight * (0.6 + 0.8 * ${noise('item')}) / l.price, 3)::decimal(15,3) as qty_net
    from lines l cross join days d where not l.targeted`)
  await run(`create view gold.sales.sales_item_daily as
    select * from gold.sales.sales_item_daily_made_up where business_date < cast(timezone('Asia/Kolkata', now()) as date)`)
  await run(`checkpoint gold; checkpoint marts`)
  const [{ n }] = (await db.runAndReadAll(`select count(*)::integer as n from marts.sales.target_vs_actual_daily_made_up`)).getRowObjectsJson()
  db.closeSync()
  instance.closeSync()
  return { folder, targetRows: n }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder = process.argv[2]
  if (!folder) throw new Error('Name the folder to build the demo warehouse in')
  console.log(await buildWarehouse(resolve(folder)))
}
