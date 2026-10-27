// #464: the Jobs page. A run can end refused (the job declined to act, e.g. the
// leaver check on a stale feed), so `refused` joins the run outcomes on Job
// Execution and on a Scheduled Job's last run. A Scheduled Job also keeps its
// last run's one-line result, so the page reads one row per job rather than
// searching every Job Execution. Written by the worker, so read-only. Converges
// from any earlier state; a fresh database reaches the same end.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

const OUTCOMES = 'success\nerror\nrefused'

export async function up() {
  await sql`update column_def set choices = ${OUTCOMES}
    where ((parent = 'Job Execution' and column_name = 'outcome')
        or (parent = 'Scheduled Job' and column_name = 'last_outcome'))
      and choices is distinct from ${OUTCOMES}`

  const [table] = await sql`select 1 from table_def where name = 'Scheduled Job'`
  if (table) {
    await sql`alter table scheduled_job add column if not exists last_result text`
    const [have] = await sql`select 1 from column_def where parent = 'Scheduled Job' and column_name = 'last_result'`
    if (!have) {
      // Straight after the last outcome, ahead of the duration.
      const [after] = await sql`
        select position from column_def where parent = 'Scheduled Job' and column_name = 'last_outcome'`
      const position = after ? Number(after.position) + 1 : 1
      await sql`update column_def set position = position + 1 where parent = 'Scheduled Job' and position >= ${position}`
      await sql`insert into column_def ${sql({
        parent: 'Scheduled Job',
        position,
        column_name: 'last_result',
        label: 'Last Result',
        column_type: 'Text',
        reqd: false,
        unique: false,
        default_value: null,
        read_only: true,
        hidden: false,
        in_list_view: false,
        tier: 'basic',
      })}`
    }
  }
  invalidateMeta('Job Execution')
  invalidateMeta('Scheduled Job')
}
