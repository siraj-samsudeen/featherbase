import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { CADENCE_SECONDS, syncScheduledJobs } from '../jobs'

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
      const cadence = String(row.cadence ?? '')
      if (!(cadence in CADENCE_SECONDS))
        throw new AppError('ValidationError', `Unknown cadence "${cadence}"`, {
          cadence: `one of: ${Object.keys(CADENCE_SECONDS).join(', ')}`,
        })
    },
    // The queue must reflect the COMMITTED row: syncing inside the save
    // transaction would let a concurrent worker tick read the old cadence
    // back in, and a rolled-back save would have already re-timed the queue.
    after_commit: async ({ row }) => {
      await syncScheduledJobs(String(row.method))
    },
    on_trash: async ({ row, tx }) => {
      await tx`delete from background_job where method = ${String(row.method)} and job_status = 'queued'`
    },
  },
}

export default controller
