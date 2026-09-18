import { registerJob } from '../jobs'
import { buildSnapshot, pendingMisses, pruneSnapshots, registeredDatasets, activeSnapshot } from '../dataset-snapshot'
// Importing the definition is what registers it. Datasets are registered by
// import, like controllers and job handlers, so adding one is adding a file.
import '../datasets/sales-target-mtd'

// Refresh every dataset that has been asked for. Recurring: its cadence is the
// `refresh_datasets` Scheduled Job row (seeded four-hourly by migration 0086,
// editable in the Admin), not a constant here. A cache miss also enqueues it
// on demand (dataset-snapshot.ts recordMiss).

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
