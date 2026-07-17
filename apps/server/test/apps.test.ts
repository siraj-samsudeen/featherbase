import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'
import { registerApp, installApp, uninstallApp, isInstalled } from '../src/apps'
import { registerController, clearControllers } from '../src/controllers'
import { saveDoc } from '../src/document'
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
  doctypes: [
    {
      name: APP1_DT,
      module: 'Test',
      autoname: 'prompt',
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'stamp', fieldtype: 'Data' },
      ],
    },
  ],
  doc_events: {
    [APP1_DT]: { before_save: ({ doc }) => { doc.stamp = 'wired-by-app' } },
  },
}

const hookApp: AppManifest = {
  name: APP2,
  // No DocTypes of its own — it only hooks a DocType owned by "core".
  doc_events: {
    [CORE_DT]: { after_save: () => { fired.push('app') } },
  },
}

async function cleanup() {
  await uninstallApp(APP1).catch(() => {})
  await uninstallApp(APP2).catch(() => {})
  await sql`delete from tab_installed_app where name in (${APP1}, ${APP2})`
  clearControllers(CORE_DT)
  for (const dt of [APP1_DT, CORE_DT]) {
    await sql`delete from tab_docfield where parent = ${dt}`
    await sql`delete from tab_doctype where name = ${dt}`
  }
  await sql.unsafe('drop table if exists tab_app_test_note cascade')
  await sql.unsafe('drop table if exists tab_plat_core_task cascade')
}

beforeAll(async () => {
  await cleanup()
  registerApp(noteApp)
  registerApp(hookApp)
})

afterAll(cleanup)

describe('PLAT-001: app install/uninstall', () => {
  it('installing an app creates its DocType and wires its doc_event', async () => {
    const res = await installApp(APP1)
    expect(res.doctypes).toEqual([APP1_DT])
    expect(await isInstalled(APP1)).toBe(true)

    // The DocType and its table exist.
    const [dt] = await sql`select 1 from tab_doctype where name = ${APP1_DT}`
    expect(dt).toBeTruthy()
    const [tbl] = await sql`select 1 from information_schema.tables where table_name = 'tab_app_test_note'`
    expect(tbl).toBeTruthy()

    // The app's before_save hook fires: the stamp is set on save.
    const doc = await saveDoc(APP1_DT, { name: 'note-1', title: 'hi' }, 'Administrator')
    expect(doc.stamp).toBe('wired-by-app')

    // Installed-state is recorded with the owned DocType.
    const [rec] = await sql`select doctypes from tab_installed_app where name = ${APP1}`
    expect(rec.doctypes).toEqual([APP1_DT])
  })

  it('uninstalling removes the app’s DocTypes and its record', async () => {
    await uninstallApp(APP1)
    expect(await isInstalled(APP1)).toBe(false)
    const [dt] = await sql`select 1 from tab_doctype where name = ${APP1_DT}`
    expect(dt).toBeUndefined()
    const [tbl] = await sql`select 1 from information_schema.tables where table_name = 'tab_app_test_note'`
    expect(tbl).toBeUndefined()

    // The DocType is really gone — saving one now fails.
    await expect(saveDoc(APP1_DT, { name: 'note-2' }, 'Administrator')).rejects.toBeTruthy()
  })
})

describe('PLAT-002: app doc_events fire alongside the core controller', () => {
  it('an app hook on a foreign DocType runs with (not instead of) the core hook', async () => {
    // A core controller owns CORE_DT and reacts to after_save.
    await areq('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: CORE_DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
    })
    registerController({ doctype: CORE_DT, hooks: { after_save: () => { fired.push('core') } } })

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
  })
})
