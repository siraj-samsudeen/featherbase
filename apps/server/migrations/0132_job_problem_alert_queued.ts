// #464 / #601: remember notification separately from execution history.
// A retried queue row still belongs to the same failure episode.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  await sql`alter table scheduled_job add column if not exists problem_alert_queued boolean default false`
  const [have] = await sql`
    select 1 from column_def where parent = 'Scheduled Job' and column_name = 'problem_alert_queued'`
  if (!have) {
    const [{ position }] = await sql`
      select coalesce(max(position), 0)::int + 1 as position from column_def where parent = 'Scheduled Job'`
    await sql`insert into column_def ${sql({
      parent: 'Scheduled Job', position,
      column_name: 'problem_alert_queued', column_type: 'Check',
      label: 'Problem alert queued', default_value: '0',
      reqd: false, unique: false, read_only: true, hidden: true,
      in_list_view: false, tier: 'basic',
    })}`
  }
  invalidateMeta('Scheduled Job')
}
