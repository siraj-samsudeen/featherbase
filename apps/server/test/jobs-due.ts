import { sql } from '../src/db'

// The database clock (now()) cannot be moved by fake timers, so a job is made due by
// moving its run_at in SQL, not by moving the app's clock.

/** Makes one queued job due now. */
export async function makeJobDue(rowId: string) {
  await sql`update background_job set run_at = now() - interval '1 second' where row_id = ${rowId}`
}

/** Makes every queued job due now. */
export async function makeQueuedJobsDue() {
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen at BEGIN, while
// enqueue() stamps run_at from the wall clock. Mark any job whose run_at has passed by the wall
// clock (clock_timestamp) as due by the transaction clock.
export async function nudgeDueJobs() {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}
