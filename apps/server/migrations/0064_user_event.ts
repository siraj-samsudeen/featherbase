// #101 Phase 3: the server-side recent-actions log. Read-side intent — rows
// visited, lists filtered, searches run — lands here in client batches;
// mutations already live in Version / activity_log and are NOT duplicated.
// Append-only like the PLAT-007 audit tables (direct insert, never saveDoc,
// so a user cannot edit their own trail) and pruned at ~90 days: this is a
// convenience trail with audit flavor, not a compliance log. Reads go
// through dedicated endpoints that scope to the caller — the table itself
// carries no role permissions, so it never surfaces in ordinary list views.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'User Event'`
  if (exists) return
  await createTable({
    name: 'User Event',
    module: 'Core',
    system: true,
    columns: [
      {
        column_name: 'kind',
        column_type: 'Choice',
        choices: 'row\nlist\npage\nsearch',
        reqd: true,
        in_list_view: true,
      },
      // Long Text (-> text), NOT Data (-> varchar(140)): list keys and paths
      // embed filter JSON and the API contract accepts up to 400/1000 chars —
      // one oversized value must never fail a whole batch (0066 converges
      // databases that ran the earlier Data-typed shape).
      { column_name: 'ref_key', column_type: 'Long Text', reqd: true, in_list_view: true },
      { column_name: 'label', column_type: 'Long Text', in_list_view: true },
      { column_name: 'sub_label', column_type: 'Long Text' },
      { column_name: 'path', column_type: 'Long Text' },
      { column_name: 'occurred_at', column_type: 'Datetime', reqd: true, in_list_view: true },
    ],
  })
  // The feed, the cross-device sync, and the prune all scan one user's
  // slice by time.
  await sql.unsafe(
    `create index if not exists user_event_user_time on user_event (created_by, occurred_at desc)`,
  )
}
