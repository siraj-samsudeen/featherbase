// #101 review (PR #104): user_event's key/label/sub_label/path were created
// as Data (varchar(140)) while the /api/events contract accepts 400-char
// keys/labels and 1000-char paths — one filtered-list key over 140 chars
// failed its whole batch. Converge existing databases to text ('Long Text');
// fresh installs already get that shape from the rewritten 0064. Also add
// the plain occurred_at index the now-global retention delete scans.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  for (const col of ['ref_key', 'label', 'sub_label', 'path']) {
    await sql.unsafe(`alter table user_event alter column ${col} type text`)
  }
  await sql`
    update column_def set column_type = 'Long Text'
    where parent = 'User Event'
      and column_name in ('ref_key', 'label', 'sub_label', 'path')
      and column_type = 'Data'`
  await sql.unsafe(`create index if not exists user_event_occurred on user_event (occurred_at)`)
  invalidateMeta()
}
