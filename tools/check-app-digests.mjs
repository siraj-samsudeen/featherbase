#!/usr/bin/env node
// Production never re-pins: an installed app's built files must stay exactly as
// they were until its version changes, or the deploy stops (docs/DEPLOY.md).
// A change to a shared package can move those files with no change under the
// app's folder. So this builds each of an instance's apps at the release and at
// head, and names every app whose files moved under an unchanged version.
//
//   node tools/check-app-digests.mjs [--instance jeyarama/dash] [--release <ref>] [--head HEAD]
//
// The release branch moves when it is merged into, even if that deploy then
// fails, so after a failed deploy name the last commit that deployed: --release <sha>.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildUnpacked } from './build-instance-apps.mjs'
import { resolveInstance } from './dev.mjs'

/** The same fingerprint as `artifactDigest` in apps/server/src/runtime-packages.ts; a server test holds them together. */
export async function artifactDigest(root) {
  const hash = createHash('sha256')
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      const file = join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else hash.update(JSON.stringify([relative(root, file), readFileSync(file).toString('base64')]))
    }
  }
  walk(root)
  return hash.digest('hex')
}

/** What would stop a deploy from `released` to `head`. */
export function digestProblems({ released, head }) {
  const problems = []
  for (const app of head) {
    const was = released.find((r) => r.path === app.path)
    if (was?.version === app.version && was.digest !== app.digest)
      problems.push(`${app.path} ${app.version}: its built files differ from the release's under the same version. Bump the version, with a migration from ${app.version}.`)
  }
  return problems
}

/** Each app the instance holds at `commit`, built from a clean copy of that commit. */
async function builtAt(commit, instanceName, cwd) {
  const source = realpathSync(mkdtempSync(join(tmpdir(), 'app-digests-')))
  const output = join(source, '.shipped')
  try {
    mkdirSync(output)
    const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd, maxBuffer: 2 ** 31 })
    const unpacked = spawnSync('tar', ['-xf', '-', '-C', source], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] })
    if (unpacked.status !== 0) throw new Error(`Could not unpack ${commit}`)
    const apps = []
    for (const app of resolveInstance(instanceName, source).apps) {
      const { name, version, target } = buildUnpacked(app.root, source, output, process.env)
      apps.push({ path: relative(source, app.root), name, version, digest: await artifactDigest(target) })
    }
    return { apps }
  } finally {
    rmSync(source, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = (name, fallback) => {
    const at = process.argv.indexOf(name)
    return at === -1 ? fallback : process.argv[at + 1]
  }
  const instance = option('--instance', 'jeyarama/dash')
  const [client, name] = instance.split('/')
  const release = option('--release', `origin/release/${client}-${name}-prod`)
  const headRef = option('--head', 'HEAD')
  const released = await builtAt(release, instance)
  const head = await builtAt(headRef, instance)
  for (const app of head.apps) {
    const was = released.apps.find((r) => r.path === app.path)
    const moved = was && was.digest !== app.digest ? 'files moved' : 'same files'
    console.log(`${app.path}: ${was?.version ?? 'absent'} -> ${app.version}, ${moved}, digest ${app.digest.slice(0, 12)}`)
  }
  const problems = digestProblems({ released: released.apps, head: head.apps })
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length) process.exit(1)
  console.log(`No app would stop a deploy from ${release} to ${headRef}.`)
}
