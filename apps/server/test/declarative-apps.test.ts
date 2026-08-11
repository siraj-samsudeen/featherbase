import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { loadInstalledApps, uninstallApp, isInstalled } from '../src/apps'
import { sql } from '../src/db'

// PLAT-005 (#55): an app can be installed from a JSON manifest over the API —
// no code in this repo. The manifest persists in installed_app, uninstall
// tears everything down from stored data, and boot has nothing to wire.

const APP = 'test-declarative-app'
const DT = 'Decl Test Item'
const ROLE = 'Decl Test Role'

const MANIFEST = {
  name: APP,
  tables: [
    {
      name: DT,
      module: 'Test',
      id_pattern: 'hash',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    },
  ],
  roles: [ROLE],
  permissions: [{ table: DT, role: ROLE, can_read: true, can_write: true, can_create: true }],
}

async function unwire() {
  await uninstallApp(APP).catch(() => {})
}

describe('PLAT-005: declarative app install over the API', () => {
  test('install from { manifest } end-to-end: schema, access, uninstall — no code anywhere', async ({
    admin,
    createUser,
  }) => {
    try {
      const res = await admin.fetch('/api/install_app', {
        method: 'POST',
        body: JSON.stringify({ manifest: MANIFEST }),
      })
      expect(res.status).toBe(201)
      expect((await res.json()) as object).toMatchObject({ row_id: APP, tables: [DT], roles: [ROLE] })

      // The manifest is persisted — uninstall and boot work from stored data.
      const [row] = await sql`select manifest from installed_app where name = ${APP}`
      expect(row.manifest).toMatchObject({ row_id: APP })

      // The declared access model works for a scoped user.
      const user = await createUser({ roles: [ROLE] })
      const ins = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'declared' }),
      })
      expect(ins.status).toBe(201)
      expect((await user.fetch('/api/table/User')).status).toBe(403)

      // Uninstall over the API tears down Tables, roles and grants.
      const un = await admin.fetch('/api/uninstall_app', {
        method: 'POST',
        body: JSON.stringify({ row_id: APP }),
      })
      expect(un.status).toBe(200)
      expect((await sql`select 1 from table_def where name = ${DT}`).length).toBe(0)
      expect((await sql`select 1 from permission where role = ${ROLE}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })

  test.for(['doc_events', 'scheduler_events', 'override_whitelisted_methods'])(
    'a manifest declaring %s is rejected with a pointer at registerApp',
    async (key, { admin }) => {
      const res = await admin.fetch('/api/install_app', {
        method: 'POST',
        body: JSON.stringify({ manifest: { ...MANIFEST, [key]: {} } }),
      })
      expect(res.status).toBe(417)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toContain(key)
      expect(body.error.message).toContain('registerApp')
      // Nothing was installed.
      expect(await isInstalled(APP)).toBe(false)
    },
  )

  test('an invalid manifest (no name, unknown keys) is rejected', async ({ admin }) => {
    const res = await admin.fetch('/api/install_app', {
      method: 'POST',
      body: JSON.stringify({ manifest: { tables: [] } }),
    })
    expect(res.status).toBe(417)
  })

  test('a non-admin caller is refused — { manifest } is a define-schema surface', async ({
    createUser,
  }) => {
    const user = await createUser({ roles: [] })
    const res = await user.fetch('/api/install_app', {
      method: 'POST',
      body: JSON.stringify({ manifest: MANIFEST }),
    })
    expect(res.status).toBe(403)
    expect(await isInstalled(APP)).toBe(false)
  })

  test('restart-safety: boot after install has nothing to wire and loses nothing', async ({
    admin,
    createUser,
  }) => {
    try {
      await admin.fetch('/api/install_app', {
        method: 'POST',
        body: JSON.stringify({ manifest: MANIFEST }),
      })
      // Simulate a fresh process booting: no registered manifest exists for
      // the declarative app — loadInstalledApps must neither warn nor fail.
      await loadInstalledApps()
      expect(await isInstalled(APP)).toBe(true)
      const [dt] = await sql`select 1 from table_def where name = ${DT}`
      expect(dt).toBeTruthy()

      // And uninstall still works with no code present.
      const user = await createUser({ roles: [ROLE] })
      expect((await user.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(200)
      await uninstallApp(APP)
      expect(await isInstalled(APP)).toBe(false)
    } finally {
      await unwire()
    }
  })
})
