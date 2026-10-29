// A disposable database of its own, for the migrator cases that need an
// empty one, an installed one, or one that is not empty but has no ledger.
// The migrator's
// connection is fixed when `src/db` is first loaded, so each scratch database
// loads a fresh copy of the module graph pointed at it; `dropScratchDatabases`
// drops them all afterwards.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { vi } from 'vitest'
import { config } from '../src/config'
import { processIO } from '../src/command-io'

const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const created: string[] = []

/** Drop every scratch database this file made, and the admin connection. */
export async function dropScratchDatabases(): Promise<void> {
  for (const name of created) await admin.unsafe(`drop database if exists "${name}" with (force)`)
  await admin.end()
}

/** A disposable database, a connection to it for the test's own checks, and
 *  the migrate and migrate-rehearse modules loaded against it. */
export async function scratchDatabase(setup = '') {
  const name = `featherbase_migrate_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  if (setup) await db.unsafe(setup)
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', url.toString())
  const migrate = await import('../src/migrate')
  const rehearsal = await import('../src/migrate-rehearse')
  const { sql: appSql } = await import('../src/db')
  vi.unstubAllEnvs()
  return {
    url: url.toString(),
    db,
    migrate,
    rehearsal,
    async close() {
      await appSql.end({ timeout: 5 })
      await db.end({ timeout: 5 })
    },
  }
}

/** A database installed fresh, with every migration applied. */
export async function scratchInstalled() {
  const scratch = await scratchDatabase()
  const log = console.log
  console.log = () => {}
  try {
    if ((await scratch.migrate.main([], processIO)) !== 0) throw new Error('the scratch install failed')
  } finally {
    console.log = log
  }
  return scratch
}
