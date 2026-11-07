#!/usr/bin/env node
// Used by apps/server/Dockerfile: builds a client instance's apps and lays out
// what its image holds, under the output folder:
//
//   instance-apps/<app>-<version>/        package.json, featherbase.json, dist
//   client-apps/<client>/instances/<instance>/
//
// To upgrade an installed version, an instance needs its exact files as well as
// the new version's. A release PR lists it in instance.json under
// previousVersions, naming a source archive of the commit that released it:
//
//   "previousVersions": [{ "path": "client-apps/acme/board", "version": "1.0.0",
//                          "archive": "https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>" }]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, DevError, resolveInstance } from './dev.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The earlier versions an instance's image also holds. */
export function previousVersions(instanceFile) {
  const { previousVersions: listed = [] } = JSON.parse(readFileSync(instanceFile, 'utf8'))
  if (!Array.isArray(listed)) throw new DevError(`${instanceFile}: previousVersions must be a list`)
  for (const entry of listed)
    if (typeof entry?.path !== 'string' || typeof entry?.version !== 'string' || !/^https:\/\//.test(entry?.archive ?? ''))
      throw new DevError(`${instanceFile}: each of previousVersions needs a path, a version and an https archive`)
  return listed
}

/** The shipped files of a built app, in its own versioned folder. */
export function copyShipped(appRoot, output) {
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const manifestFile = pkg.featherbase ?? 'featherbase.json'
  const { name } = JSON.parse(readFileSync(join(appRoot, manifestFile), 'utf8'))
  const target = join(output, 'instance-apps', `${name}-${pkg.version}`)
  for (const file of ['package.json', manifestFile, 'dist'])
    cpSync(join(appRoot, file), join(target, file), { recursive: true })
  return { name, version: pkg.version, target }
}

/**
 * The workspace packages an app takes by path (`file:../../packages/x`), by
 * name. An archive holds their source but not their dependencies, which the
 * workspace install gives them, so a previous version installs them first.
 */
export function workspaceDependencies(appRoot, sourceRoot) {
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const names = []
  for (const spec of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue
    const folder = resolve(appRoot, spec.slice('file:'.length))
    if (!folder.startsWith(resolve(sourceRoot) + sep)) throw new DevError(`${spec} is outside the archive`)
    names.push(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name)
  }
  return names
}

/** Builds an app from an unpacked source tree that has no install yet, and lays out its shipped files. */
export function buildUnpacked(appRoot, sourceRoot, output, env) {
  const packages = workspaceDependencies(appRoot, sourceRoot)
  if (packages.length) {
    const filters = packages.flatMap((name) => ['--filter', `${name}...`])
    const installed = spawnSync('pnpm', ['install', '--frozen-lockfile', ...filters], { cwd: sourceRoot, env, stdio: 'inherit' })
    if (installed.status !== 0) throw new DevError(`Could not install ${packages.join(', ')} under ${sourceRoot}`)
  }
  buildApp({ root: appRoot }, env)
  return copyShipped(appRoot, output)
}

async function buildPrevious(entry, output, env) {
  const response = await fetch(entry.archive)
  if (!response.ok) throw new DevError(`${entry.archive} answered HTTP ${response.status}`)
  const work = mkdtempSync(join(tmpdir(), 'previous-'))
  const file = join(work, 'source.tar.gz')
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  const unpacked = spawnSync('tar', ['-xzf', file, '--strip-components=1', '-C', work], { stdio: 'inherit' })
  if (unpacked.status !== 0) throw new DevError(`Could not unpack ${entry.archive}`)
  const appRoot = join(work, ...entry.path.split('/'))
  if (!existsSync(join(appRoot, 'package.json'))) throw new DevError(`${entry.archive} has no ${entry.path}`)
  const { version } = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  if (version !== entry.version) throw new DevError(`${entry.archive} holds ${entry.path} ${version}, not ${entry.version}`)
  return buildUnpacked(appRoot, work, output, env)
}

async function main([name, output]) {
  if (!name || !output) throw new DevError('usage: build-instance-apps.mjs <client>/<instance> <output folder>')
  const instance = resolveInstance(name, root)
  const folder = join('client-apps', instance.client, 'instances', instance.instance)
  mkdirSync(output, { recursive: true })
  for (const app of instance.apps) {
    buildApp(app, process.env)
    const { name: built, version } = copyShipped(app.root, output)
    console.log(`built ${built} ${version}`)
  }
  for (const entry of previousVersions(join(root, folder, 'instance.json'))) {
    const { name: built, version } = await buildPrevious(entry, output, process.env)
    console.log(`built ${built} ${version}, for upgrading from it`)
  }
  cpSync(join(root, folder), join(output, folder), { recursive: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`!! ${error instanceof DevError ? error.message : error.stack ?? error}`)
    process.exit(1)
  })
}
