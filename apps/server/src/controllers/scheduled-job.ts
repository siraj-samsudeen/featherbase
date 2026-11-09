import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { jobRegistrant, syncScheduledJobs } from '../jobs'
import { assertSystemManager } from '../permissions'
import { COPY_CADENCES } from 'shared'

// A Scheduled Job row IS the schedule. Saving one re-times its queue entry
// once the row is committed; deleting one withdraws the pending entry (a
// running one finishes and, finding no row, does not recur).
const controller: TableController = {
  table: 'Scheduled Job',
  hooks: {
    before_validate: async ({ row, old, isNew, tx, user }) => {
      // method is a required column: the save refuses a blank one before this hook.
      const method = String(row.method ?? old?.method ?? '').trim()
      if (method.startsWith('copy_refresh_')) {
        await assertSystemManager(user)
        // cadence is a required column, already merged with the saved row here.
        if (!COPY_CADENCES.includes(String(row.cadence) as typeof COPY_CADENCES[number]))
          throw new AppError('ValidationError', 'Choose a copied-table refresh cadence', { cadence: 'Every 15 minutes, hourly, every 4 hours or daily' })
      }
      // #700, Codex round 3: a job's method is the code it runs, so it is
      // fixed once the job exists: moving it would hand one job's handler
      // another job's schedule.
      if (!isNew && old && method !== String(old.method))
        throw new AppError('ValidationError', "A scheduled job's method cannot be changed. Add a new job for other code", { method: 'fixed' })
      // An app's job names are the app's: a row Admin adds may not take one.
      if (isNew && method.includes('.')) {
        const [app] = await tx`select name from installed_app where name = ${method.split('.')[0]}`
        const registrant = jobRegistrant(method)
        if (app || (registrant && registrant !== 'platform'))
          throw new AppError('ValidationError', `${method} is a job name of the app ${String(app?.name ?? registrant)}; only the app adds it`, { method: 'belongs to an app' })
      }
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
    // A copied-table refresh's row id IS its handler's method and its
    // linkage key: a rename would cascade the linkage away from the method
    // and silently stop every refresh. Nobody may rename one (#840 review).
    before_rename: async ({ row }) => {
      if (String(row.method).startsWith('copy_refresh_'))
        throw new AppError('ValidationError', 'A copied-table refresh cannot be renamed. Change its cadence on the copied table instead')
    },
    on_trash: async ({ row, tx, user }) => {
      if (String(row.method).startsWith('copy_refresh_')) await assertSystemManager(user)
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
