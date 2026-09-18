// Recurring jobs become data an administrator can edit.
//
// Until now every recurring cadence was a literal in code — three boot blocks
// in index.ts (auto_email_reports daily, check_sla minutely, refresh_datasets
// four-hourly) and an app manifest's `every_seconds` — re-seeded on every
// restart. Nothing in the Admin could change one, and a failed run (attempts
// exhausted) silently ended the recurrence until the next restart re-seeded it.
//
// `Scheduled Job` is the registry: one row per recurring method, with a
// constrained cadence (a Choice, never free-text seconds — the warehouse this
// serves runs on a fixed grid, data-warehouse #3036/#3082, so "every 4 hours"
// is a decision and "14,400" is an accident waiting to happen), an enabled
// switch, and the last run's outcome and duration written back by the worker.
// jobs.ts `syncScheduledJobs` turns rows into queue entries at boot and after
// every save; the re-enqueue after each run reads the row, so an edit takes
// effect on the very next run without a restart.
//
// Alongside it, two observability columns the queue was missing: Job Execution
// gains `started_at` and `duration_ms` (how long did it take — the question an
// outcome alone cannot answer), and Background Job gains `trigger` (why does
// this row exist: the clock, a reader's demand, a person, a retry).
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { createTable, pgType } from '../src/table-engine'

export const CADENCE_CHOICES = ['every minute', 'every 15 minutes', 'hourly', 'every 4 hours', 'daily']

// Idempotent column add on an existing engine Table: physical column plus its
// column_def row (the 0048 pattern).
async function addColumn(
  table: string,
  physical: string,
  column: {
    column_name: string
    column_type: string
    label: string
    choices?: string
    default_value?: string
    in_list_view?: boolean
    read_only?: boolean
  },
) {
  const [have] = await sql`
    select 1 from column_def where parent = ${table} and column_name = ${column.column_name}`
  if (have) return
  const type = pgType(column.column_type)
  if (type)
    await sql.unsafe(`alter table ${physical} add column if not exists "${column.column_name}" ${type}`)
  const [{ maxidx }] = await sql`
    select coalesce(max(position), 0)::int as maxidx from column_def where parent = ${table}`
  await sql`insert into column_def ${sql({
    parent: table,
    position: (maxidx as number) + 1,
    column_name: column.column_name,
    label: column.label,
    column_type: column.column_type,
    choices: column.choices ?? null,
    reqd: false,
    unique: false,
    default_value: column.default_value ?? null,
    read_only: column.read_only ?? false,
    hidden: false,
    in_list_view: column.in_list_view ?? false,
    tier: 'basic',
  })}`
}

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Scheduled Job'`
  if (!exists) {
    await createTable({
      name: 'Scheduled Job',
      module: 'Core',
      system: true,
      // The method IS the identity: /admin/scheduled-job/refresh_datasets.
      id_pattern: 'field:method',
      title_column: 'method',
      columns: [
        { column_name: 'method', column_type: 'Data', reqd: true, unique: true, in_list_view: true },
        {
          column_name: 'cadence',
          column_type: 'Choice',
          choices: CADENCE_CHOICES.join('\n'),
          reqd: true,
          in_list_view: true,
        },
        { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
        { column_name: 'description', column_type: 'Text' },
        // Written by the worker after every run; read-only so the record of
        // what happened cannot be edited into what should have happened.
        { column_name: 'last_run_at', column_type: 'Datetime', read_only: true, in_list_view: true },
        {
          column_name: 'last_outcome',
          column_type: 'Choice',
          choices: 'success\nerror',
          read_only: true,
          in_list_view: true,
        },
        { column_name: 'last_duration_ms', column_type: 'Int', read_only: true, in_list_view: true },
      ],
    })
  }

  await addColumn('Job Execution', 'job_execution', {
    column_name: 'started_at',
    column_type: 'Datetime',
    label: 'Started At',
    in_list_view: true,
  })
  await addColumn('Job Execution', 'job_execution', {
    column_name: 'duration_ms',
    column_type: 'Int',
    label: 'Duration (ms)',
    in_list_view: true,
  })
  await addColumn('Background Job', 'background_job', {
    column_name: 'trigger',
    column_type: 'Choice',
    label: 'Trigger',
    choices: 'schedule\ndemand\nmanual\nretry',
    in_list_view: true,
  })

  // The three recurrences the server used to seed from literals. Direct
  // inserts, not saveDoc: a migration runs before controllers are wired, and
  // the queue entries are made by the boot sync, not here.
  const seeds = [
    {
      method: 'auto_email_reports',
      cadence: 'daily',
      description: 'Send every enabled Auto Email Report whose schedule is due.',
    },
    {
      method: 'check_sla',
      cadence: 'every minute',
      description: 'Escalate rows past their SLA resolution deadline.',
    },
    {
      method: 'refresh_datasets',
      cadence: 'every 4 hours',
      description:
        'Rebuild every dataset snapshot a report has asked for. Four-hourly to follow the ' +
        'warehouse fleet grid an hour behind its dbt build (data-warehouse #3036/#3082); a ' +
        'cache miss also wakes this job immediately, so a new report never waits a full period.',
    },
  ]
  for (const s of seeds) {
    const [have] = await sql`select 1 from scheduled_job where method = ${s.method}`
    if (have) continue
    await sql`insert into scheduled_job ${sql({
      row_id: s.method,
      created_by: 'Administrator',
      updated_by: 'Administrator',
      method: s.method,
      cadence: s.cadence,
      enabled: true,
      description: s.description,
    })}`
  }
  invalidateMeta()
}
