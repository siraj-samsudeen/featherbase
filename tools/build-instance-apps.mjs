#!/usr/bin/env node
// Used by apps/server/Dockerfile: builds a client instance's apps and lays out
// what its image holds, under the output folder:
//
//   instance-apps/<app>-<version>/        package.json, featherbase.json, dist
//   client-apps/<client>/instances/<instance>/
//
// Only the current version of each app: an upgrade moves from the installed
// record in the database, not from the old version's files (#1178).
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, DevError, resolveInstance } from './dev.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
 * workspace install gives them, so a build from an archive installs them first.
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
  cpSync(join(root, folder), join(output, folder), { recursive: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`!! ${error instanceof DevError ? error.message : error.stack ?? error}`)
    process.exit(1)
  })
}
