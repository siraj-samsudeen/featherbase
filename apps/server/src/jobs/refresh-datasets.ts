import { registerJob } from '../jobs'
import { buildSnapshot, forgetMisses, pendingMisses, pruneSnapshots, registeredDatasets, activeSnapshot } from '../dataset-snapshot'
import { appDatasetServing } from '../app-datasets'
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
  const registered = new Set(registeredDatasets())
  const due = new Set<string>()
  for (const name of await pendingMisses()) {
    // #625: a dataset no app version declares any more (an upgrade dropped
    // it) can never build; its ask is closed rather than failing every run.
    if (registered.has(name)) due.add(name)
    else await forgetMisses(name)
  }
  for (const name of registered) if (await activeSnapshot(name)) due.add(name)
  const serving: string[] = []
  for (const name of due) {
    // #625: an app that is disabled or mid-upgrade is not refreshed, and its
    // asks are closed; a reader of the enabled app asks again.
    if (await appDatasetServing(name)) serving.push(name)
    else await forgetMisses(name)
  }
  return serving
}

registerJob('refresh_datasets', async (_payload, ctx) => {
  const failures: string[] = []
  for (const dataset of await datasetsDue()) {
    // The job's trigger travels onto the registry row: a refresh caused by a
    // reader's miss and one caused by the clock look different afterwards.
    const outcome = await buildSnapshot(dataset, { trigger: ctx.job.trigger })
    // Keep serving last-good regardless: a refused or failed build leaves the
    // previous snapshot active, which ages visibly rather than disappearing —
    // never more destructive than not running at all. But a build that did
    // not activate is still a failure the job queue must know about: silently
    // swallowing it here reported every refresh as a successful Job
    // Execution with no retry, however many datasets actually failed (review,
    // 19-Sep-2026). Collecting and re-throwing after the loop lets every
    // dataset still get its turn this run.
    console.log(`[dataset] ${dataset}: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ''}` +
      (outcome.rowCount != null ? ` (${outcome.rowCount} rows)` : '') +
      (outcome.fetchMs != null ? ` fetch ${outcome.fetchMs} ms, load ${outcome.loadMs} ms` : ''))
    if (outcome.status === 'activated') await pruneSnapshots(dataset)
    else failures.push(`${dataset}: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ''}`)
  }
  if (failures.length) throw new Error(`dataset refresh did not activate: ${failures.join('; ')}`)
})
