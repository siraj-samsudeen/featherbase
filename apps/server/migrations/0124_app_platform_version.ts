// #551 (ADR 0011, design E9): an app's manifest field `apiVersion: 1` became
// `platformVersion: "2026-10"`, outright. Each installed app records the
// manifest it was installed from and a fingerprint of its shipped files
// (installed_app.manifest, .artifact_digest), and boot selects an app only when
// the shipped files match that record. The rename changes the files of every
// shipped version, so without this an installed app (Tasker on the live trial)
// would stop loading and could never be upgraded.
//
// For each installed app still recording `apiVersion`, rewrite the recorded
// field, then re-record the fingerprint of the shipped files of the SAME
// version, found on FEATHERBASE_APP_PATHS, only when their declaration is
// exactly the recorded one after the rename. Anything else keeps its old
// fingerprint and stays unavailable until an operator restores the files.
import { sql } from '../src/db'
import { readVariable } from '../src/env'
import { artifactIdentity } from '../src/runtime-packages'
import { canonical } from '../src/runtime-migrations'

function configuredPaths(): string[] {
  return JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
}

export async function up(paths: string[] = configuredPaths()) {
  const rows = await sql`select name, package_version, manifest, artifact_digest from installed_app
    where runtime_package and manifest ? 'apiVersion'`
  if (!rows.length) return
  const shipped = []
  for (const directory of paths) {
    try { shipped.push(await artifactIdentity(directory)) } catch { /* not an app this release can read */ }
  }
  for (const row of rows) {
    const { apiVersion: _retired, ...rest } = row.manifest as Record<string, unknown>
    const manifest = { ...rest, platformVersion: '2026-10' }
    await sql`update installed_app set manifest = ${sql.json(manifest as never)} where name = ${row.name}`
    if (!row.artifact_digest) continue
    const files = shipped.find(a => a.name === row.name && a.version === row.package_version &&
      canonical(a.runtimeManifest) === canonical(manifest))
    if (files) await sql`update installed_app set artifact_digest = ${files.digest} where name = ${row.name}`
    else console.warn(`[0124] ${String(row.name)}@${String(row.package_version)}: no shipped files match its recorded manifest; restore them before enabling`)
  }
}
