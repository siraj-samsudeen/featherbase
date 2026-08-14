import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import type { AppManifest } from '../src/apps'

// PLAT-004 (#54): an app manifest declares its own roles and DocPerm grants.
// Install materializes them (roles before perms), adoption never redefines a
// pre-existing role/grant, and uninstall removes exactly what the install
// created — a shared role survives while anything still references it.

const APP = 'test-grants-app'
const DT = 'Grant Test Entry'
const ROLE = 'Grant Test Role'

function manifest(extra: Partial<AppManifest> = {}): AppManifest {
  return {
    name: APP,
    tables: [
      {
        name: DT,
        module: 'Test',
        id_pattern: 'hash',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      },
    ],
    roles: [ROLE],
    permissions: [
      { table: DT, role: ROLE, can_read: true, can_write: true, can_create: true },
    ],
    ...extra,
  }
}

async function unwire() {
  await uninstallApp(APP).catch(() => {})
}

describe('PLAT-004: manifest-declared roles and permissions', () => {
  test('install creates the role and grant; a scoped user works inside them and nowhere else', async ({
    admin,
    createUser,
  }) => {
    registerApp(manifest())
    try {
      const res = await installApp(APP)
      expect(res.roles).toEqual([ROLE])
      expect(res.perms).toHaveLength(1)

      const [role] = await sql`select 1 from role where row_id = ${ROLE}`
      expect(role).toBeTruthy()
      const [perm] = await sql`
        select can_read, can_write, can_create, can_delete from permission
        where ref_table = ${DT} and role = ${ROLE} and tier = 'basic'`
      expect(perm).toMatchObject({ can_read: true, can_write: true, can_create: true, can_delete: false })

      // A user holding only the app's role can insert and read its DocType…
      const user = await createUser({ roles: [ROLE] })
      const ins = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'from scoped user' }),
      })
      expect(ins.status).toBe(201)
      const created = (await ins.json()) as { row_id: string; title: string }
      expect(created.title).toBe('from scoped user')
      expect((await user.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(200)

      // …but is refused elsewhere: no delete grant, no User read.
      expect(
        (await user.fetch(`/api/table/${encodeURIComponent(DT)}/${created.row_id}`, { method: 'DELETE' }))
          .status,
      ).toBe(403)
      expect((await user.fetch('/api/table/User')).status).toBe(403)
    } finally {
      await unwire()
    }
  })

  test('a grant may target a DocType the app does not own', async ({ createUser }) => {
    registerApp(
      manifest({
        permissions: [
          { table: DT, role: ROLE, can_read: true, can_write: true, can_create: true },
          { table: 'ToDo', role: ROLE, can_read: true },
        ],
      }),
    )
    try {
      await installApp(APP)
      const user = await createUser({ roles: [ROLE] })
      expect((await user.fetch('/api/table/ToDo')).status).toBe(200)
    } finally {
      await unwire()
    }
  })

  test('a pre-existing role and grant are adopted, not redefined — and survive uninstall', async ({
    admin,
  }) => {
    // The role and a grant with the same identity exist BEFORE the install,
    // with flags the manifest disagrees with.
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: ROLE } })
    const pre = await admin.post<{ row_id: string }>('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: 'ToDo', role: ROLE, can_read: true },
    })
    registerApp(
      manifest({
        permissions: [
          // Same identity (ToDo, ROLE, basic) but broader flags — must NOT overwrite.
          { table: 'ToDo', role: ROLE, can_read: true, can_write: true, can_delete: true },
        ],
      }),
    )
    try {
      const res = await installApp(APP)
      // Neither the role nor the grant was created by this install.
      expect(res.roles).toEqual([])
      expect(res.perms).toEqual([])
      const [perm] = await sql`select can_write, can_delete from permission where row_id = ${pre.row_id}`
      expect(perm).toMatchObject({ can_write: false, can_delete: false })

      await uninstallApp(APP)
      // The adopted role and grant predate the app and must survive it.
      expect((await sql`select 1 from role where row_id = ${ROLE}`).length).toBe(1)
      expect((await sql`select 1 from permission where row_id = ${pre.row_id}`).length).toBe(1)
    } finally {
      await unwire()
    }
  })

  test('uninstall removes exactly what install created', async () => {
    registerApp(
      manifest({
        permissions: [
          { table: DT, role: ROLE, can_read: true, can_write: true, can_create: true },
          { table: 'ToDo', role: ROLE, can_read: true },
        ],
      }),
    )
    try {
      await installApp(APP)
      await uninstallApp(APP)
      expect((await sql`select 1 from permission where role = ${ROLE}`).length).toBe(0)
      // Nothing references the role any more, so it is dropped too.
      expect((await sql`select 1 from role where row_id = ${ROLE}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })

  test('a shared role survives uninstall while a user still holds it', async ({ createUser }) => {
    registerApp(manifest())
    try {
      await installApp(APP)
      await createUser({ roles: [ROLE] })
      await uninstallApp(APP)
      // The app's own grant is gone, but the role is still held via
      // has_role — dropping it would strand the user.
      expect((await sql`select 1 from permission where role = ${ROLE}`).length).toBe(0)
      expect((await sql`select 1 from role where row_id = ${ROLE}`).length).toBe(1)
    } finally {
      await unwire()
    }
  })

  test('a permission naming an undeclared, unknown role is rejected', async () => {
    registerApp(
      manifest({
        roles: [],
        permissions: [{ table: 'ToDo', role: 'No Such Role', can_read: true }],
      }),
    )
    try {
      await expect(installApp(APP)).rejects.toMatchObject({ type: 'ValidationError' })
    } finally {
      await unwire()
    }
  })

  test('can_create without can_write warns, and inserts really do strip every field (#45 trap)', async ({
    createUser,
  }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerApp(
      manifest({
        permissions: [{ table: DT, role: ROLE, can_read: true, can_create: true }],
      }),
    )
    try {
      await installApp(APP)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('can_create without can_write'))

      // The documented behaviour: the insert succeeds but every field is
      // stripped to the role's WRITE tiers — the document arrives empty.
      const user = await createUser({ roles: [ROLE] })
      const ins = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'will be stripped' }),
      })
      expect(ins.status).toBe(201)
      const created = (await ins.json()) as { title: string | null }
      expect(created.title ?? null).toBeNull()
    } finally {
      warn.mockRestore()
      await unwire()
    }
  })
})
