/**
 * Evidence for openspec/changes/query-grained-dataset-snapshots, Requirement 4:
 * "A snapshot is accepted only on measured size and latency evidence."
 *
 * Builds the sales-target snapshot from MotherDuck, then times the SAME
 * personalised read both ways — from the snapshot and live at the source — and
 * checks every employee's numbers against the shared baseline.
 *
 * Run:  MOTHERDUCK_TOKEN=... pnpm --filter server tsx scripts/measure-sales-target-snapshot.ts
 */
import { readFileSync } from 'node:fs'
import { sql, _getRootSql } from '../src/db'
import { buildSnapshot, activeSnapshot, pruneSnapshots } from '../src/dataset-snapshot'
import { SALES_TARGET_DATASET, _liveReader, definitionSql } from '../src/datasets/sales-target-mtd'
import { reportFor } from '../src/sales-target-report'
import { PERIOD, type Assignment } from '../src/sales-target'
import '../src/datasets/sales-target-mtd'

const SHARED = process.env.SALES_TARGET_SHARED ?? '/home/user/data-warehouse/experiments/issue_3755/shared'
const REPEATS = 7

const ASSIGNMENTS: Assignment[] = JSON.parse(readFileSync(`${SHARED}/assignments.json`, 'utf8')).map(
  (a: { plant_code: string; store_label: string; material_groups: string[] }) => ({
    plant_code: a.plant_code,
    store_label: a.store_label,
    material_groups: a.material_groups,
  }),
)

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const ms = (n: number) => `${n.toFixed(1)} ms`

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now()
  const out = await fn()
  return [out, performance.now() - t0]
}

/** employee_totals.csv rows for the initial assignment scenario. */
function expectedTotals(): Map<string, { target: number; actual: number }> {
  const out = new Map<string, { target: number; actual: number }>()
  const lines = readFileSync(`${SHARED}/employee_totals.csv`, 'utf8').trim().split('\n').slice(1)
  for (const line of lines) {
    // scenario,username,plant_code,"codes",total_target,total_actual,gap,achievement
    const m = /^(\w+),([\w_]+),(\d+),"?([\d,]+)"?,([\d.-]+),([\d.-]+),/.exec(line)
    if (!m || m[1] !== 'initial') continue
    out.set(`${m[3]}|${m[4].split(',').sort().join(',')}`, { target: Number(m[5]), actual: Number(m[6]) })
  }
  return out
}

async function main() {
  console.log('## Build\n')
  const [outcome, buildMs] = await timed(() => buildSnapshot(SALES_TARGET_DATASET))
  if (outcome.status !== 'activated') {
    console.error(`build did not activate: ${outcome.status} — ${outcome.reason}`)
    process.exit(1)
  }
  console.log(`status        ${outcome.status}`)
  console.log(`rows          ${outcome.rowCount?.toLocaleString('en-IN')}`)
  console.log(`source as-of  ${outcome.sourceAsOf}`)
  console.log(`build time    ${(buildMs / 1000).toFixed(1)} s  (fetch from MotherDuck + load into Postgres)`)

  const [size] = await sql`
    select pg_size_pretty(pg_total_relation_size('sales_target_snapshot_row')) as pretty,
           pg_total_relation_size('sales_target_snapshot_row')                 as bytes`
  console.log(`size in PG    ${size.pretty} (${Number(size.bytes).toLocaleString('en-IN')} bytes)`)

  const snap = await activeSnapshot(SALES_TARGET_DATASET)
  console.log(`snapshot id   ${snap?.row_id}`)

  console.log('\n## Personalised read — snapshot vs live\n')
  console.log('| employee | store | codes | snapshot | live (warm conn) | live (cold conn) | speed-up vs warm |')
  console.log('|---|---|---|---|---|---|---|')

  // A POOLED connection for the live timings. `motherduckReader` opens and
  // closes an instance per call, which is the honest cost of a cold path but not
  // what a live-mode server would pay — it would hold the connection. Timing the
  // cold path against a warm snapshot would flatter the snapshot, so both are
  // reported: cold (connect + query) and warm (query on a held connection).
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(`md:?motherduck_token=${process.env.MOTHERDUCK_TOKEN}`)
  const heldConn = await instance.connect()
  const warmRead = async (text: string) => (await heldConn.runAndReadAll(text)).getRows() as unknown[][]

  const read = _liveReader()
  const totalSnap: number[] = []
  const totalLive: number[] = []
  const totalWarm: number[] = []

  for (const [i, a] of ASSIGNMENTS.entries()) {
    const snapTimes: number[] = []
    for (let n = 0; n < REPEATS; n++) snapTimes.push((await timed(() => reportFor(a)))[1])

    // The same slice, at the source: the dataset SQL with this reader's
    // personalisation predicate put back.
    const codes = a.material_groups.map((c) => `'${c}'`).join(', ')
    const scoped = `with base as (${definitionSql(PERIOD.period_start, PERIOD.period_end)})
      select b.hierarchy_code, sum(b.target_daily_before_tax), sum(b.actual_before_tax), count(b.actual_before_tax)
      from base b where b.plant_code = '${a.plant_code}' and b.hierarchy_code in (${codes})
      group by b.hierarchy_code order by 1`
    const liveTimes: number[] = []
    for (let n = 0; n < REPEATS; n++) liveTimes.push((await timed(() => read(scoped)))[1])
    const warmTimes: number[] = []
    for (let n = 0; n < REPEATS; n++) warmTimes.push((await timed(() => warmRead(scoped)))[1])

    const s = median(snapTimes)
    const l = median(liveTimes)
    const w = median(warmTimes)
    totalSnap.push(s)
    totalLive.push(l)
    totalWarm.push(w)
    console.log(
      `| test_employee_${i + 1} | ${a.plant_code} | ${a.material_groups.length} | ${ms(s)} | ${ms(w)} | ${ms(l)} | ${(w / s).toFixed(0)}× |`,
    )
  }

  console.log(
    `\nmedian across employees — snapshot ${ms(median(totalSnap))}, ` +
      `live warm ${ms(median(totalWarm))}, live cold ${ms(median(totalLive))}`,
  )
  heldConn.closeSync()
  instance.closeSync()

  console.log('\n## Correctness against the shared baseline\n')
  const expected = expectedTotals()
  let allOk = true
  for (const [i, a] of ASSIGNMENTS.entries()) {
    const r = await reportFor(a)
    const key = `${a.plant_code}|${[...a.material_groups].sort().join(',')}`
    const want = expected.get(key)
    if (!want) {
      console.log(`test_employee_${i + 1}: NO BASELINE ROW for ${key}`)
      allOk = false
      continue
    }
    const okT = Math.abs((r.total.target ?? 0) - want.target) < 0.01
    const okA = Math.abs((r.total.actual ?? 0) - want.actual) < 0.01
    if (!okT || !okA) allOk = false
    console.log(
      `test_employee_${i + 1}  target ${r.total.target} vs ${want.target} ${okT ? 'OK' : 'MISMATCH'}` +
        `   actual ${r.total.actual} vs ${want.actual} ${okA ? 'OK' : 'MISMATCH'}` +
        `   source=${r.source} as_of=${r.source_as_of}`,
    )
  }

  await pruneSnapshots(SALES_TARGET_DATASET)
  console.log(`\n${allOk ? 'ALL MATCH the baseline' : 'MISMATCHES ABOVE'}`)
  await _getRootSql().end()
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
