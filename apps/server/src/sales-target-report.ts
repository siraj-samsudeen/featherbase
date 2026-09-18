import { sql } from './db'
import { activeSnapshot, recordMiss } from './dataset-snapshot'
import { SALES_TARGET_DATASET, definitionSql } from './datasets/sales-target-mtd'
import { PERIOD, type Assignment } from './sales-target'

// The read path. Personalisation is applied HERE, as a predicate over the
// snapshot, with the caller's assignment in hand — not baked into an artifact
// ahead of the request. That is what keeps a role or assignment change effective
// on the next read with nothing rebuilt, and what keeps a principal in context
// when the rows are selected.
//
// The snapshot tables are app-internal and are never read through the generic
// list/document APIs: a snapshot holds every store's rows, and generic row
// scoping is fail-open for a principal with no `data_scope` rows
// (`query.ts:180`). Until #246's `scope_required` lands, the only safe reader is
// this one, which cannot be reached without an assignment.

export interface ReportRow {
  code: string
  subcategory: string
  target: number | null
  actual: number | null
  gap: number | null
  achievement: number | null
  missingActual: boolean
  missingTarget: boolean
}

export interface Report {
  source: 'snapshot' | 'live'
  source_as_of: string | null
  /**
   * When the snapshot was last refreshed (ISO instant), or null on a live read.
   * Distinct from source_as_of on purpose: as-of answers "is my figure complete",
   * refreshed answers "how stale is this page". A snapshot built minutes ago from
   * three-day-old warehouse data is fresh by one measure and stale by the other,
   * and a reader needs to be able to tell.
   */
  generated_at: string | null
  snapshot_id: string | null
  store_name: string | null
  short_code: string | null
  period_start: string
  period_end: string
  /** least(period_end, source_as_of) — the cutoff actually applied to both sides. */
  data_through: string | null
  cutoff_early: boolean
  rows: ReportRow[]
  total: {
    target: number | null
    actual: number | null
    gap: number | null
    achievement: number | null
    missing: number
    n: number
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

interface Grouped {
  code: string
  subcategory: string | null
  mtd_target: number | null
  mtd_actual: number | null
  days_with_actual: number
}

/**
 * The Dive's arithmetic, line for line (`dive.tsx`). Kept in one function and
 * shared by both delivery paths so a snapshot read and a live read cannot drift
 * into two different answers — the property `live_check.mjs` proves across hosts.
 */
function shape(grouped: Grouped[]): Pick<Report, 'rows' | 'total'> {
  const rows: ReportRow[] = grouped.map((g) => {
    const target = g.mtd_target
    // No observed day means MISSING, never ₹0 — a store that has not traded a
    // subcategory yet must not read as one that traded and sold nothing.
    const actual = g.days_with_actual > 0 ? g.mtd_actual : null
    const gap = target != null && actual != null ? round2(actual - target) : null
    const achievement =
      target != null && target !== 0 && actual != null ? (100 * actual) / target : null
    return {
      code: g.code,
      subcategory: g.subcategory ?? '(name not in hierarchy)',
      target,
      actual,
      gap,
      achievement,
      missingActual: actual == null,
      missingTarget: target == null,
    }
  })

  const present = rows.filter((r) => r.target != null)
  const target = present.length ? round2(present.reduce((a, r) => a + (r.target as number), 0)) : null
  const withActual = rows.filter((r) => r.actual != null)
  const actual = withActual.length ? round2(withActual.reduce((a, r) => a + (r.actual as number), 0)) : null
  const gap = target != null && actual != null ? round2(actual - target) : null
  const achievement = target != null && target !== 0 && actual != null ? (100 * actual) / target : null

  return {
    rows,
    total: { target, actual, gap, achievement, missing: rows.filter((r) => r.missingActual).length, n: rows.length },
  }
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/** pg hands timestamptz back as a Date; the wire carries an ISO instant. */
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v)

async function fromSnapshot(a: Assignment, snapshotId: string): Promise<Grouped[]> {
  // `unnest` + LEFT JOIN, exactly as the Dive does it: a selected code with no
  // rows still appears, rather than vanishing from the reader's list.
  const rows = await sql`
    select c.code,
           max(r.subcategory)             as subcategory,
           sum(r.target_before_tax)       as mtd_target,
           sum(r.actual_before_tax)       as mtd_actual,
           count(r.actual_before_tax)     as days_with_actual
    from unnest(${a.material_groups}::text[]) as c(code)
    left join sales_target_snapshot_row r
      on r.snapshot_id = ${snapshotId}
     and r.plant_code = ${a.plant_code}
     and r.hierarchy_code = c.code
    group by c.code
    order by c.code`
  return rows.map((r) => ({
    code: String(r.code),
    subcategory: r.subcategory == null ? null : String(r.subcategory),
    mtd_target: num(r.mtd_target),
    mtd_actual: num(r.mtd_actual),
    days_with_actual: Number(r.days_with_actual ?? 0),
  }))
}

async function storeOf(snapshotId: string, plant: string) {
  const [row] = await sql`
    select store_name, short_code from sales_target_snapshot_row
    where snapshot_id = ${snapshotId} and plant_code = ${plant} limit 1`
  return {
    store_name: (row?.store_name as string | null) ?? null,
    short_code: (row?.short_code as string | null) ?? null,
  }
}

/** Live fall-through: the dataset's own SQL, scoped to this reader, run at the source. */
async function fromLive(a: Assignment): Promise<{ grouped: Grouped[]; asOf: string | null; store: { store_name: string | null; short_code: string | null } }> {
  const { _liveReader } = await import('./datasets/sales-target-mtd')
  const read = _liveReader()
  const codes = a.material_groups.map((c) => `'${c}'`).join(', ')
  const scoped = `
    with base as (${definitionSql(PERIOD.period_start, PERIOD.period_end)})
    select b.hierarchy_code,
           any_value(b.subcategory)        as subcategory,
           any_value(b.store_name)         as store_name,
           any_value(b.short_code)         as short_code,
           sum(b.target_daily_before_tax)  as mtd_target,
           sum(b.actual_before_tax)        as mtd_actual,
           count(b.actual_before_tax)      as days_with_actual
    from base b
    where b.plant_code = '${a.plant_code}' and b.hierarchy_code in (${codes})
    group by b.hierarchy_code
    order by b.hierarchy_code`
  const rows = await read(scoped)
  const asOfRows = await read(`select max(actuals_as_of_date) from "marts"."sales"."target_vs_actual_daily"`)
  const raw = asOfRows[0]?.[0] ?? null
  const asOf = raw == null ? null : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10)

  // The live path returns only codes that HAVE rows; the reader's full selection
  // is authoritative, so absent codes are added back as empty — same list either way.
  const byCode = new Map(rows.map((r) => [String(r[0]), r]))
  const grouped = a.material_groups.map((code) => {
    const r = byCode.get(code)
    return {
      code,
      subcategory: r?.[1] == null ? null : String(r[1]),
      mtd_target: num(r?.[4]),
      mtd_actual: num(r?.[5]),
      days_with_actual: Number(r?.[6] ?? 0),
    }
  })
  const first = rows[0]
  return {
    grouped,
    asOf,
    store: {
      store_name: first?.[2] == null ? null : String(first[2]),
      short_code: first?.[3] == null ? null : String(first[3]),
    },
  }
}

/**
 * Resolve the report for one reader. Snapshot when the dataset has built; live
 * otherwise, recording the miss so the worker materialises what was asked for.
 * A newly published report therefore serves correct data on its first opening
 * and gets fast on its own — nothing waits for a registry edit.
 */
export async function reportFor(a: Assignment): Promise<Report> {
  const snap = await activeSnapshot(SALES_TARGET_DATASET)

  if (!snap) {
    await recordMiss(SALES_TARGET_DATASET)
    const live = await fromLive(a)
    const dataThrough = live.asOf && live.asOf < PERIOD.period_end ? live.asOf : PERIOD.period_end
    return {
      source: 'live',
      source_as_of: live.asOf,
      generated_at: null, // read straight from the source: there is nothing to be stale
      snapshot_id: null,
      ...live.store,
      period_start: PERIOD.period_start,
      period_end: PERIOD.period_end,
      data_through: dataThrough,
      cutoff_early: dataThrough < PERIOD.period_end,
      ...shape(live.grouped),
    }
  }

  const grouped = await fromSnapshot(a, snap.row_id)
  const store = await storeOf(snap.row_id, a.plant_code)
  const asOf = snap.source_as_of // already an ISO day: activeSnapshot normalises it
  const dataThrough = asOf && asOf < PERIOD.period_end ? asOf : PERIOD.period_end
  return {
    source: 'snapshot',
    source_as_of: asOf,
    generated_at: iso(snap.activated_at ?? snap.built_at),
    snapshot_id: snap.row_id,
    ...store,
    period_start: PERIOD.period_start,
    period_end: PERIOD.period_end,
    data_through: dataThrough,
    cutoff_early: dataThrough < PERIOD.period_end,
    ...shape(grouped),
  }
}
