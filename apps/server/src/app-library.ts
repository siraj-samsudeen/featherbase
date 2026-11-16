import { readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { readPackageDeclaration, runtimePackageDeclarations, installedPackageDeclarations, discoverPackages, registerPreparedPackage, repinToFolder } from './runtime-packages'
import { installApp, isInstalled, listInstalledApps } from './apps'
import { childEnvironment, currentEnvironment, readNamedVariable } from './env'
import { AppError } from './errors'
import { appOperation } from './app-lifecycle'
import { storedEnvironment } from './db-environment'
import { canonical } from './runtime-migrations'

type Source = Awaited<ReturnType<typeof readPackageDeclaration>>
let sources: Map<string, Source> | undefined
type Preparation = { state: 'needed' | 'preparing' | 'ready' | 'failed' | 'unavailable'; error?: string }
const preparations = new Map<string, Preparation>()

async function directories(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory()).map(entry => resolve(root, entry.name)).sort()
}

// A source checkout is recognized relative to this server, never its cwd.
// Deployed servers without repository metadata offer only configured artifacts.
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
async function readSources(repository: string | null) {
  const sources = new Map<string, Source>()
  if (repository && await stat(resolve(repository, '.git')).catch(() => null)) {
    const roots = [
      ...await directories(resolve(repository, 'example-apps')),
      ...(await Promise.all((await directories(resolve(repository, 'client-apps'))).map(directories))).flat(),
    ]
    const duplicates = new Set<string>()
    for (const directory of roots) {
      try {
        const source = await readPackageDeclaration(directory)
        const name = source.manifest.name
        if (sources.has(name) || duplicates.has(name)) {
          sources.delete(name)
          duplicates.add(name)
        } else sources.set(name, source)
      } catch {
        // Not an app or an invalid source declaration: never offer it for execution.
      }
    }
  }
  return sources
}

/** Boot, preflight and operator commands agree on the installed library roots.
 * Reading their manifests never builds or imports an uninstalled package. */
export async function appLibraryPaths(paths: string[]) {
  sources ??= await readSources(checkout)
  const installed = await listInstalledApps()
  return [...paths, ...installed.flatMap(app => {
    const source = sources!.get(app.name)
    return source ? [source.root] : []
  })]
}

export async function discoverAppLibrary(paths: string[], repository: string | null = checkout) {
  sources = await readSources(repository)
  preparations.clear()
  const effectivePaths = await appLibraryPaths(paths)
  await discoverPackages(effectivePaths)
  // Match the existing development launcher: follow changed files only when
  // both the process and the database are development, never changed grants.
  if (currentEnvironment() === 'development' && await storedEnvironment() === 'development') {
    let repinned = false
    for (const app of await listInstalledApps()) {
      if (sources.has(app.name) && await repinToFolder(app.name, true) === 'repinned') repinned = true
    }
    if (repinned) await discoverPackages(effectivePaths)
  }
}

export async function appLibraryCatalog() {
  const installed = await listInstalledApps()
  const entries = new Map([...(sources ?? [])].map(([name, source]) => [name, { manifest: source.manifest, version: source.pkg.version }]))
  const ready = runtimePackageDeclarations()
  for (const entry of ready) entries.set(entry.manifest.name, entry)
  for (const entry of await installedPackageDeclarations()) entries.set(entry.manifest.name, entry)
  return [...entries.values()].map(({ manifest, version }) => {
    const row = installed.find(app => app.name === manifest.name)
    const { tables, roles, permissions, entryTable, settings, roleDefaults, datasets, actions, reads, jobs, scopeProvider, frameOrigins, glossary, tabs, bar } = manifest
    return {
      name: manifest.name, title: manifest.title, version, platformVersion: manifest.platformVersion, releaseNotes: manifest.releaseNotes ?? [],
      declarations: { tables, roles: roles ?? [], permissions, entryTable, settings: settings ?? [], roleDefaults, datasets, actions, reads, jobs, scopeProvider, frameOrigins, glossary, tabs, bar },
      secrets: (manifest.secrets ?? []).map(secret => {
        const name = typeof secret === 'string' ? secret : secret.name
        return { name, optional: typeof secret !== 'string' && secret.optional, present: !!readNamedVariable(name)?.trim() }
      }),
      installed: !!row, enabled: row?.enabled ?? false, active: row?.active ?? false,
      preparation: preparations.get(manifest.name) ?? { state: ready.some(entry => entry.manifest.name === manifest.name) ? 'ready' as const : row ? 'unavailable' as const : 'needed' as const },
    }
  }).sort((a, b) => a.title.localeCompare(b.title))
}

export async function prepareAndInstallApp(name: string) {
  if (await isInstalled(name)) throw new AppError('ConflictError', `App ${name} is already installed; use the upgrade lifecycle`)
  if (preparations.get(name)?.state === 'preparing')
    throw new AppError('ConflictError', `App ${name} is already being prepared`)
  if (preparations.get(name)?.state !== 'failed' && runtimePackageDeclarations().some(entry => entry.manifest.name === name)) {
    await installApp(name)
    return { name, installed: true as const }
  }
  const source = sources?.get(name)
  if (!source) throw new AppError('ValidationError', 'Unknown trusted app name; ask the operator to supply a compatible package')
  preparations.set(name, { state: 'preparing' })
  const assertReviewed = async () => {
    const declaration = await readPackageDeclaration(source.root)
    if (canonical({ manifest: declaration.manifest, pkg: declaration.pkg }) !== canonical({ manifest: source.manifest, pkg: source.pkg }))
      throw new AppError('ConflictError', `App ${name} changed since discovery. Ask the operator to restart Featherbase, review the updated app details, then retry.`)
  }
  try {
    // Reuse the repository's lockfile-aware build, in a child so inspection
    // remains responsive while its trusted npm build runs. No browser inputs
    // become commands, paths or arguments other than the catalog lookup above.
    await assertReviewed()
    const builder = pathToFileURL(resolve(checkout, 'tools/dev.mjs')).href
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e',
        `import {buildApp} from ${JSON.stringify(builder)}; import {env,argv} from 'node:process'; buildApp({root:argv[1]},env)`, source.root],
      { env: childEnvironment({}, [
        'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT',
        'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'CI',
        'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
      ]), stdio: 'inherit', timeout: 600_000 })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? done() : reject(new Error('Package build failed')))
    })
    await appOperation(async () => {
      await assertReviewed()
      await registerPreparedPackage(source.root, name)
      await installApp(name)
    }, true)
    preparations.set(name, { state: 'ready' })
    return { name, installed: true as const }
  } catch (cause) {
    console.warn('[app-library] Preparation failed:', name, cause)
    if (cause instanceof AppError) {
      if (await isInstalled(name)) preparations.delete(name)
      else preparations.set(name, { state: 'failed', error: cause.message })
      throw cause
    }
    const error = `Could not prepare and install ${name}. Ask the operator to check the server build log, restore a compatible package and its build dependencies, then retry. The app was not installed.`
    preparations.set(name, { state: 'failed', error })
    throw new AppError('ValidationError', error)
  }
}
