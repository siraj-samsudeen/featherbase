// Copied into the pinned historical checkout by release-upgrade.test.ts.
// Imports intentionally resolve against that checkout's engine, not today's.
import { registerApp, installApp } from '../../src/apps'
import { saveDoc } from '../../src/document'
import { sql } from '../../src/db'

registerApp({
  name: 'task-management',
  tables: [
    { name: 'Team Project', module: 'Tasks', columns: [
      { column_name: 'project_name', column_type: 'Data', label: 'Project' },
    ] },
    { name: 'Team Task', module: 'Tasks', columns: [
      { column_name: 'task_title', column_type: 'Data', label: 'Task' },
      { column_name: 'project', column_type: 'Reference', reference_table: 'Team Project', label: 'Project' },
    ] },
  ],
  permissions: [
    { table: 'Team Project', role: 'All', can_read: true },
    { table: 'Team Task', role: 'All', can_read: true, can_write: true },
    { table: 'User', role: 'All', can_read: true },
  ],
})
await installApp('task-management')
await saveDoc('Team Project', { row_id: 'project-73', project_name: 'Preserved project' }, 'Administrator', 'insert')
await saveDoc('Team Task', { row_id: 'task-19', task_title: 'Asymmetric task', project: 'project-73' }, 'Administrator', 'insert')
await saveDoc('Comment', {
  row_id: 'comment-41', ref_table: 'Team Task', ref_name: 'task-19', content: 'Keep discussion',
}, 'Administrator', 'insert')
await sql`update "user" set full_name = 'Migration sentinel' where row_id = 'Administrator'`
await sql`insert into public.site (name, host, schema) values ('legacy-site', 'legacy.invalid', 'tenant_legacy')`
await sql`insert into user_settings ("user", table_name, settings)
  values ('Administrator', 'Task Management Focus', '{"task_ids":["task-19"]}')`
await sql`insert into permission (row_id, ref_table, role, can_read)
  values ('independent-grant', 'User', 'All', true)`
await sql.end()
