// JOB-001/002/003: a durable job queue. Jobs are Background Job rows so
// they are queryable through the normal API/UI; a Job Execution logs each
// attempt (JOB-002/003 audit trail).
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Background Job'`
  if (!exists) {
    await createTable({
      name: 'Background Job',
      module: 'Core',
      columns: [
        { column_name: 'method', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'payload', column_type: 'JSON' },
        { column_name: 'job_status', column_type: 'Choice', choices: 'queued\nrunning\ndone\nfailed', default_value: 'queued', in_list_view: true },
        { column_name: 'attempts', column_type: 'Int', default_value: '0', in_list_view: true },
        { column_name: 'max_attempts', column_type: 'Int', default_value: '3' },
        { column_name: 'run_at', column_type: 'Datetime' },
        { column_name: 'error', column_type: 'Text' },
        // JOB-003: recurring jobs re-enqueue on this interval (seconds).
        { column_name: 'repeat_every', column_type: 'Int' },
      ],
    })
  }

  const [le] = await sql`select 1 from table_def where name = 'Job Execution'`
  if (!le) {
    await createTable({
      name: 'Job Execution',
      module: 'Core',
      columns: [
        { column_name: 'job', column_type: 'Data', in_list_view: true },
        { column_name: 'method', column_type: 'Data', in_list_view: true },
        { column_name: 'attempt', column_type: 'Int', in_list_view: true },
        { column_name: 'outcome', column_type: 'Choice', choices: 'success\nerror', in_list_view: true },
        { column_name: 'error', column_type: 'Text' },
      ],
    })
  }
}
