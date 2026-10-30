// Run with a featherbase checkout's own tsx, from its apps/server folder:
//   <checkout>/apps/server/node_modules/.bin/tsx scripts/platform-loads-app.mts <checkout> <app dir>
// Loads the app folder exactly as the platform's boot discovery and release
// guard do (unshippedApps), and prints the outcome and the folder's
// fingerprint (the platform's artifactDigest) as one line of JSON.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [checkout, appDir] = process.argv.slice(2)
const loader = await import(pathToFileURL(resolve(checkout, 'apps/server/src/runtime-packages.ts')).href)
const { version } = JSON.parse(await readFile(resolve(appDir, 'package.json'), 'utf8'))
const { name } = JSON.parse(await readFile(resolve(appDir, 'featherbase.json'), 'utf8'))
const installed = { name, package_version: version, artifact_digest: await loader.artifactDigest(appDir) }
const unshipped = await loader.unshippedApps([installed], [appDir])
console.log(JSON.stringify({ name, version, accepted: unshipped.length === 0, digest: installed.artifact_digest }))
process.exit(0)
