import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, uninstallApp, isInstalled } from '../src/apps'
import { registerController, clearControllers } from '../src/controllers'
import { saveDoc } from '../src/document'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'
import type { AppManifest } from '../src/apps'

// PLAT-001: an app installs its DocTypes + doc_events and uninstall tears the
// DocTypes down. PLAT-002: an app's hook on a DocType it does NOT own fires
// alongside that DocType's core controller.

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
  // No DocTypes of its own — it only hooks a DocType owned by "core".
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
  test('installing an app creates its DocType and wires its doc_event', async () => {
    registerApps()
    try {
      const res = await installApp(APP1)
      expect(res.tables).toEqual([APP1_DT])
      expect(await isInstalled(APP1)).toBe(true)

      // The Table and its physical table exist.
      const [dt] = await sql`select 1 from table_def where name = ${APP1_DT}`
      expect(dt).toBeTruthy()
      const [tbl] = await sql`select 1 from information_schema.tables where table_name = 'app_test_note'`
      expect(tbl).toBeTruthy()

      // The app's before_save hook fires: the stamp is set on save.
      const doc = await saveDoc(APP1_DT, { name: 'note-1', title: 'hi' }, 'Administrator')
      expect(doc.stamp).toBe('wired-by-app')

      // Installed-state is recorded with the owned Table.
      const [rec] = await sql`select tables from installed_app where name = ${APP1}`
      expect(rec.tables).toEqual([APP1_DT])
    } finally {
      await unwire(APP1, APP1_DT)
    }
  })

  test('uninstalling removes the app’s DocTypes and its record', async () => {
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
      await expect(saveDoc(APP1_DT, { name: 'note-2' }, 'Administrator')).rejects.toBeTruthy()
    } finally {
      await unwire(APP1, APP1_DT)
    }
  })
})

describe('PLAT-002: app doc_events fire alongside the core controller', () => {
  test('an app hook on a foreign DocType runs with (not instead of) the core hook', async ({
    admin,
  }: {
    admin: TestClient
  }) => {
    registerApps()
    try {
      // A core controller owns CORE_DT and reacts to after_save.
      await admin.post('/api/doctype', {
        name: CORE_DT,
        id_pattern: 'prompt',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      })
      registerController({ table: CORE_DT, hooks: { after_save: () => { fired.push('core') } } })

      // The app hooks the same DocType without owning it.
      await installApp(APP2)

      fired.length = 0
      await saveDoc(CORE_DT, { name: 'task-1', title: 'a' }, 'Administrator')
      // BOTH fired, core before the later-registered app hook.
      expect(fired).toEqual(['core', 'app'])

      // After uninstall, only the core controller remains.
      await uninstallApp(APP2)
      fired.length = 0
      await saveDoc(CORE_DT, { name: 'task-2', title: 'b' }, 'Administrator')
      expect(fired).toEqual(['core'])
    } finally {
      await unwire(APP2, CORE_DT)
    }
  })
})
