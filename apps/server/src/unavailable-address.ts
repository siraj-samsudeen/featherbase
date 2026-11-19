import { Hono } from 'hono'
import { askedAddress } from 'shared'
import { sql } from './db'
import { OPEN_ROLES, PLATFORM_ROLES, directRoles, getRoles, isPrivileged } from './permissions'
import { listInstalledApps } from './apps'
import { who, type Env } from './route-context'

// #1328 (audit F09): what the unavailable page may tell a signed-in viewer about
// an address. That an app is turned off is said only to someone who could use
// it (a System Manager, or a person who may read its records); to anyone else,
// as to someone signed out, nothing is available there. The answer is worked out
// here from the installation, never from anything the address claims.

/** The app an address names (its first part), when it is installed and turned off and `viewer` could use it. */
export async function turnedOffFor(address: string, viewer: string): Promise<{ title: string } | null> {
  const name = address.split('/')[1]
  if (!name) return null
  const [row] = await sql`select name, enabled, manifest from installed_app where name = ${name}`
  if (!row || row.enabled !== false) return null
  const manifest = (row.manifest ?? {}) as { title?: unknown; entryTable?: unknown; permissions?: unknown }
  // A turned-off app's grants are suspended, so whether the viewer could use it is read from what the app
  // declares: a permission that lets one of their roles read its entry Table.
  // With the app's own App Role Bindings, which getRoles leaves out while the app is off (Codex standard
  // round 1): one level, as normal resolution, so only a role the viewer holds itself carries one of the
  // app's roles, and never an open or platform role (Codex adversarial round 2).
  const roles = new Set(await getRoles(viewer))
  const direct = new Set(await directRoles(viewer))
  for (const b of await sql`select app_role, bound_role from app_role_binding where app = ${name}`)
    if (direct.has(String(b.bound_role)) && !OPEN_ROLES.includes(String(b.bound_role)) && !PLATFORM_ROLES.includes(String(b.app_role)))
      roles.add(String(b.app_role))
  // A grant reads either way an app declares it: `can_read`, or a read in its `operations`.
  const declared = Array.isArray(manifest.permissions) ? manifest.permissions as { table?: unknown; role?: unknown; can_read?: unknown; operations?: { read?: unknown } }[] : []
  const reads = (p: (typeof declared)[number]) => p.can_read === true || Boolean(p.operations?.read)
  const may = (await isPrivileged(viewer)) ||
    declared.some((p) => p.table === manifest.entryTable && reads(p) && typeof p.role === 'string' && roles.has(p.role))
  return may ? { title: typeof manifest.title === 'string' && manifest.title.trim() ? manifest.title.trim() : name } : null
}

/** Whether an app is served at its own root now: installed, switched on, active, with pages of its own. */
export async function servesAppRoot(name: string): Promise<boolean> {
  const item = (await listInstalledApps()).find((a) => a.name === name)
  return Boolean(item?.active && item.ownPages)
}

export const addressRoutes = new Hono<Env>()

/** GET /api/address_status?address=/equipment/: what the unavailable page may say about that address. */
addressRoutes.get('/api/address_status', async (c) => {
  const address = askedAddress(c.req.query('address'))
  return c.json({ turned_off: address ? await turnedOffFor(address, who(c)) : null })
})
