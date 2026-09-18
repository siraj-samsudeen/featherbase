import { sql } from '../db'
import { registerDataset, type SnapshotRecord } from '../dataset-snapshot'
import { PERIOD } from '../sales-target'

// The sales-target dataset: `experiments/issue_3755/shared/dive.tsx`'s rows query
// with its personalisation predicate removed.
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
 */
export function definitionSql(periodStart: string, periodEnd: string): string {
  return `
    with cutoff as (
      select least(date '${periodEnd}',
                   coalesce(max(actuals_as_of_date), date '${periodEnd}')) as effective_end
      from "marts"."sales"."target_vs_actual_daily"
    ),
    names as (
      select material_group_code, any_value(subcategory) as subcategory
      from "gold"."masters"."merchandise_hierarchy" group by 1
    ),
    stores as (
      select store_code, any_value(store_name) as store_name, any_value(short_code) as short_code
      from "gold"."masters"."store" group by 1
    )
    select t.plant_code,
           st.store_name,
           st.short_code,
           t.hierarchy_code,
           n.subcategory,
           t.business_date,
           t.target_daily_before_tax,
           t.actual_before_tax
    from "marts"."sales"."target_vs_actual_daily" t
    cross join cutoff c
    left join names  n  on n.material_group_code = t.hierarchy_code
    left join stores st on st.store_code = t.plant_code
    where t.hierarchy_level = 'material_group'
      and t.business_date between date '${periodStart}' and c.effective_end`
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

registerDataset({
  name: SALES_TARGET_DATASET,
  // Bump when definitionSql changes. Part of snapshot identity, so a
  // redefinition can never silently serve rows cut to the old shape.
  version: '1',

  async fetch() {
    const read = _liveReader()
    const asOfRows = await read(AS_OF_SQL)
    const raw = asOfRows[0]?.[0] ?? null
    // DuckDB hands a DATE back as a Date or as its own value object; the
    // snapshot stores the ISO day, which is what the surface formats per ADR 844.
    const sourceAsOf =
      raw == null ? null : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10)
    const rows = await read(definitionSql(PERIOD.period_start, PERIOD.period_end))
    return { rows, sourceAsOf }
  },

  async load(snapshotId, rows) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK).map((r) => ({
        snapshot_id: snapshotId,
        plant_code: r[0] == null ? '' : String(r[0]),
        store_name: r[1] == null ? null : String(r[1]),
        short_code: r[2] == null ? null : String(r[2]),
        hierarchy_code: r[3] == null ? '' : String(r[3]),
        subcategory: r[4] == null ? null : String(r[4]),
        business_date: r[5] instanceof Date ? r[5].toISOString().slice(0, 10) : String(r[5]).slice(0, 10),
        target_before_tax: r[6] == null ? null : Number(r[6]),
        actual_before_tax: r[7] == null ? null : Number(r[7]),
      }))
      await sql`insert into sales_target_snapshot_row ${sql(batch)}`
    }
    return rows.length
  },

  // What the rows cost on disk, for the registry. pg_column_size over the rows
  // rather than the relation's size: several snapshots share the table.
  async sizeOf(snapshotId) {
    const [r] = await sql`
      select coalesce(sum(pg_column_size(t)), 0)::bigint as bytes
      from sales_target_snapshot_row t where snapshot_id = ${snapshotId}`
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
