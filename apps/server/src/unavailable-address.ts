import { Hono } from 'hono'
import { askedAddress } from 'shared'
import { sql } from './db'
import { hasPermission, isPrivileged } from './permissions'
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
  const manifest = (row.manifest ?? {}) as { title?: unknown; entryTable?: unknown }
  const entry = typeof manifest.entryTable === 'string' ? manifest.entryTable : null
  const may = (await isPrivileged(viewer)) || (entry !== null && (await hasPermission(viewer, entry, 'read').catch(() => false)))
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
