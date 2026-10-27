// Run from apps/server inside a client image (.github/workflows/image-check.yml):
// runs the server's own boot-time discovery over FEATHERBASE_APP_PATHS and
// prints the apps it found. It exits non-zero unless every name passed in
// EXPECT_APPS (comma-separated) was found. A rejected app is logged by the
// server as "[runtime-packages] Artifact rejected" and is then missing here.
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL(`${process.cwd()}/src/runtime-packages.ts`).href)
await m.discoverPackages(JSON.parse(process.env.FEATHERBASE_APP_PATHS ?? '[]'))
const found: { name: string, version: string }[] = m.availableRuntimeVersions().map(({ name, version }: { name: string, version: string }) => ({ name, version }))
console.log('discovered:', JSON.stringify(found))
const missing = (process.env.EXPECT_APPS ?? '').split(',').filter(Boolean).filter((name) => !found.some((app) => app.name === name))
if (missing.length) console.error('missing:', missing.join(', '))
process.exit(missing.length ? 1 : 0)
