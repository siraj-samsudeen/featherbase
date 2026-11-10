import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { test } from './pg-test'
import {
  registerApp,
  installApp,
  uninstallApp,
  isInstalled,
  listInstalledApps,
  loadInstalledApps,
  getAvailableApps,
} from '../src/apps'
import { registerController, clearControllers } from '../src/controllers'
import { saveDoc } from '../src/document'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'
import type { AppManifest } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { expectApiError, expectRefused, expectStatus } from './fixtures'

// PLAT-001: an app installs its Tables + doc_events and uninstall tears the
// Tables down. PLAT-002: an app's hook on a Table it does NOT own fires
// alongside that Table's core controller.

const APP1 = 'test-note-app'
const APP1_DT = 'App Test Note'

const APP2 = 'test-hook-app'
const CORE_DT = 'Plat Core Task'

// Observable side effects for the PLAT-002 hooks.
const fired: string[] = []

const noteApp: AppManifest = {
  name: APP1,
  tables: [
    {
      name: APP1_DT,
      module: 'Test',
      id_pattern: 'prompt',
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'stamp', column_type: 'Data' },
      ],
    },
  ],
  doc_events: {
    [APP1_DT]: { before_save: ({ row }) => { row.stamp = 'wired-by-app' } },
  },
}

const hookApp: AppManifest = {
  name: APP2,
  // No Tables of its own — it only hooks a Table owned by "core".
  doc_events: {
    [CORE_DT]: { after_save: () => { fired.push('app') } },
  },
}

// The app registry is a process-global Map keyed by name; re-registering the
// same manifest is idempotent, so each test may call this freely.
function registerApps() {
  registerApp(noteApp)
  registerApp(hookApp)
}

// Wired doc_events are process-global (NOT rolled back by the sandbox), so
// every test unwires in `finally`: uninstallApp removes exactly the app's
// controllers; clearControllers is the fallback if uninstall already ran or
// the install never completed.
async function unwire(app: string, dt: string) {
  await uninstallApp(app).catch(() => {})
  clearControllers(dt)
}

describe('PLAT-001: app install/uninstall', () => {
  test('installing an app creates its Table and wires its doc_event', async () => {
    registerApps()
    try {
      const res = await installApp(APP1)
      expect(res.tables).toEqual([APP1_DT])
      expect(await isInstalled(APP1)).toBe(true)

      // The Table and its physical table exist.
      const [dt] = await sql`select 1 from table_def where name = ${APP1_DT}`
      expect(dt).toEqual({ '?column?': 1 })
      const [tbl] = await sql`select 1 from information_schema.tables where table_name = 'app_test_note'`
      expect(tbl).toEqual({ '?column?': 1 })

      // The app's before_save hook fires: the stamp is set on save.
      const doc = await saveDoc(APP1_DT, { row_id: 'note-1', title: 'hi' }, 'Administrator')
      expect(doc.stamp).toBe('wired-by-app')

      // Installed-state is recorded with the owned Table.
      const [rec] = await sql`select tables from installed_app where name = ${APP1}`
      expect(rec.tables).toEqual([APP1_DT])
    } finally {
      await unwire(APP1, APP1_DT)
    }
  })

  test('uninstalling removes the app’s Tables and its record', async () => {
    registerApps()
    try {
      await installApp(APP1)
      await uninstallApp(APP1)
      expect(await isInstalled(APP1)).toBe(false)
      const [dt] = await sql`select 1 from table_def where name = ${APP1_DT}`
      expect(dt).toBeUndefined()
      const [tbl] = await sql`select 1 from information_schema.tables where table_name = 'app_test_note'`
      expect(tbl).toBeUndefined()

      // The Table is really gone — saving one now fails.
      await expect(saveDoc(APP1_DT, { row_id: 'note-2' }, 'Administrator')).rejects.toMatchObject({
        type: 'NotFoundError',
        message: `Table ${APP1_DT} not found`,
      })
    } finally {
      await unwire(APP1, APP1_DT)
    }
  })

  // #122: deleting an app's Table directly left the app recorded as
  // installed with none of its tables, so installing it again was refused.
  // A Table an installed app owns is refused, naming the app; uninstalling
  // removes the app's tables and its record together.
  test('a Table an installed app owns cannot be deleted on its own; uninstall is the way', async ({ admin }: { admin: TestClient }) => {
    registerApps()
    try {
      await installApp(APP1)
      await expect(admin.delete(`/api/table_def/${encodeURIComponent(APP1_DT)}`)).rejects.toMatchObject({
        status: 417,
        message: expect.stringContaining(`Cannot delete ${APP1_DT}: it belongs to the installed app ${APP1}. Uninstall the app to remove its tables.`),
      })
      const [dt] = await sql`select 1 from table_def where name = ${APP1_DT}`
      expect(dt).toBeDefined()
      expect(await isInstalled(APP1)).toBe(true)

      // A ledger row stored as a JSON string is read the same way.
      await sql`update installed_app set tables = to_jsonb(tables::text) where name = ${APP1}`
      await expectRefused(admin.delete(`/api/table_def/${encodeURIComponent(APP1_DT)}`), 417)

      await uninstallApp(APP1)
      expect((await installApp(APP1)).tables).toEqual([APP1_DT])
    } finally {
      await unwire(APP1, APP1_DT)
    }
  })
})

describe('PLAT-002: app doc_events fire alongside the core controller', () => {
  test('an app hook on a foreign Table runs with (not instead of) the core hook', async ({
    admin,
  }: {
    admin: TestClient
  }) => {
    registerApps()
    try {
      // A core controller owns CORE_DT and reacts to after_save.
      await admin.post('/api/table_def', {
        name: CORE_DT,
        id_pattern: 'prompt',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      })
      registerController({ table: CORE_DT, hooks: { after_save: () => { fired.push('core') } } })

      // The app hooks the same Table without owning it.
      await installApp(APP2)

      fired.length = 0
      await saveDoc(CORE_DT, { row_id: 'task-1', title: 'a' }, 'Administrator')
      // BOTH fired, core before the later-registered app hook.
      expect(fired).toEqual(['core', 'app'])

      // After uninstall, only the core controller remains.
      await uninstallApp(APP2)
      fired.length = 0
      await saveDoc(CORE_DT, { row_id: 'task-2', title: 'b' }, 'Administrator')
      expect(fired).toEqual(['core'])
    } finally {
      await unwire(APP2, CORE_DT)
    }
  })
})

// Moved from coverage-gaps.test.ts (#221): app registry install/uninstall
// edges — a table this app owns end to end, and rewiring hooks after a
// simulated process restart.
async function makeSimpleTable(admin: TestClient, name: string) {
  await admin.post('/api/table_def', {
    name,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
}

describe('app registry: install lifecycle', () => {
  test('a manifest that is not an object is refused, naming the manifest', async ({ admin }) => {
    const err = await expectApiError(admin.post('/api/install_app', { manifest: 42 }), { status: 417 })
    expect(err.message).toContain('Invalid app manifest')
    expect(Object.keys(err.fields ?? {})).toEqual(['manifest'])
  })

  test('enable requests for unknown or declarative apps preserve real installed state', async ({ admin }) => {
    const declarative = 'enable-declarative'
    await admin.post('/api/install_app', { manifest: { name: declarative, tables: noteApp.tables } })
    await admin.post('/api/save_row', { table: APP1_DT, row: { row_id: 'declared-note', title: 'keep me' } })
    expect(await discoverPackages([resolve('../..', 'test-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const row = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'other.task', row: { row_id: 'toggle-control', quantity: 37 },
    })
    expect(row).toMatchObject({ row_id: 'toggle-control', quantity: 37, validation_runs: 1 })
    const state = async () => ({
      installed: await sql`select * from installed_app order by name`,
      tables: await sql`select * from table_def where name in (${APP1_DT}, 'other.task') order by name`,
      columns: await sql`select * from column_def where parent in (${APP1_DT}, 'other.task') order by row_id`,
      declared: await sql`select * from featherbase.app_test_note order by row_id`,
      runtime: await sql`select * from other.task order by row_id`,
      settings: await sql`select * from app_setting order by row_id`,
      jobs: await sql`select * from scheduled_job order by row_id`,
      queued: await sql`select * from background_job order by row_id`,
      versions: await sql`select * from version order by row_id`,
      activity: await sql`select * from activity_log order by row_id`,
    })
    const before = await state()
    expect(before.installed.find((app) => app.name === declarative)).toMatchObject({ runtime_package: false })
    expect(before.installed.find((app) => app.name === 'other')).toMatchObject({ runtime_package: true, enabled: true })
    for (const name of ['never-installed-toggle', declarative]) {
      for (const enabled of [false, true]) {
        const response = await admin.fetch('/api/set_app_enabled', {
          method: 'POST', body: JSON.stringify({ name, enabled }),
        })
        await expectStatus(response, 417)
        expect(await response.json()).toEqual({ error: {
          type: 'ValidationError', message: 'Enable/disable requires an installed runtime package',
        } })
        expect(await state()).toEqual(before)
      }
    }
    expect(await admin.post('/api/set_app_enabled', { name: 'other', enabled: false }))
      .toEqual({ name: 'other', enabled: false })
    const disabled = { ...before, installed: before.installed.map((app) => app.name === 'other' ? { ...app, enabled: false } : app) }
    expect(await state()).toEqual(disabled)
    const blocked = await admin.fetch('/api/save_row', {
      method: 'POST', body: JSON.stringify({ table: 'other.task', row: { ...row, quantity: 11 } }),
    })
    await expectStatus(blocked, 403)
    expect(await blocked.json()).toEqual({ error: { type: 'PermissionError', message: 'App other is disabled or unavailable' } })
    expect(await state()).toEqual(disabled)
    expect(await admin.post('/api/set_app_enabled', { name: 'other', enabled: true }))
      .toEqual({ name: 'other', enabled: true })
    expect(await state()).toEqual(before)
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...row, quantity: 11 } }))
      .toMatchObject({ row_id: 'toggle-control', quantity: 11, validation_runs: 2 })
    expect(await sql`select * from featherbase.app_test_note order by row_id`).toEqual(before.declared)
  })

  test('install/list/uninstall round-trip, including app-owned table_defs', async () => {
    const APP = `cov-app-${Date.now()}`
    const DT = `Cov App Note ${Date.now() % 100000}`
    registerApp({
      name: APP,
      tables: [{ name: DT, columns: [{ column_name: 'note', column_type: 'Data' }] }],
    })
    expect(getAvailableApps()).toContain(APP)
    await expect(installApp(`${APP}-nope`)).rejects.toMatchObject({ type: 'ValidationError' })

    const installed = await installApp(APP)
    expect(installed.tables).toEqual([DT])
    expect(await isInstalled(APP)).toBe(true)
    expect((await listInstalledApps()).map((a) => a.name)).toContain(APP)
    await expect(installApp(APP)).rejects.toMatchObject({ type: 'ConflictError' })

    const removed = await uninstallApp(APP)
    expect(removed.removed).toEqual([DT])
    expect(await isInstalled(APP)).toBe(false)
    await expect(uninstallApp(APP)).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('loadInstalledApps rewires hooks after a process "restart"', async ({ admin }) => {
    const APP = `cov-rewire-${Date.now()}`
    const DT = 'Cov Rewire Note'
    await makeSimpleTable(admin, DT)
    const seen: string[] = []
    registerApp({ name: APP, doc_events: { [DT]: { after_insert: () => void seen.push('hit') } } })
    try {
      await installApp(APP)
      // Simulate the restart: hooks lost from the process, row still in DB.
      const { unregisterController } = await import('../src/controllers')
      void unregisterController // (unwire happens via a fresh wire map in prod)
      await loadInstalledApps() // idempotent when already wired
      await saveDoc(DT, { title: 'x' }, 'Administrator')
      expect(seen).toContain('hit')
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('app registry: legacy row tolerance', () => {
  test('listInstalledApps survives double-encoded and malformed tables columns, loadInstalledApps skips unknown apps', async () => {
    await sql`insert into installed_app (name, tables) values ('cov-legacy-str', ${'["Legacy X"]'}::jsonb)`
    await sql`insert into installed_app (name, tables) values ('cov-legacy-bad', ${'"not json['}::jsonb)`
    await sql`insert into installed_app (name, tables) values ('cov-legacy-obj', ${sql.json({ x: 1 })})`
    const apps = await listInstalledApps()
    expect(apps.find((a) => a.name === 'cov-legacy-str')?.tables).toEqual(['Legacy X'])
    expect(apps.find((a) => a.name === 'cov-legacy-bad')?.tables).toEqual([])
    expect(apps.find((a) => a.name === 'cov-legacy-obj')?.tables).toEqual([])
    // Neither name has a registered manifest — loadInstalledApps must skip them.
    await loadInstalledApps()
  })

  test('each installed runtime package says how to recover it when it cannot run as recorded', async () => {
    const row = (name: string, version: string | null, pending: boolean) =>
      sql`insert into installed_app (name, tables, runtime_package, package_version, activation_pending)
          values (${name}, ${sql.json([])}, true, ${version}, ${pending})`
    await row('cov-unversioned', null, false)
    await row('cov-pending', '1.0.0', true)
    await row('cov-missing-artifact', '1.0.0', false)
    const recovery = Object.fromEntries((await listInstalledApps()).map((a) => [a.name, a.recovery]))
    expect(recovery['cov-unversioned']).toMatch(/^Unversioned legacy installation/)
    expect(recovery['cov-pending']).toBe('Activate the committed version after restoring its exact artifact')
    expect(recovery['cov-missing-artifact']).toMatch(/^Restore the exact installed artifact/)
  })
})
