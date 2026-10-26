// #463: a Job Execution row says what the run came to when success alone
// cannot, e.g. a leaver-check summary that reached nobody because no System
// Manager has an email address. Written by the worker (JobContext.setResult),
// so read-only. Same idempotent column_def pattern as 0086.
import { sql } from '../src/db'

export async function up() {
  const [table] = await sql`select 1 from table_def where name = 'Job Execution'`
  if (!table) return
  const [have] = await sql`select 1 from column_def where parent = 'Job Execution' and column_name = 'result'`
  if (have) return
  await sql`alter table job_execution add column if not exists result text`
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Job Execution'`
  await sql`insert into column_def ${sql({
    parent: 'Job Execution',
    position: (maxidx as number) + 1,
    column_name: 'result',
    label: 'Result',
    column_type: 'Text',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: true,
    hidden: false,
    in_list_view: true,
    tier: 'basic',
  })}`
}
