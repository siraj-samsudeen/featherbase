import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from './pg-test'
import prototype from './tasker-prototype'
import { registerApp, installApp, loadInstalledApps } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

// 0090 is immutable migration history whose original physical source was
// public. These focused behavior tests run after 0094, so adapt only that
// historical physical/function vocabulary to the converged layout. The exact
// unmodified cf88a7b -> 0094 path is exercised by the migration proof.
const onConvergedStorage = (body: string) => body
  .replaceAll('public.%I', 'featherbase.%I')
  .replaceAll("'public'", "'featherbase'")
  .replaceAll('using (fc_has_read(', 'using (featherbase.fc_has_read(')

const runTransition = (body: string) => sql.begin(async tx => {
  await tx.unsafe('set local search_path = featherbase, pg_temp')
  await tx.unsafe(body)
})

// @spec prototype_transition_preserves_work.occupied_destination_aborts
test('PKG-H1: prototype transition refuses occupied destinations without changing old work', async ({ admin }) => {
  registerApp(prototype)
  await installApp('task-management')
  const task = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Team Task', row: { task_title: 'Do not discard' } })
  await sql`create schema if not exists tasker`
  await sql`create table tasker.task (sentinel text)`
  const migration = onConvergedStorage(await readFile(resolve('migrations/0090_tasker_prototype.sql'), 'utf8'))
  await expect(runTransition(migration)).rejects.toThrow('refusing to merge or discard')
  expect(await admin.get(`/api/table/Team%20Task/${task.row_id}`)).toMatchObject({ task_title: 'Do not discard' })
})

// @spec prototype_transition_preserves_work.transition_keeps_discussion_and_focus
test('PKG-H1: prototype transition preserves work, references, comments, focus and grants', async ({ admin, createUser }) => {
  registerApp(prototype)
  await installApp('task-management')
  const member = await createUser({ email: 'prototype-member@example.com', roles: [] })
  const project = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Team Project', row: { project_name: 'Transition project' },
  })
  const task = await member.post<{ row_id: string }>('/api/save_row', {
    table: 'Team Task', row: { task_title: 'Keep this work', project: project.row_id, task_state: 'In progress' },
  })
  const comment = await member.post<{ row_id: string }>('/api/save_row', { table: 'Comment', row: {
    ref_table: 'Team Task', ref_name: task.row_id, content: 'Keep this discussion',
  } })
  const version = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Version', row: {
    ref_table: 'Team Task', ref_name: task.row_id, data: { changed: ['task_state'] },
  } })
  const file = await admin.post<{ row_id: string }>('/api/save_row', { table: 'File', row: {
    file_name: 'transition-note.txt', ref_table: 'Team Task', ref_name: task.row_id,
  } })
  const share = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Share', row: {
    share_table: 'Team Task', share_name: task.row_id, user: member.user, read: true,
  } })
  await member.put('/api/user_settings/Task%20Management%20Focus', { task_ids: [task.row_id] })
  // Recreate the old shared-grant adoption case: another runtime app owns the
  // one User grant and Task Management has no ledger entry or stored manifest.
  const [sharedUserGrant] = await sql`
    select p.row_id from permission p join installed_app app on p.row_id in (
      select jsonb_array_elements_text(app.perms)
    ) where app.name = 'task-management' and p.ref_table = 'User'`
  await sql`
    update installed_app set perms = perms - ${String(sharedUserGrant.row_id)}
    where name = 'task-management'`
  await sql`
    insert into installed_app (name, perms, manifest, runtime_package)
    values (
      'other', ${sql.json([String(sharedUserGrant.row_id)])},
      ${sql.json({ permissions: [{ table: 'User', role: 'All', can_read: true }] })}, true
    )`
  const migration = onConvergedStorage(await readFile(resolve('migrations/0090_tasker_prototype.sql'), 'utf8'))
  await runTransition(migration)
  await runTransition(migration)
  await sql.unsafe(await readFile(resolve('migrations/0091_runtime_api_only.sql'), 'utf8'))
  await sql.unsafe(await readFile(resolve('migrations/0092_runtime_permission_owner.sql'), 'utf8'))
  expect(await sql`select has_table_privilege('app_client', 'tasker.task', 'select') as allowed`).toMatchObject([{ allowed: false }])
  expect(await sql`
    select distinct owner_app from permission
    where row_id in (select jsonb_array_elements_text(perms) from installed_app where name = 'tasker')`
  ).toEqual([{ owner_app: 'tasker' }])
  expect(await sql`
    select owner_app from permission where ref_table = 'User' and owner_app in ('other', 'tasker')
    order by owner_app`
  ).toEqual([{ owner_app: 'other' }, { owner_app: 'tasker' }])
  invalidateMeta()
  expect(await discoverPackages([resolve('../..', 'runtime-apps/fixtures/tasker-v1')])).toEqual([])
  await loadInstalledApps()
  // @spec runtime_upgrade_identity.unversioned_legacy_install_fails_closed
  // 0090 recorded permissions only. Discovery cannot infer which package
  // version produced that schema; recovering a reviewed identity is explicit.
  await expect(member.get(`/api/table/tasker.task/${task.row_id}`)).rejects.toMatchObject({ status: 403 })
  expect(await sql`select task_title from tasker.task where row_id = ${task.row_id}`).toEqual([{ task_title: 'Keep this work' }])
  const packageRoot = resolve('../..', 'runtime-apps/fixtures/tasker-v1-production')
  const packageInfo = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  const recoveredManifest = { ...JSON.parse(await readFile(resolve(packageRoot, 'featherbase.json'), 'utf8')),
    migrations: [], packageName: packageInfo.name, packageVersion: packageInfo.version }
  await sql`update installed_app set package_version = ${packageInfo.version}, manifest = ${sql.json(recoveredManifest)} where name = 'tasker'`
  await discoverPackages([packageRoot])
  await loadInstalledApps()
  expect(await member.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({
    task_title: 'Keep this work', project: project.row_id, task_state: 'In progress',
  })
  expect(await member.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ project_name: 'Transition project' })
  expect(await member.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: [task.row_id] } })
  const comments = await member.get<{ data: unknown[] }>(`/api/table/Comment?filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', 'tasker.task']]))}&fields=["content"]`)
  expect(comments.data).toEqual([{ content: 'Keep this discussion' }])
  expect(await sql`select ref_table from comment where row_id = ${comment.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select ref_table from version where row_id = ${version.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select ref_table from file where row_id = ${file.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select share_table from share where row_id = ${share.row_id}`).toEqual([{ share_table: 'tasker.task' }])
  const saved = await member.get<Record<string, unknown>>(`/api/table/tasker.task/${task.row_id}`)
  expect(await member.post('/api/save_row', { table: 'tasker.task', row: { ...saved, is_done: true } }))
    .toMatchObject({ task_state: 'Done', state_before_done: 'In progress' })
  await admin.post('/api/set_app_enabled', { name: 'tasker', enabled: false })
  await expect(member.get('/api/table/Comment')).rejects.toMatchObject({ status: 403 })
  expect(await sql`select to_regclass('public.team_task') as old, to_regclass('tasker.task') as current`)
    .toMatchObject([{ old: null, current: 'tasker.task' }])
})
