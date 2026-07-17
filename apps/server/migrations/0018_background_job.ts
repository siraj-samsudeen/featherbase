// JOB-001/002/003: a durable job queue. Jobs are Background Job documents so
// they are queryable through the normal API/UI; a Job Execution logs each
// attempt (JOB-002/003 audit trail).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Background Job'`
  if (!exists) {
    await createDocType({
      name: 'Background Job',
      module: 'Core',
      fields: [
        { fieldname: 'method', fieldtype: 'Data', reqd: true, in_list_view: true },
        { fieldname: 'payload', fieldtype: 'JSON' },
        { fieldname: 'status', fieldtype: 'Select', options: 'queued\nrunning\ndone\nfailed', default_value: 'queued', in_list_view: true },
        { fieldname: 'attempts', fieldtype: 'Int', default_value: '0', in_list_view: true },
        { fieldname: 'max_attempts', fieldtype: 'Int', default_value: '3' },
        { fieldname: 'run_at', fieldtype: 'Datetime' },
        { fieldname: 'error', fieldtype: 'Text' },
        // JOB-003: recurring jobs re-enqueue on this interval (seconds).
        { fieldname: 'repeat_every', fieldtype: 'Int' },
      ],
    })
  }

  const [le] = await sql`select 1 from tab_doctype where name = 'Job Execution'`
  if (!le) {
    await createDocType({
      name: 'Job Execution',
      module: 'Core',
      fields: [
        { fieldname: 'job', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'method', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'attempt', fieldtype: 'Int', in_list_view: true },
        { fieldname: 'outcome', fieldtype: 'Select', options: 'success\nerror', in_list_view: true },
        { fieldname: 'error', fieldtype: 'Text' },
      ],
    })
  }
}
