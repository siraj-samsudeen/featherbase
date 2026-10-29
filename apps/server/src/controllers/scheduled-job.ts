import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { syncScheduledJobs } from '../jobs'

// A Scheduled Job row IS the schedule. Saving one re-times its queue entry
// once the row is committed; deleting one withdraws the pending entry (a
// running one finishes and, finding no row, does not recur).
const controller: TableController = {
  table: 'Scheduled Job',
  hooks: {
    before_validate: ({ row }) => {
      const method = String(row.method ?? '').trim()
      if (!method) throw new AppError('ValidationError', 'method is required', { method: 'required' })
      row.method = method
      // cadence needs no check here: it is a required Choice column, so a
      // missing or unknown value is refused before any hook runs.
    },
    // The queue must reflect the COMMITTED row: syncing inside the save
    // transaction would let a concurrent worker tick read the old cadence
    // back in, and a rolled-back save would have already re-timed the queue.
    after_commit: async ({ row }) => {
      await syncScheduledJobs(String(row.method))
    },
    on_trash: async ({ row, tx }) => {
      // #700: an app's job is the app's for as long as it is installed: it
      // goes when the app is removed or an upgrade drops it, never by hand
      // (a re-created row would no longer be the app's).
      const [owned] = await tx`select owner_app from scheduled_job where row_id = ${String(row.row_id)}`
      if (owned?.owner_app)
        throw new AppError('ValidationError', `This job belongs to the app ${String(owned.owner_app)}. Switch it off here, or turn the app off; it is removed with the app`)
      await tx`delete from background_job where method = ${String(row.method)} and job_status = 'queued'`
    },
  },
}

export default controller
