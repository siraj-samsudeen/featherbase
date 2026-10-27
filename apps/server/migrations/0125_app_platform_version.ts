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
//
// The inverse is exact and narrow. It runs over every file, because init.sh
// points FEATHERBASE_APP_PATHS at source directories, so src/ is fingerprinted
// too. It works on bytes, and undoes only the literal forms the rename
// produced. These are all the hunks of the diff under runtime-apps/ between
// d5b9fd5b (the last commit before the rename) and this change:
//   "platformVersion": "2026-10"                      manifests (JSON)
//   manifestVersion: 1, platformVersion: '2026-10',   scope-proof's build.mjs
//   export const platformVersion = '2026-10'          hand-written modules, src/server.ts
//   const platformVersion = "2026-10";                tasker-v1's server.mjs
//   var platformVersion = "2026-10";                  esbuild output
//   <newline>  platformVersion,<newline>              esbuild's export list
// Checked on 27-Oct-2026 against Tasker 2.3.0 and the 2.2 fixture, built from
// both sides by the Dockerfile's recipe and as init.sh lays them out. They
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

const RENAMED: [Buffer, Buffer][] = ([
  ['"platformVersion": "2026-10"', '"apiVersion": 1'],
  ["manifestVersion: 1, platformVersion: '2026-10',", 'manifestVersion: 1, apiVersion: 1,'],
  ["export const platformVersion = '2026-10'", 'export const apiVersion = 1'],
  ['const platformVersion = "2026-10";', 'const apiVersion = 1;'],
  ['var platformVersion = "2026-10";', 'var apiVersion = 1;'],
  ['\n  platformVersion,\n', '\n  apiVersion,\n'],
] as const).map(([renamed, before]) => [Buffer.from(renamed), Buffer.from(before)])

// Byte-level replace, so a binary file is never decoded and re-encoded.
function replaceAll(bytes: Buffer, from: Buffer, to: Buffer): Buffer {
  const parts: Buffer[] = []
  let start = 0
  for (let at = bytes.indexOf(from); at !== -1; at = bytes.indexOf(from, start)) {
    parts.push(bytes.subarray(start, at), to)
    start = at + from.length
  }
  return start === 0 ? bytes : Buffer.concat([...parts, bytes.subarray(start)])
}

function undoRename(_file: string, bytes: Buffer): Buffer {
  return RENAMED.reduce((text, [renamed, before]) => replaceAll(text, renamed, before), bytes)
}

/** The fingerprint these files had before the rename. */
export async function fingerprintBeforeRename(directory: string) {
  const app = await artifactIdentity(directory)
  return { ...app, digest: await artifactDigest(app.root, undoRename), renamedDigest: await artifactDigest(app.root) }
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
    throw new Error(`Migration 0125 cannot find the shipped files of ${stranded.join(', ')} with only apiVersion renamed to platformVersion. ` +
      'Set FEATHERBASE_APP_PATHS to include them, or restore those exact files, then migrate again. Nothing was changed.')
  for (const row of rows) {
    const { apiVersion: _retired, ...rest } = row.manifest as Record<string, unknown>
    await sql`update installed_app set manifest = ${sql.json({ ...rest, platformVersion: '2026-10' } as never)},
      artifact_digest = ${rebind.get(row.name as string) ?? row.artifact_digest} where name = ${row.name}`
  }
}
