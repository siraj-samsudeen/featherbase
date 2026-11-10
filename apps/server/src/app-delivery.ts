// #1178 (D8): the deploy pipeline delivers an app's code fix to the running
// instance, which serves it at once: ship only what changed (the Vercel model).
//
// Only a code change to the installed version is taken; a change to what the
// app declares needs an ordinary deploy, which upgrades it. The delivered copy
// is kept on the instance's volume (FILE_STORAGE_DIR), so a restart serves it
// too. Beside the image's copy of the same version, the copy the installed
// record names wins: an ordinary deploy re-pins to the image's files.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { readVariable } from './env'
import { AppError } from './errors'

const MAX_BYTES = 50 * 1024 * 1024

/** Where delivered copies live, or null when the instance has no volume. */
export function deliveredAppsRoot(): string | null {
  const storage = readVariable('FILE_STORAGE_DIR')
  return storage ? join(storage, 'delivered-apps') : null
}

/** The app paths a server reads: the image's, then any delivered copies. */
export function appPathsFromEnvironment(): string[] {
  const configured = JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
  const root = deliveredAppsRoot()
  return root && existsSync(root) ? [...configured, `${root}/*`] : configured
}

/** For a delivered copy, the digest of the image's copy it replaced (kept
 *  beside it, outside the app's files); null for any other folder. */
export async function deliveredOver(folder: string): Promise<string | null> {
  const root = deliveredAppsRoot()
  if (!root || !existsSync(root)) return null
  const real = await realpath(folder)
  if (!real.startsWith((await realpath(root)) + sep)) return null
  return readFile(`${real}.over`, 'utf8').catch(() => '')
}

/** The deploy key, compared in constant time; false when delivery is off. */
export function deliveryKeyMatches(header: string | undefined): boolean {
  const key = readVariable('APP_DELIVERY_TOKEN')
  if (!key || key.length < 32 || !header?.startsWith('Bearer ')) return false
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(header.slice('Bearer '.length)), hash(key))
}

type DeliveredFile = { path: string; data: string }

function safePath(path: unknown): string {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\'))
    throw new AppError('ValidationError', `A delivered file needs a relative path: ${String(path)}`)
  const clean = normalize(path)
  if (clean.split(sep).some(part => part === '..' || part === '' || part === '.' || part === 'node_modules' || part === '.git'))
    throw new AppError('ValidationError', `A delivered file's path may not leave the app's folder: ${path}`)
  return clean
}

/** Write the delivered files, re-pin the installed app to them and serve
 *  them. Refuses, changing nothing, unless it is a code change to the
 *  installed version. */
export async function deliverApp(body: unknown) {
  const root = deliveredAppsRoot()
  if (!root) throw new AppError('ValidationError', 'Delivery needs FILE_STORAGE_DIR, a volume that survives a restart')
  const files = (body as { files?: unknown })?.files
  if (!Array.isArray(files) || !files.length) throw new AppError('ValidationError', 'Expected { files: [{ path, data }] }, data in base64')
  const decoded = (files as DeliveredFile[]).map(file => ({ path: safePath(file?.path), bytes: Buffer.from(String(file?.data ?? ''), 'base64') }))
  if (decoded.reduce((total, file) => total + file.bytes.length, 0) > MAX_BYTES) throw new AppError('ValidationError', 'A delivery is at most 50 MB')
  const incoming = join(root, `.incoming-${randomBytes(8).toString('hex')}`)
  try {
    for (const file of decoded) {
      await mkdir(dirname(join(incoming, file.path)), { recursive: true })
      await writeFile(join(incoming, file.path), file.bytes)
    }
    const pkg = JSON.parse(await readFile(join(incoming, 'package.json'), 'utf8').catch(() => '{}')) as { name?: string; version?: string }
    const { readPackageDeclaration } = await import('./runtime-packages')
    const { manifest } = await readPackageDeclaration(incoming).catch((error: Error) => {
      throw new AppError('ValidationError', `The delivered files are not an app: ${error.message}`)
    })
    const { sql } = await import('./db')
    const [row] = await sql`select package_version from installed_app where name = ${manifest.name} and runtime_package`
    if (!row || row.package_version !== pkg.version)
      throw new AppError('ConflictError', `Delivery takes a code change to the installed version of ${manifest.name}; ${pkg.version} is not it. Use an ordinary deploy.`)
    const target = join(root, String(manifest.name))
    const { appLibraryPaths } = await import('./app-library')
    const { shippedDigest } = await import('./runtime-packages')
    const configured = JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
    const over = await shippedDigest(await appLibraryPaths(configured), String(manifest.name), String(pkg.version))
    const previous = join(root, `.previous-${String(manifest.name)}-${randomBytes(4).toString('hex')}`)
    const previousOver = existsSync(`${target}.over`) ? await readFile(`${target}.over`, 'utf8') : null
    if (existsSync(target)) await rename(target, previous)
    await rename(incoming, target)
    await writeFile(`${target}.over`, over ?? '')
    try {
      const outcome = await follow(String(manifest.name))
      await rm(previous, { recursive: true, force: true })
      return { name: manifest.name, version: pkg.version, outcome }
    } catch (error) {
      await rm(target, { recursive: true, force: true })
      await rm(`${target}.over`, { force: true })
      if (existsSync(previous)) {
        await rename(previous, target)
        if (previousOver !== null) await writeFile(`${target}.over`, previousOver)
      }
      await follow(String(manifest.name)).catch(() => {})
      throw error
    }
  } finally {
    await rm(incoming, { recursive: true, force: true })
  }
}

async function follow(name: string): Promise<'same' | 'repinned'> {
  const { discoverAppLibrary } = await import('./app-library')
  const { discoverPackages, repinToFolder } = await import('./runtime-packages')
  const { appLibraryPaths } = await import('./app-library')
  const { loadInstalledApps } = await import('./apps')
  await discoverAppLibrary(appPathsFromEnvironment())
  const outcome = await repinToFolder(name, true)
  if (outcome === 'different')
    throw new AppError('ConflictError', `The delivered ${name} changes what the app declares, or is not the installed version. Use an ordinary deploy, which upgrades it.`)
  await discoverPackages(await appLibraryPaths(appPathsFromEnvironment()))
  await loadInstalledApps()
  return outcome
}
