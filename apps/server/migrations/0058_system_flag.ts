// #74: `system` flag on Table metadata. A platform (engine) table and a
// user/app table are different facts from `module` — the sidebar used to
// infer "engine table" from the magic string module = 'Core', which broke
// the moment the Table Builder filed a user table under the default module.
// The flag is the discriminator now: system = true means "created by the
// migration chain", and the Desk sidebar GROUPS those under one collapsed
// System section (grouping, never hiding — every table stays reachable, and
// global search still spans them).
//
// user-created tables can never claim the flag: POST/PUT /api/doctype reject
// system: true (index.ts); only migrations and seeds may set it through
// createTable directly.
import { sql } from '../src/db'

// Every Table the migration chain (0002–0058) creates, enumerated from a
// freshly migrated database (`select name from table_def`). HD Ticket is
// gone by now (0057). Keep this list in sync if a later migration creates a
// new engine table — and have that migration pass system: true itself.
// (Exported for test/system-flag.test.ts, which pins both facts.)
export const ENGINE_TABLES = [
  'Access Log',
  'Activity Log',
  'Assignment Rule',
  'Assignment Rule User',
  'Auto Email Report',
  'Background Job',
  'Client Script',
  'Column',
  'Comment',
  'Custom Field',
  'Dashboard',
  'Data Scope',
  'Email Account',
  'Email Queue',
  'Email Rule',
  'Email Sink',
  'File',
  'Has Role',
  'Import Log',
  'Job Execution',
  'Letter Head',
  'Metadata Override',
  'Notification Log',
  'Permission',
  'Print Format',
  'Report',
  'Role',
  'Server Script',
  'Service Level Agreement',
  'Share',
  'SLA Priority',
  'System Settings',
  'Table',
  'ToDo',
  'Translation',
  'User',
  'Version',
  'Web Form',
  'Web Page',
  'Webhook',
  'Workflow',
  'Workflow Action',
  'Workflow Document State',
  'Workflow Transition',
  'Workspace',
]

export async function up() {
  await sql`alter table table_def add column if not exists system boolean not null default false`

  // Table describes itself: without a column_def row the generic list API
  // refuses `system` as a selected field (query.ts assertColumn), and the
  // sidebar could not fetch it. Fresh installs get the identical row from
  // 0004_bootstrap.sql; write paths are safe either way — Table/Column rows
  // are ENGINE_MANAGED (document.ts), so only /api/doctype can write them,
  // and those routes reject system: true.
  await sql`
    insert into column_def (parent, position, column_name, label, column_type)
    select 'Table', 8, 'system', 'System', 'Check'
    where not exists (select 1 from column_def where parent = 'Table' and column_name = 'system')`

  await sql`update table_def set system = true where name in ${sql(ENGINE_TABLES)}`
}
