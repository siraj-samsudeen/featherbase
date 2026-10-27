import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { loadInstalledApps, uninstallApp, isInstalled, registerApp } from '../src/apps'
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
      expect((await res.json()) as object).toMatchObject({ name: APP, tables: [DT], roles: [ROLE] })

      // The manifest is persisted — uninstall and boot work from stored data.
      const [row] = await sql`select manifest from installed_app where name = ${APP}`
      expect(row.manifest).toMatchObject({ name: APP })

      // The declared access model works for a scoped user.
      const user = await createUser({ roles: [ROLE] })
      const ins = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'declared' }),
      })
      expect(ins.status).toBe(201)
      expect((await user.fetch('/api/table/Person')).status).toBe(403)

      // Uninstall over the API tears down Tables, roles and grants.
      const un = await admin.fetch('/api/uninstall_app', {
        method: 'POST',
        body: JSON.stringify({ name: APP }),
      })
      expect(un.status).toBe(200)
      expect((await sql`select 1 from table_def where name = ${DT}`).length).toBe(0)
      expect((await sql`select 1 from permission where role = ${ROLE}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })

  test.for(['doc_events', 'scheduler_events'])(
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

  test('an app\'s tables may link to each other whatever order they are declared in (#511)', async ({ admin }) => {
    const LINKED = 'test-declarative-linked'
    try {
      const res = await admin.fetch('/api/install_app', {
        method: 'POST',
        body: JSON.stringify({ manifest: { name: LINKED, tables: [
          { name: 'Decl Linked Order', columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Decl Linked Customer' }] },
          { name: 'Decl Linked Customer', columns: [{ column_name: 'last_order', column_type: 'Reference', reference_table: 'Decl Linked Order' }] },
        ] } }),
      })
      expect(res.status).toBe(201)
    } finally {
      await uninstallApp(LINKED).catch(() => {})
    }
  })

  test('a later table\'s missing link target leaves none of the app\'s earlier tables behind (#511)', async ({ admin }) => {
    const PARTIAL = 'test-declarative-partial'
    const first = { name: 'Decl Partial First', columns: [{ column_name: 'second', column_type: 'Reference', reference_table: 'Decl Partial Second' }] }
    const second = (target: string) => ({ name: 'Decl Partial Second', columns: [{ column_name: 'other', column_type: 'Reference', reference_table: target }] })
    const install = (tables: object[]) =>
      admin.fetch('/api/install_app', { method: 'POST', body: JSON.stringify({ manifest: { name: PARTIAL, tables } }) })
    try {
      const refused = await install([first, second('Decl No Such Table')])
      expect(refused.status).toBe(417)
      expect((await refused.json()).error.fields.other).toContain('Decl No Such Table')
      expect(await sql`select name from table_def where name = ${first.name}`).toEqual([])
      expect(await sql`select column_name from column_def where parent = ${first.name}`).toEqual([])
      expect((await sql`select to_regclass('featherbase.decl_partial_first')::text as r`)[0].r).toBeNull()
      // No cached definition outlives the rollback.
      expect((await admin.fetch(`/api/table/${encodeURIComponent(first.name)}:meta`)).status).toBe(404)
    } finally {
      await uninstallApp(PARTIAL).catch(() => {})
    }
  })

  test('a manifest corrected after a refused install installs cleanly (#511)', async ({ admin }) => {
    const PARTIAL = 'test-declarative-retry'
    const first = { name: 'Decl Retry First', columns: [{ column_name: 'second', column_type: 'Reference', reference_table: 'Decl Retry Second' }] }
    const second = (target: string) => ({ name: 'Decl Retry Second', columns: [{ column_name: 'other', column_type: 'Reference', reference_table: target }] })
    const install = (tables: object[]) =>
      admin.fetch('/api/install_app', { method: 'POST', body: JSON.stringify({ manifest: { name: PARTIAL, tables } }) })
    try {
      expect((await install([first, second('Decl No Such Table')])).status).toBe(417)
      expect((await install([first, second('Decl Retry First')])).status).toBe(201)
    } finally {
      await uninstallApp(PARTIAL).catch(() => {})
    }
  })

  test('an invalid manifest (no name, unknown keys) is rejected', async ({ admin }) => {
    const res = await admin.fetch('/api/install_app', {
      method: 'POST',
      body: JSON.stringify({ manifest: { tables: [] } }),
    })
    expect(res.status).toBe(417)
  })

  test('a manifest named like an app registered in code is refused, so it can never shadow that app', async ({ admin }) => {
    registerApp({ name: 'decl-shadowed-code-app', tables: [] })
    const res = await admin.fetch('/api/install_app', {
      method: 'POST',
      body: JSON.stringify({ manifest: { ...MANIFEST, name: 'decl-shadowed-code-app' } }),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { type: 'ConflictError', message: 'App decl-shadowed-code-app is registered in code — install it with { name } instead' },
    })
    expect(await isInstalled('decl-shadowed-code-app')).toBe(false)
    expect(await sql`select 1 from table_def where name = ${DT}`).toHaveLength(0)
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
      expect(dt).toEqual({ '?column?': 1 })

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
