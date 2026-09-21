import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { registerApp, forgetRuntimePackages, listInstalledApps, type AppManifest } from './apps'
import { tableDefSchema } from './table-engine'
import { hasPermission } from './permissions'
import { AppError } from './errors'
import { appOperation } from './app-lifecycle'
import { RESERVED_APP_ROOTS, appHref, type RuntimeActionHandler } from 'shared'
import { actionDeclaration, executeRuntimeAction, type DeclaredActions } from './runtime-actions'

// Public v1 hook contract is structural: packages never import core classes.
export interface PackageHookContext {
  row: Record<string, unknown>
  old?: Record<string, unknown>
  user: string
  isNew: boolean
  reject(message: string, fields?: Record<string, string>): never
}
type Validator = (context: PackageHookContext) => void | Promise<void>

// @spec versioned_trusted_artifact
const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  apiVersion: z.literal(1),
  name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  title: z.string().min(1),
  tables: z.array(tableDefSchema).min(1),
  permissions: z.array(z.object({
    table: z.string(), role: z.string(),
    tier: z.enum(['basic', 'restricted']).optional(),
    own_rows_only: z.boolean().optional(),
    can_read: z.boolean().optional(), can_write: z.boolean().optional(),
    can_create: z.boolean().optional(), can_delete: z.boolean().optional(),
    can_submit: z.boolean().optional(), can_cancel: z.boolean().optional(),
    can_amend: z.boolean().optional(),
  }).strict()).default([]),
  server: z.string().optional(),
  client: z.string().optional(),
  entryTable: z.string(),
  actions: actionDeclaration.optional(),
}).strict()

interface RuntimePackage {
  name: string
  title: string
  entryTable: string
  clientRoot?: string
  actions?: DeclaredActions
}
const packages = new Map<string, RuntimePackage>()
export const packageFailures: { path: string; error: string }[] = []

async function contained(root: string, name: string): Promise<string> {
  if (isAbsolute(name)) throw new Error('Package paths must be relative')
  const target = await realpath(resolve(root, name))
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Package path escapes its declared root')
  return target
}

// Boot-only, configured directories (unpack tarballs before starting server).
// Importing the server module grants full Node privileges, deliberately.
export function discoverPackages(paths: string[]) {
  return appOperation(async () => {
    forgetRuntimePackages()
    packages.clear()
    packageFailures.length = 0
    for (const directory of paths) {
      try {
        const root = await realpath(directory)
        const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
        if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string')
          throw new Error('Expected npm package name and version')
        const manifestPath = await contained(root, pkg.featherbase ?? 'featherbase.json')
        const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
        if ((RESERVED_APP_ROOTS as readonly string[]).includes(manifest.name))
          throw new Error(`App name ${manifest.name} is reserved for Featherbase`)
        if (packages.has(manifest.name)) throw new Error(`Duplicate app ${manifest.name}`)
        const names = new Set(manifest.tables.map((t) => t.name))
        if (names.size !== manifest.tables.length || !names.has(manifest.entryTable))
          throw new Error('Duplicate Tables or unknown entryTable')
        for (const table of manifest.tables) {
          // @spec logical_identity_maps_storage
          if (!table.name.startsWith(`${manifest.name}.`) || !table.label || table.system || table.data_source)
            throw new Error('Package Tables require qualified ownership, label and local storage')
        }
        let clientRoot: string | undefined
        if (manifest.client) {
          clientRoot = await contained(root, manifest.client)
          if (!(await stat(clientRoot)).isDirectory()) throw new Error('Client root is not a directory')
          await contained(clientRoot, 'index.html')
        }
        const doc_events: AppManifest['doc_events'] = {}
        const handlers = new Map<string, RuntimeActionHandler>()
        // @spec declared_app_actions_fail_closed
        if (manifest.actions) {
          if (!manifest.server) throw new Error('Declared actions require a server module')
          if (new Set(manifest.actions.names).size !== manifest.actions.names.length
            || new Set(manifest.actions.tables).size !== manifest.actions.tables.length)
            throw new Error('Duplicate action names or Tables')
          for (const table of manifest.actions.tables) {
            if (!names.has(table) && (!manifest.permissions.some(permission => permission.table === table) || table.includes('.')))
              throw new Error('Shared action Tables require declared permissions; other apps are not allowed')
          }
        }
        if (manifest.server) {
          const modulePath = await contained(root, manifest.server)
          if (!/\.(mjs|js)$/.test(modulePath)) throw new Error('Server module must be compiled JavaScript')
          const module = await import(/* @vite-ignore */ pathToFileURL(modulePath).href)
          if (module.apiVersion !== 1) throw new Error('Incompatible server API version')
          const exported = module.actions ?? {}
          if (!exported || typeof exported !== 'object' || Array.isArray(exported)) throw new Error('Expected named action handlers')
          for (const [name, handler] of Object.entries(exported)) {
            if (!manifest.actions?.names.includes(name) || typeof handler !== 'function')
              throw new Error('Action handlers must match declared names')
            handlers.set(name, handler as RuntimeActionHandler)
          }
          if (handlers.size !== (manifest.actions?.names.length ?? 0)) throw new Error('Missing declared action handler')
          for (const [table, validator] of Object.entries(module.validators ?? {})) {
            if (!names.has(table) || typeof validator !== 'function')
              throw new Error('Validators must target owned Tables')
            doc_events[table] = { before_validate: (ctx) => (validator as Validator)({
              row: ctx.row, old: ctx.old, user: ctx.user, isNew: ctx.isNew,
              reject(message, fields) { throw new AppError('ValidationError', message, fields) },
            }) }
          }
        }
        registerApp({ name: manifest.name, tables: manifest.tables,
          permissions: manifest.permissions, doc_events, runtime_package: true,
          runtime_manifest: { ...manifest, packageName: pkg.name, packageVersion: pkg.version } })
        packages.set(manifest.name, { name: manifest.name, title: manifest.title,
          entryTable: manifest.entryTable, clientRoot,
          actions: manifest.actions ? { entryTable: manifest.entryTable, tables: manifest.actions.tables, handlers } : undefined })
      } catch (error) {
        packageFailures.push({ path: directory, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return packageFailures
  }, true)
}

export function runPackageAction(app: string, action: string, input: unknown, user: string) {
  return executeRuntimeAction(app, action, input, user, () => packages.get(app)?.actions)
}

export function declaredPackageActions() {
  return [...packages.values()].map(pkg => ({ app: pkg.name, actions: [...(pkg.actions?.handlers.keys() ?? [])] }))
}

export async function appCatalog(user: string) {
  // @spec app_owns_client_root
  const installed = await listInstalledApps()
  const result = []
  for (const item of installed) {
    const pkg = packages.get(item.name)
    if (item.active && pkg?.clientRoot && await hasPermission(user, pkg.entryTable, 'read'))
      result.push({ name: pkg.name, title: pkg.title, href: appHref(pkg.name) })
  }
  return result
}

export async function appAsset(name: string, asset: string, user: string) {
  const catalog = await appCatalog(user)
  if (!catalog.some((entry) => entry.name === name))
    throw new AppError('NotFoundError', 'App is unavailable')
  const pkg = packages.get(name)!
  try {
    // @spec app_owns_client_root
    const file = await contained(pkg.clientRoot!, asset || 'index.html')
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
    return { file, bytes: await readFile(file) }
  } catch {
    throw new AppError('NotFoundError', 'App asset not found')
  }
}
