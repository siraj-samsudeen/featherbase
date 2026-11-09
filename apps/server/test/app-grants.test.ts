import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { registerApp, installApp, uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
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
      { table: DT, role: ROLE, operations: { read: '*', update: '*', create: '*' } },
    ],
    ...extra,
  }
}

async function unwire() {
  await uninstallApp(APP).catch(() => {})
}

describe('PLAT-004: manifest-declared roles and permissions', () => {
  test('an app child Column selection stays attached to its named grid', async ({ createUser }) => {
    registerApp(manifest({
      tables: [
        { name: 'Grant Note', kind: 'sub_table', columns: [
          { column_name: 'text', column_type: 'Data' },
          { column_name: 'private_text', column_type: 'Data' },
        ] },
        { name: DT, id_pattern: 'prompt', columns: [
          { column_name: 'public_notes', column_type: 'Sub-table', row_table: 'Grant Note' },
          { column_name: 'private_notes', column_type: 'Sub-table', row_table: 'Grant Note' },
        ] },
      ],
      permissions: [{ table: DT, role: ROLE, operations: { read: ['public_notes.text', 'private_notes.private_text'] } }],
      fixtures: [{ table: DT, rows: [{ row_id: 'two-grids',
        public_notes: [{ text: 'public', private_text: 'not granted in public grid' }],
        private_notes: [{ text: 'not granted in private grid', private_text: 'private' }],
      }] }],
    }))
    try {
      await installApp(APP)
      const reader = await createUser({ roles: [ROLE] })
      const row = await reader.get<{ public_notes: Record<string, unknown>[]; private_notes: Record<string, unknown>[] }>(`/api/table/${encodeURIComponent(DT)}/two-grids`)
      expect(row.public_notes[0]).toMatchObject({ text: 'public' })
      expect(row.public_notes[0]).not.toHaveProperty('private_text')
      expect(row.private_notes[0]).toMatchObject({ private_text: 'private' })
      expect(row.private_notes[0]).not.toHaveProperty('text')
    } finally { await unwire() }
  })

  test('install creates the role and grant; a scoped user works inside them and nowhere else', async ({
    admin,
    createUser,
  }) => {
    registerApp(manifest())
    try {
      const res = await installApp(APP)
      expect(res.roles).toEqual([ROLE])
      expect(res.perms).toHaveLength(3)

      const [role] = await sql`select 1 from role where row_id = ${ROLE}`
      expect(role).toEqual({ '?column?': 1 })
      const permissions = await sql`
        select operation from permission where ref_table = ${DT} and role = ${ROLE} order by operation`
      expect(permissions.map((permission) => permission.operation)).toEqual(['create', 'read', 'update'])

      // A user holding only the app's role can insert and read its Table…
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
      expect((await user.fetch('/api/table/Person')).status).toBe(403)
    } finally {
      await unwire()
    }
  })

  test('a grant may target a Table the app does not own', async ({ createUser }) => {
    registerApp(
      manifest({
        permissions: [
          { table: DT, role: ROLE, operations: { read: '*', update: '*', create: '*' } },
          { table: 'ToDo', role: ROLE, operations: { read: '*' } },
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
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    const pre = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'ToDo', role: ROLE, operation: 'read', scope_mode: 'all' },
    })
    registerApp(
      manifest({
        permissions: [
          // Existing manual configuration must not acquire the app's broader powers.
          { table: 'ToDo', role: ROLE, operations: { read: '*', update: '*', delete: true } },
        ],
      }),
    )
    try {
      const res = await installApp(APP)
      // Neither the role nor the grant was created by this install.
      expect(res.roles).toEqual([])
      expect(res.perms).toEqual([])
      const permissions = await sql`select operation from permission where ref_table = 'ToDo' and role = ${ROLE}`
      expect(permissions.map((permission) => permission.operation)).toEqual(['read'])

      await uninstallApp(APP)
      // The adopted role and grant predate the app and must survive it.
      expect((await sql`select 1 from role where row_id = ${ROLE}`).length).toBe(1)
      expect((await sql`select 1 from permission where row_id = ${pre.row_id}`).length).toBe(1)
    } finally {
      await unwire()
    }
  })

  test('a creator-only manual grant is adopted, so installing adds no all-rows grant', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'ToDo', role: ROLE, operation: 'read', scope_mode: 'creator' },
    })
    registerApp(manifest({ permissions: [{ table: 'ToDo', role: ROLE, operations: { read: '*', update: '*' } }] }))
    try {
      expect((await installApp(APP)).perms).toEqual([])
      expect(await sql`select operation, scope_mode from permission where ref_table = 'ToDo' and role = ${ROLE}`)
        .toEqual([{ operation: 'read', scope_mode: 'creator' }])
    } finally {
      await unwire()
    }
  })

  test('separate declarations for one Table and role can give each operation its own rows', async () => {
    registerApp(manifest({ permissions: [
      { table: DT, role: ROLE, operations: { read: '*' } },
      { table: DT, role: ROLE, scope_mode: 'creator', operations: { create: '*' } },
    ] }))
    try {
      await installApp(APP)
      expect(await sql`select operation, scope_mode from permission where ref_table = ${DT} and role = ${ROLE} order by operation`)
        .toEqual([{ operation: 'create', scope_mode: 'creator' }, { operation: 'read', scope_mode: 'all' }])
    } finally {
      await unwire()
    }
  })

  test('two declarations of one operation with different rows are both provisioned', async () => {
    registerApp(manifest({ permissions: [
      { table: DT, role: ROLE, operations: { read: '@basic' } },
      { table: DT, role: ROLE, scope_mode: 'creator', operations: { read: '*' } },
    ] }))
    try {
      await installApp(APP)
      expect(await sql`select scope_mode, column_rule from permission where ref_table = ${DT} and role = ${ROLE} and operation = 'read' order by scope_mode`)
        .toEqual([{ scope_mode: 'all', column_rule: 'basic' }, { scope_mode: 'creator', column_rule: 'every' }])
    } finally {
      await unwire()
    }
  })

  test('uninstall removes exactly what install created', async () => {
    registerApp(
      manifest({
        permissions: [
          { table: DT, role: ROLE, operations: { read: '*', update: '*', create: '*' } },
          { table: 'ToDo', role: ROLE, operations: { read: '*' } },
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

  test('a shared role survives uninstall while a grant the app did not make still names it', async () => {
    registerApp(manifest())
    try {
      await installApp(APP)
      await saveDoc('Permission', { ref_table: 'ToDo', role: ROLE, operation: 'read', scope_mode: 'all', column_rule: 'every' })
      await uninstallApp(APP)
      expect((await sql`select ref_table from permission where role = ${ROLE}`)).toEqual([{ ref_table: 'ToDo' }])
      expect((await sql`select 1 from role where row_id = ${ROLE}`).length).toBe(1)
    } finally {
      await unwire()
    }
  })

  test('a permission naming an undeclared, unknown role is rejected', async () => {
    registerApp(
      manifest({
        roles: [],
        permissions: [{ table: 'ToDo', role: 'No Such Role', operations: { read: '*' } }],
      }),
    )
    try {
      await expect(installApp(APP)).rejects.toMatchObject({ type: 'ValidationError' })
    } finally {
      await unwire()
    }
  })

  test('a can_create grant without can_write keeps what a new row was given (#608)', async ({ createUser }) => {
    registerApp(
      manifest({
        permissions: [{ table: DT, role: ROLE, operations: { read: '*', create: '*' } }],
      }),
    )
    try {
      await installApp(APP)
      // #608 retired the #45 trap: an insert is judged by the create grant,
      // so the row keeps its columns and nothing needs warning about.
      const user = await createUser({ roles: [ROLE] })
      const ins = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'kept' }),
      })
      expect(ins.status).toBe(201)
      const created = (await ins.json()) as { title: string | null }
      expect(created.title).toBe('kept')
    } finally {
      await unwire()
    }
  })
})
