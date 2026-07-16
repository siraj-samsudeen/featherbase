import { randomBytes } from 'node:crypto'
import { registerJob } from '../jobs'
import { sql } from '../db'

// Reference jobs used to exercise the queue (JOB-001/002/003).

// JOB-001: writes a row into a scratch table so the effect is observable.
registerJob('demo_write_row', async (payload) => {
  await sql`create table if not exists job_demo_rows (
    id text primary key, note text, created_at timestamptz not null default now())`
  await sql`insert into job_demo_rows (id, note) values (${randomBytes(5).toString('hex')}, ${String(payload.note ?? '')})`
})

// JOB-002: fails a configured number of times (tracked in a counter table)
// before succeeding — exercises retry accounting.
registerJob('demo_flaky', async (payload) => {
  const key = String(payload.key ?? 'default')
  const failUntil = Number(payload.fail_until ?? 0)
  await sql`create table if not exists job_flaky_counter (key text primary key, count int not null default 0)`
  const [row] = await sql`
    insert into job_flaky_counter (key, count) values (${key}, 1)
    on conflict (key) do update set count = job_flaky_counter.count + 1
    returning count`
  if ((row.count as number) <= failUntil) throw new Error(`intentional failure #${row.count}`)
})

// A job that always throws — lands in the failed state (JOB-002).
registerJob('demo_always_fails', async () => {
  throw new Error('this job always fails')
})

// JOB-003: recurring heartbeat — counts its own executions.
registerJob('demo_heartbeat', async () => {
  await sql`create table if not exists job_heartbeat (id text primary key, at timestamptz not null default now())`
  await sql`insert into job_heartbeat (id) values (${randomBytes(5).toString('hex')})`
})
