// #551 (ADR 0011, design E9): an app's manifest field `apiVersion: 1` became
// `platformVersion: "2026-10"`, outright. Each installed app records the
// manifest it was installed from and a fingerprint of its shipped files
// (installed_app.manifest, .artifact_digest), and boot selects an app only when
// the shipped files match that fingerprint. The rename changes the files of
// every shipped version, so without this an installed app (Tasker on the live
// trial) would stop loading and could never be upgraded.
//
// For each installed app still recording `apiVersion`, this renames the field
// and, when the row has a fingerprint, rebinds it to the renamed files of the
// SAME version on FEATHERBASE_APP_PATHS. The rebinding is safe because the new
// files are trusted only if undoing the rename in memory reproduces the
// recorded fingerprint byte for byte: the rename must be the ONLY difference.
// The inverse is exact and narrow. It touches only the manifest file and the
// server module, and only the literal forms the rename produced: in
// featherbase.json `"platformVersion": "2026-10"`; in a server module the
// hand-written `export const platformVersion = '2026-10'` /
// `const platformVersion = "2026-10";`, and esbuild's `var platformVersion =
// "2026-10";` plus its export-list line `  platformVersion,`. Checked on
// 27-Oct-2026 by building Tasker 2.3.0 and the 2.2 fixture with the
// Dockerfile's recipe from origin/main and from this change: the shipped trees
// differ in exactly these lines, and vite's client output is identical. Any
// other difference leaves the fingerprints unequal, so the app is refused.
//
// Every fingerprinted row is resolved before any row is written. If one cannot
// be rebound, the migration throws: the migrator's per-file transaction rolls
// back the rows and the ledger entry, and the release can retry once the files
// are on FEATHERBASE_APP_PATHS. A row with no fingerprint (a legacy install,
// matched on its manifest) gets just the rename.
import { sql } from '../src/db'
import { readVariable } from '../src/env'
import { artifactDigest, artifactIdentity } from '../src/runtime-packages'

const MANIFEST_RENAME: [string, string][] = [['"platformVersion": "2026-10"', '"apiVersion": 1']]
const SERVER_RENAME: [string, string][] = [
  ["export const platformVersion = '2026-10'", 'export const apiVersion = 1'],
  ['const platformVersion = "2026-10";', 'const apiVersion = 1;'],
  ['var platformVersion = "2026-10";', 'var apiVersion = 1;'],
  ['\n  platformVersion,\n', '\n  apiVersion,\n'],
]

function undo(bytes: Buffer, pairs: [string, string][]): Buffer {
  let text = bytes.toString('utf8')
  for (const [renamed, before] of pairs) text = text.replaceAll(renamed, before)
  return Buffer.from(text, 'utf8')
}

/** The fingerprint these files had before the rename. */
export async function fingerprintBeforeRename(directory: string) {
  const app = await artifactIdentity(directory)
  const digest = await artifactDigest(app.root, (file, bytes) =>
    file === app.manifestFile ? undo(bytes, MANIFEST_RENAME) : file === app.serverFile ? undo(bytes, SERVER_RENAME) : bytes)
  return { ...app, digest, renamedDigest: await artifactDigest(app.root) }
}

function configuredPaths(): string[] {
  return JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
}

export async function up(paths: string[] = configuredPaths()) {
  const rows = await sql`select name, package_version, manifest, artifact_digest from installed_app
    where runtime_package and manifest ? 'apiVersion'`
  if (!rows.length) return
  const shipped = []
  for (const directory of paths) {
    try { shipped.push(await fingerprintBeforeRename(directory)) } catch { /* not an app this release can read */ }
  }
  const rebind = new Map<string, string>()
  const stranded: string[] = []
  for (const row of rows) {
    if (!row.artifact_digest) continue
    const files = shipped.find(a => a.name === row.name && a.version === row.package_version && a.digest === row.artifact_digest)
    if (files) rebind.set(row.name as string, files.renamedDigest)
    else stranded.push(`${String(row.name)}@${String(row.package_version)}`)
  }
  if (stranded.length)
    throw new Error(`Migration 0124 cannot find the shipped files of ${stranded.join(', ')} with only apiVersion renamed to platformVersion. ` +
      'Set FEATHERBASE_APP_PATHS to include them, or restore those exact files, then migrate again. Nothing was changed.')
  for (const row of rows) {
    const { apiVersion: _retired, ...rest } = row.manifest as Record<string, unknown>
    await sql`update installed_app set manifest = ${sql.json({ ...rest, platformVersion: '2026-10' } as never)},
      artifact_digest = ${rebind.get(row.name as string) ?? row.artifact_digest} where name = ${row.name}`
  }
}
