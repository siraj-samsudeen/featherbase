import { sql } from '../db'
import { registerDataset, type SnapshotRecord } from '../dataset-snapshot'
import { currentPeriod } from '../sales-target'

// The sales-target dataset: `experiments/issue_3755/shared/dive.tsx`'s rows query
// with its personalisation predicate removed, widened by #4344 to every sale (not
// only those of groups with a target) and to the hierarchy's name for every group.
//
// The Dive scopes with `plant_code = '<store>'` and `hierarchy_code in (<codes>)`.
// Dropping exactly those two, and keeping everything else, yields the superset
// every reader's view can be filtered out of — which is why one snapshot serves
// ~500 people instead of 500 artifacts serving one each.
//
// Cut at DAY grain, not month. The report displays month-to-date, but its cutoff
// is `least(period_end, max(actuals_as_of_date))` and moves as actuals land; a
// month total cannot answer a moving cutoff. So the snapshot sits one grain
// BELOW the display and the read path re-aggregates — cheap over ~344k rows,
// and it keeps any period inside the window answerable.
//
// Scoped to the current period because over half the mart is forward-dated
// target (3,656,965 of 6,845,522 material-group rows on 18-Sep-2026): caching
// targets for months nobody can have actuals for buys nothing.

export const SALES_TARGET_DATASET = 'sales_target_mtd'

/**
 * The definition, as SQL. Exported so a test can assert the personalisation
 * predicate is absent — the property the whole design rests on, which a comment
 * cannot enforce.
 *
 * One row per store x material group x day: every material-group TARGET row of
 * the mart, FULL-joined to every SALE of the same store x group x day (#4344).
 * The mart has rows only where a target exists (#3224), so reading it alone
 * dropped what a group with no target sold. A target row keeps the mart's own
 * actual, so a store's actuals for its targeted groups do not move; a sale with
 * no target row carries a null target. The sale side is the mart's own leaf —
 * `gold.sales.sales_item_daily`, store x lpad(material_group, 9) x day, before
 * tax and net of returns — so the two sides reconcile.
 */
export function definitionSql(periodStart: string, periodEnd: string): string {
  return `
    with cutoff as (
      select least(date '${periodEnd}',
                   coalesce(max(actuals_as_of_date), date '${periodEnd}')) as effective_end
      from "marts"."sales"."target_vs_actual_daily"
    ),
    stores as (
      select store_code, any_value(store_name) as store_name, any_value(short_code) as short_code
      from "gold"."masters"."store" group by 1
    ),
    targets as (
      select t.plant_code, t.hierarchy_code, t.business_date,
             t.target_daily_before_tax, t.actual_before_tax
      from "marts"."sales"."target_vs_actual_daily" t
      cross join cutoff c
      where t.hierarchy_level = 'material_group'
        and t.business_date between date '${periodStart}' and c.effective_end
    ),
    sales as (
      select s.store_code as plant_code, lpad(s.material_group, 9, '0') as hierarchy_code, s.business_date,
             sum(s.sales_before_tax_net) as actual_before_tax
      from "gold"."sales"."sales_item_daily" s
      cross join cutoff c
      where s.material_group is not null
        and s.business_date between date '${periodStart}' and c.effective_end
      group by 1, 2, 3
    )
    select coalesce(t.plant_code, s.plant_code)         as plant_code,
           st.store_name,
           st.short_code,
           coalesce(t.hierarchy_code, s.hierarchy_code) as hierarchy_code,
           coalesce(t.business_date, s.business_date)   as business_date,
           t.target_daily_before_tax,
           case when t.plant_code is not null then t.actual_before_tax else s.actual_before_tax end
                                                         as actual_before_tax
    from targets t
    full join sales s
      on s.plant_code = t.plant_code and s.hierarchy_code = t.hierarchy_code and s.business_date = t.business_date
    left join stores st on st.store_code = coalesce(t.plant_code, s.plant_code)`
}

/**
 * Every material group's name, from the merchandise hierarchy and nowhere else
 * (#4344). Kept apart from the day rows because a reader's list carries groups
 * that neither had a target nor sold this month, and those have no day row to
 * carry a name.
 */
export function namesSql(codes?: string[]): string {
  const only = codes ? `and material_group_code in (${codes.map((c) => `'${c}'`).join(', ')})` : ''
  return `
    select material_group_code, any_value(subcategory) as subcategory
    from "gold"."masters"."merchandise_hierarchy"
    where material_group_code is not null ${only}
    group by 1`
}

const AS_OF_SQL = `select max(actuals_as_of_date) as as_of from "marts"."sales"."target_vs_actual_daily"`

/** Swappable so tests can drive the whole lifecycle without MotherDuck. */
type SourceReader = (sqlText: string) => Promise<unknown[][]>
let readSource: SourceReader | null = null
export function _setSourceReader(r: SourceReader | null): void {
  readSource = r
}

/**
 * Read from MotherDuck with `@duckdb/node-api`, loaded lazily — the native
 * module is ~100MB and a server that never refreshes should not pay for it at
 * boot (the same reason `sources/duckdb-driver.ts` defers it).
 *
 * The token is read from the process environment and is never logged, returned
 * or persisted.
 */
async function motherduckReader(sqlText: string): Promise<unknown[][]> {
  const token = process.env.MOTHERDUCK_TOKEN
  if (!token) throw new Error('MOTHERDUCK_TOKEN is not set (required to refresh sales_target_mtd)')
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(`md:?motherduck_token=${token}`)
  try {
    const conn = await instance.connect()
    try {
      const reader = await conn.runAndReadAll(sqlText)
      return reader.getRows() as unknown[][]
    } finally {
      conn.closeSync()
    }
  } finally {
    instance.closeSync()
  }
}

/** The reader in force: the test stub when one is installed, MotherDuck otherwise. */
export function _liveReader(): SourceReader {
  return readSource ?? motherduckReader
}

const CHUNK = 5000
const DAY = 'day'
const NAME = 'name'

// Bump when definitionSql changes. Part of snapshot identity, so a
// redefinition can never silently serve rows cut to the old shape.
const DEFINITION_REVISION = '2'

registerDataset({
  name: SALES_TARGET_DATASET,
  // The month is part of the identity too: the rows are cut to one period, so
  // on the 1st a snapshot of last month must stop being a hit. A getter, read
  // on every lookup, turns the rollover into the ordinary "never built under
  // this definition" path — live read, recorded miss, next refresh builds the
  // new month — with no date logic in the read path.
  get version() {
    return `${DEFINITION_REVISION}:${currentPeriod().period_start}`
  },

  async fetch() {
    const read = _liveReader()
    const asOfRows = await read(AS_OF_SQL)
    const raw = asOfRows[0]?.[0] ?? null
    // DuckDB hands a DATE back as a Date or as its own value object; the
    // snapshot stores the ISO day, which is what the surface formats per ADR 844.
    const sourceAsOf =
      raw == null ? null : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10)
    const period = currentPeriod()
    // Between IST midnight on the 1st and the morning build, the warehouse still ends on the
    // last day of the previous month, so this month has nothing to cache yet. Say that, rather
    // than build an empty candidate and have it refused as a suspected upstream failure.
    if (sourceAsOf && sourceAsOf < period.period_start)
      throw new Error(`no actuals yet for the period starting ${period.period_start}: the warehouse has data through ${sourceAsOf}`)
    const days = await read(definitionSql(period.period_start, period.period_end))
    const names = await read(namesSql())
    // One snapshot, two kinds of row, tagged so `load` can route them: a day row and a name.
    return { rows: [...days.map((r) => [DAY, ...r]), ...names.map((r) => [NAME, ...r])], sourceAsOf }
  },

  async load(snapshotId, tagged) {
    const days = tagged.filter((r) => r[0] === DAY).map((r) => r.slice(1))
    const names = tagged.filter((r) => r[0] === NAME).map((r) => r.slice(1))
    for (let i = 0; i < days.length; i += CHUNK) {
      const batch = days.slice(i, i + CHUNK).map((r) => ({
        snapshot_id: snapshotId,
        plant_code: r[0] == null ? '' : String(r[0]),
        store_name: r[1] == null ? null : String(r[1]),
        short_code: r[2] == null ? null : String(r[2]),
        hierarchy_code: r[3] == null ? '' : String(r[3]),
        business_date: r[4] instanceof Date ? r[4].toISOString().slice(0, 10) : String(r[4]).slice(0, 10),
        target_before_tax: r[5] == null ? null : Number(r[5]),
        actual_before_tax: r[6] == null ? null : Number(r[6]),
      }))
      await sql`insert into sales_target_snapshot_row ${sql(batch)}`
    }
    const byCode = new Map<string, string | null>()
    for (const r of names) if (r[0] != null) byCode.set(String(r[0]), r[1] == null ? null : String(r[1]))
    const nameRows = [...byCode].map(([hierarchy_code, subcategory]) => ({ snapshot_id: snapshotId, hierarchy_code, subcategory }))
    for (let i = 0; i < nameRows.length; i += CHUNK)
      await sql`insert into sales_target_snapshot_name ${sql(nameRows.slice(i, i + CHUNK))}`
    // The day rows are the snapshot's size: the names are a lookup beside them, and an
    // empty or collapsed candidate must be judged on its figures, not on its dictionary.
    return days.length
  },

  // What the rows cost on disk, for the registry. pg_column_size over the rows
  // rather than the relation's size: several snapshots share the table.
  async sizeOf(snapshotId) {
    const [r] = await sql`
      select (select coalesce(sum(pg_column_size(t)), 0) from sales_target_snapshot_row t where snapshot_id = ${snapshotId})
           + (select coalesce(sum(pg_column_size(n)), 0) from sales_target_snapshot_name n where snapshot_id = ${snapshotId})
             as bytes`
    return Number(r.bytes)
  },

  // An empty candidate is the shape a silent upstream failure takes — a
  // successful query against a mart that has not been built yet. Activating it
  // would replace a working snapshot with a report that shows nothing and says
  // it is fresh, which is worse than serving yesterday's.
  validate(rowCount: number, previous: SnapshotRecord | null) {
    if (rowCount === 0) return 'candidate is empty'
    if (previous?.row_count && rowCount < previous.row_count * 0.5)
      return `candidate has ${rowCount} rows against ${previous.row_count} in the active snapshot — refusing a >50% drop`
    return null
  },
})
