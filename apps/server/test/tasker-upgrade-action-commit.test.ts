import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { sql } from '../src/db'
import { discoverPackages, runPackageAction, previewAppUpgrade, upgradeApp, activateAppUpgrade } from '../src/runtime-packages'
import { installApp, uninstallApp, setAppEnabled, loadInstalledApps } from '../src/apps'
import { withAppClientVersion } from '../src/app-lifecycle'
import { saveDoc } from '../src/document'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { app } from '../src/index'
import { version as oldVersion } from '../../../runtime-apps/tasker/package.json'

void app
const prove = process.env.TASKER_UPGRADE_ACTION_PROOF === '1' ? test : test.skip
const newVersion = '3.0.0'

prove('Tasker upgrade waits through committed action effects, then gates obsolete replay and preserves disable', async () => {
  const [identity] = await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`
  const expectedDatabase = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1))
  expect(expectedDatabase).toMatch(/^featherbase_[a-z0-9_]+_actions_commit_e2e$/)
  expect(identity).toEqual({ name: expectedDatabase, environment: 'test' })
  const source = resolve('../..', 'runtime-apps/tasker')
  const target = await mkdtemp(resolve('test/.tasker-action-upgrade-'))
  await cp(source, target, { recursive: true, filter: file => !file.split('/').includes('node_modules') })
  const manifestPath = resolve(target, 'featherbase.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.migrations.push({ id: 'action_race_probe', fromVersion: oldVersion, toVersion: newVersion, operations: [] })
  await writeFile(manifestPath, JSON.stringify(manifest))
  const packagePath = resolve(target, 'package.json')
  await writeFile(packagePath, JSON.stringify({ ...JSON.parse(await readFile(packagePath, 'utf8')), version: newVersion }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let effects = 0
  let action: Promise<unknown> | undefined
  let upgrade: Promise<unknown> | undefined
  let queuedReplay: Promise<unknown> | undefined
  let disable: Promise<unknown> | undefined
  const controller: TableController = { table: 'tasker.project', hooks: { after_commit: async () => {
    effects++
    expect(await sql`select result from runtime_action_result where idempotency_key = 'upgrade-race'`).toHaveLength(1)
    await gate
  } } }
  try {
    expect(await discoverPackages([source])).toEqual([])
    await installApp('tasker')
    expect(await discoverPackages([source, target])).toEqual([])
    await loadInstalledApps()
    const task = await saveDoc('tasker.task', { task_title: 'Preserve 37, not 83' }, 'Administrator', 'insert')
    const request = { idempotencyKey: 'upgrade-race', payload: { row_id: task.row_id, updated_at: new Date(task.updated_at as string).toISOString() } }
    const run = (version: string) => withAppClientVersion(`tasker@${version}`, () => runPackageAction('tasker', 'promote', request, 'Administrator'))
    const plan = await previewAppUpgrade('tasker', newVersion)
    registerController(controller)
    action = run(oldVersion)
    await expect.poll(() => effects).toBe(1)
    let upgraded = false
    upgrade = upgradeApp('tasker', newVersion, plan.planId).then(result => { upgraded = true; return result })
    await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity where datname = current_database() and wait_event = 'advisory'`)[0].n)).toBeGreaterThanOrEqual(1)
    queuedReplay = run(oldVersion).then(value => ({ value }), error => ({ error }))
    disable = setAppEnabled('tasker', false)
    await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity where datname = current_database() and wait_event = 'advisory'`)[0].n)).toBeGreaterThanOrEqual(3)
    expect(upgraded).toBe(false)
    release()
    const result = await action
    await upgrade
    expect(await queuedReplay).toMatchObject({ error: { type: 'PermissionError' } })
    await disable
    await expect(run(oldVersion)).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(run(newVersion)).rejects.toMatchObject({ type: 'PermissionError' })
    await activateAppUpgrade('tasker', newVersion)
    expect(await sql`select enabled from installed_app where name = 'tasker'`).toEqual([{ enabled: false }])
    await expect(run(newVersion)).rejects.toMatchObject({ type: 'PermissionError' })
    await setAppEnabled('tasker', true)
    const [before] = await sql`select count(*)::int as n from access_log
      where "user" = 'Administrator' and operation = 'app_access_denied' and method = 'tasker.promote:permission'`
    await expect(run(oldVersion)).rejects.toMatchObject({ type: 'PermissionError', message: 'Application access refused' })
    expect(await sql`select count(*)::int as n from access_log
      where "user" = 'Administrator' and operation = 'app_access_denied' and method = 'tasker.promote:permission'`).toEqual([{ n: before.n + 1 }])
    expect(await run(newVersion)).toEqual(result)
    expect(effects).toBe(1)
    expect(await sql`select project_name from tasker.project`).toEqual([{ project_name: 'Preserve 37, not 83' }])
    expect(await sql`select row_id from tasker.task`).toHaveLength(0)
    await setAppEnabled('tasker', false)
    await activateAppUpgrade('tasker', newVersion)
    await expect(run(newVersion)).rejects.toMatchObject({ type: 'PermissionError' })
    expect(await sql`select enabled from installed_app where name = 'tasker'`).toEqual([{ enabled: false }])
    expect(await sql`select result from runtime_action_result where idempotency_key = 'upgrade-race'`).toHaveLength(1)
  } finally {
    release()
    await Promise.allSettled([action, upgrade, queuedReplay, disable])
    unregisterController(controller)
    await sql`delete from runtime_action_result where app = 'tasker'`
    await uninstallApp('tasker')
    await rm(target, { recursive: true, force: true })
  }
}, 30_000)
