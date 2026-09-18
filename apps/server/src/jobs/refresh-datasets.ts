import { registerJob } from '../jobs'
import { buildSnapshot, pendingMisses, pruneSnapshots, registeredDatasets, activeSnapshot } from '../dataset-snapshot'
// Importing the definition is what registers it. Datasets are registered by
// import, like controllers and job handlers, so adding one is adding a file.
import '../datasets/sales-target-mtd'

// Refresh every dataset that has been asked for. Recurring: the job re-enqueues
// itself (JOB-003 `repeatEvery`), so the cadence is data in `background_job`
// rather than a constant compiled into the server.
//
// Aligned to the warehouse fleet's 4-hourly grid, offset behind dbt-runner —
// refreshing on the same minute the build commits reads pre-build rows and
// reports data a day behind (data-warehouse #3082). Four hours, not four
// minutes: the snapshot's whole purpose is that a reader never waits for it.
export const REFRESH_EVERY_SECONDS = 4 * 60 * 60

/**
 * A dataset is refreshed when it has an outstanding miss (a reader asked for it
 * and it had not built) or when it already has an active snapshot to move
 * forward. A registered dataset nobody has ever opened is left alone — the cache
 * follows demand rather than a list someone maintained.
 */
export async function datasetsDue(): Promise<string[]> {
  const misses = new Set(await pendingMisses())
  for (const name of registeredDatasets()) if (await activeSnapshot(name)) misses.add(name)
  return [...misses]
}

registerJob('refresh_datasets', async () => {
  for (const dataset of await datasetsDue()) {
    const outcome = await buildSnapshot(dataset)
    // Fail loud in the log, keep serving last-good: a refused or failed build
    // leaves the previous snapshot active, which ages visibly rather than
    // disappearing. Never more destructive than not running at all.
    console.log(`[dataset] ${dataset}: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ''}` +
      (outcome.rowCount != null ? ` (${outcome.rowCount} rows)` : ''))
    if (outcome.status === 'activated') await pruneSnapshots(dataset)
  }
})
