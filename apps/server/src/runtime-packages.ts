import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { registerApp, forgetRuntimePackages, listInstalledApps, suspendRuntimeApp, loadInstalledApps, type AppManifest } from './apps'
import { tableDefSchema } from './table-engine'
import { hasPermission } from './permissions'
import { AppError } from './errors'
import { appOperation } from './app-lifecycle'
import { RESERVED_APP_ROOTS, appHref, type AppScopeResolver, type AppProductAuthorizer, type AppOperationDeclaration, type RuntimeActionHandler, type RuntimeReadHandler } from 'shared'
import { executeRuntimeAction, executeRuntimeRead, type DeclaredOperations } from './runtime-actions'
import { actionDeclaration, readDeclaration, validateOperationFacts, freezeJson, type DeclaredAppOperation } from './app-access'
import { sql, withTransaction } from './db'
import { invalidateMeta } from './meta'
import { migrationSchema, migrationLedger, packageVersion, validateMigrations, canonical, checksum, compareVersions, applyAdditions, refuse } from './runtime-migrations'

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
  roles: z.array(z.string().min(1)).optional(),
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
  reads: readDeclaration.optional(),
  migrations: z.array(migrationSchema).default([]),
}).strict()

interface RuntimePackage {
  name: string
  title: string
  entryTable: string
  clientRoot?: string
  actions?: DeclaredOperations
  reads?: DeclaredOperations<RuntimeReadHandler>
  root: string
  version: string
  digest: string
  manifest: z.infer<typeof manifestSchema>
  app: AppManifest
}
const packages = new Map<string, RuntimePackage>()
const artifacts = new Map<string, RuntimePackage>()
export const packageFailures: { path: string; error: string }[] = []

function namedFunctions<H>(value: unknown, names: string[]): Map<string, H> {
  const exported = value ?? {}
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) throw new Error('Expected named package functions')
  const entries = Object.entries(exported)
  if (entries.length !== new Set(names).size || entries.some(([name, handler]) => !names.includes(name) || typeof handler !== 'function'))
    throw new Error('Package handlers and authorization callbacks must match declared names')
  return new Map(entries as [string, H][])
}

export function availableRuntimeVersions() {
  return [...artifacts.values()].map(({ name, version, digest }) => ({ name, version, digest }))
    .sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version))
}

async function contained(root: string, name: string): Promise<string> {
  if (isAbsolute(name)) throw new Error('Package paths must be relative')
  const target = await realpath(resolve(root, name))
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Package path escapes its declared root')
  return target
}

// Shipped files, never operator directory spelling, identify an artifact.
async function artifactDigest(root: string) {
  const hash = createHash('sha256')
  async function walk(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      if (entry.isSymbolicLink()) refuse('Package artifact must not contain symbolic links')
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else hash.update(canonical([relative(root, file), (await readFile(file)).toString('base64')]))
    }
  }
  await walk(root)
  return hash.digest('hex')
}

async function verifyArtifact(pkg: RuntimePackage | undefined): Promise<RuntimePackage> {
  if (!pkg) refuse('Package artifact is unavailable; restore the exact version in configured application paths and restart')
  try {
    if (await artifactDigest(pkg.root) !== pkg.digest) refuse('Package artifact changed; restore immutable files and restart before previewing again')
  } catch (error) {
    if (error instanceof AppError) throw error
    refuse('Package artifact is missing; restore the exact version and restart')
  }
  return pkg
}

function selectPackage(pkg: RuntimePackage) {
  registerApp(pkg.app)
  packages.set(pkg.name, pkg)
}

export async function verifySelectedRuntimePackage(name: string) {
  const pkg = await verifyArtifact(packages.get(name))
  const [row] = await sql`select * from installed_app where name = ${name}`
  if (row && !matchesInstalled(pkg, row)) refuse('Restore the exact installed artifact before enabling')
}

// @spec runtime_upgrade_identity
// @spec runtime_upgrade_identity.unversioned_legacy_install_fails_closed
function matchesInstalled(pkg: RuntimePackage, row: Record<string, unknown>) {
  if (row.package_version !== pkg.version) return false
  if (row.artifact_digest) return row.artifact_digest === pkg.digest
  // Legacy installs have no artifact fingerprint. Require their recorded
  // declaration, not just version, before trusting the operator's v1 artifact.
  const stored = { ...(row.manifest as object), migrations: (row.manifest as { migrations?: unknown })?.migrations ?? [] }
  return canonical(stored) === canonical(pkg.app.runtime_manifest)
}

// Boot discovery indexes versions without upgrading an installed application.
// Importing any server module grants full Node privileges, deliberately.
export function discoverPackages(paths: string[]) {
  return appOperation(async () => {
    forgetRuntimePackages()
    packages.clear()
    artifacts.clear()
    packageFailures.length = 0
    const duplicates = new Set<string>()
    for (const directory of paths) {
      try {
        const root = await realpath(directory)
        const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
        if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string')
          throw new Error('Expected npm package name and version')
        packageVersion.parse(pkg.version)
        const manifestPath = await contained(root, pkg.featherbase ?? 'featherbase.json')
        const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
        if ((RESERVED_APP_ROOTS as readonly string[]).includes(manifest.name))
          throw new Error(`App name ${manifest.name} is reserved for Featherbase`)
        validateMigrations(manifest.name, pkg.version, manifest.tables, manifest.migrations)
        const digest = await artifactDigest(root)
        const key = `${manifest.name}@${pkg.version}`
        if (duplicates.has(key)) refuse('Duplicate different artifacts for one package version')
        const duplicate = artifacts.get(key)
        if (duplicate) {
          if (duplicate.digest === digest) continue
          artifacts.delete(key)
          duplicates.add(key)
          refuse('Duplicate different artifacts for one package version')
        }
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
        let handlers = new Map<string, RuntimeActionHandler>()
        let readHandlers = new Map<string, RuntimeReadHandler>()
        let resolvers = new Map<string, AppScopeResolver>()
        let authorizers = new Map<string, AppProductAuthorizer>()
        const actionOperations = manifest.actions?.version === 2 ? manifest.actions.operations : {}
        const readOperations = manifest.reads?.operations ?? {}
        const allOperations = [...Object.values(actionOperations), ...Object.values(readOperations)]
        for (const operation of allOperations) validateOperationFacts(operation, manifest.tables)
        // @spec declared_app_actions_fail_closed
        for (const declaration of [manifest.actions, manifest.reads]) {
          if (!declaration) continue
          if (!manifest.server) throw new Error('Declared operations require a server module')
          for (const table of declaration.tables) {
            if (!names.has(table) && (!manifest.permissions.some(permission => permission.table === table) || table.includes('.')))
              throw new Error('Shared action Tables require declared permissions; other apps are not allowed')
          }
        }
        if (manifest.server) {
          const modulePath = await contained(root, manifest.server)
          if (!/\.(mjs|js)$/.test(modulePath)) throw new Error('Server module must be compiled JavaScript')
          const module = await import(/* @vite-ignore */ `${pathToFileURL(modulePath).href}?artifact=${digest}`)
          if (module.apiVersion !== 1) throw new Error('Incompatible server API version')
          handlers = namedFunctions(module.actions, manifest.actions?.version === 1 ? manifest.actions.names : Object.keys(actionOperations))
          readHandlers = namedFunctions(module.reads, Object.keys(readOperations))
          resolvers = namedFunctions(module.scopeResolvers, allOperations.flatMap(o => 'scope' in o && o.scope.kind === 'resolver' ? [o.scope.name] : []))
          authorizers = namedFunctions(module.authorizers, allOperations.flatMap(o => o.authorization.kind === 'product' ? [o.authorization.name] : []))
          for (const [table, validator] of Object.entries(module.validators ?? {})) {
            if (!names.has(table) || typeof validator !== 'function')
              throw new Error('Validators must target owned Tables')
            doc_events[table] = { before_validate: (ctx) => (validator as Validator)({
              row: ctx.row, old: ctx.old, user: ctx.user, isNew: ctx.isNew,
              reject(message, fields) { throw new AppError('ValidationError', message, fields) },
            }) }
          }
        }
        const bindOperations = (operations: Record<string, AppOperationDeclaration>) => new Map(Object.entries(operations).map(([name, declaration]): [string, DeclaredAppOperation] =>
          [name, { declaration: freezeJson(declaration), resolver: 'scope' in declaration && declaration.scope.kind === 'resolver' ? resolvers.get(declaration.scope.name) : undefined,
            authorizer: declaration.authorization.kind === 'product' ? authorizers.get(declaration.authorization.name) : undefined }]))
        const app: AppManifest = { name: manifest.name, tables: manifest.tables,
          roles: manifest.roles, permissions: manifest.permissions, doc_events, runtime_package: true,
          runtime_identity: { version: pkg.version, digest, ledger: migrationLedger(manifest.migrations) },
          runtime_manifest: { ...manifest, packageName: pkg.name, packageVersion: pkg.version } }
        artifacts.set(key, { name: manifest.name, title: manifest.title,
          entryTable: manifest.entryTable, clientRoot, root, version: pkg.version, digest, manifest, app,
          // @spec explicit_runtime_policy_upgrade
          // V1 stays recognizable as an exact upgrade predecessor, never gets a default policy.
          actions: manifest.actions ? { entryTable: manifest.entryTable, tables: manifest.actions.tables, handlers, operations: bindOperations(actionOperations) } : undefined,
          reads: manifest.reads ? { entryTable: manifest.entryTable, tables: manifest.reads.tables, handlers: readHandlers, operations: bindOperations(readOperations) } : undefined })
      } catch (error) {
        packageFailures.push({ path: directory, error: error instanceof Error ? error.message : String(error) })
        console.warn('[runtime-packages] Artifact rejected:', directory, error instanceof Error ? error.message : String(error))
      }
    }
    // @spec runtime_upgrade_identity.restart_selects_installed_code
    const installed = await sql`select * from installed_app where runtime_package`
    for (const pkg of artifacts.values()) {
      const row = installed.find(r => r.name === pkg.name)
      if (row ? matchesInstalled(pkg, row) : !packages.has(pkg.name) || compareVersions(pkg.version, packages.get(pkg.name)!.version) > 0)
        selectPackage(pkg)
    }
    return packageFailures
  }, true)
}

export function runPackageAction(app: string, action: string, input: unknown, user: string) {
  return executeRuntimeAction(app, action, input, user, () => packages.get(app)?.actions)
}

export function runPackageRead(app: string, read: string, input: unknown, user: string, discovery = false) {
  return executeRuntimeRead(app, read, input, user, () => packages.get(app)?.reads, discovery)
}

export function declaredPackageActions() {
  return [...packages.values()].map(pkg => ({ app: pkg.name, actions: [...(pkg.actions?.handlers.keys() ?? [])],
    ...(pkg.manifest.actions?.version === 1 ? { diagnostic: 'Explicit action policy upgrade required' } : {}) }))
}

async function upgradePlan(name: string, version: string) {
  const [row] = await sql`select * from installed_app where name = ${name} and runtime_package`
  if (!row) refuse('Upgrade requires an installed runtime application')
  const target = await verifyArtifact(artifacts.get(`${name}@${version}`))
  const prior = await verifyArtifact(artifacts.get(`${name}@${row.package_version}`))
  if (!matchesInstalled(prior, row)) refuse('Installed artifact does not match its recorded identity')
  if (row.activation_pending) throw new AppError('ConflictError', 'Activate the committed upgrade before previewing another version')
  if (compareVersions(version, prior.version) <= 0) refuse('Target must be newer than installed version; downgrades are unsupported')
  const history = target.manifest.migrations
  const ledger = migrationLedger(history)
  const installedLedger = row.migration_ledger as { id: string; checksum: string }[]
  if (canonical(installedLedger) !== canonical(ledger.slice(0, installedLedger.length)))
    refuse('Migration checksum history changed or was omitted')
  const pending = history.slice(installedLedger.length)
  if (!pending.length || pending[0].fromVersion !== prior.version)
    refuse('Migration history skips the installed version')
  const expected = structuredClone(prior.manifest.tables)
  for (const m of pending) for (const op of m.operations) {
    const table = expected.find(t => t.name === op.table)
    if (!table || table.columns.some(c => c.column_name === op.column.column_name)) refuse('Migration changes an existing column or unknown Table')
    table.columns.push(op.column)
  }
  if (canonical(expected) !== canonical(target.manifest.tables)) refuse('Unsupported destructive or undeclared schema change')
  if (canonical(prior.manifest.permissions) !== canonical(target.manifest.permissions) || prior.app.runtime_manifest == null ||
      (prior.app.runtime_manifest as { packageName: string }).packageName !== (target.app.runtime_manifest as { packageName: string }).packageName)
    refuse('Permission or package identity changes are unsupported')
  // @spec runtime_upgrade_reviewed_plan.reviewed_artifact_changes
  const plan = { name, currentVersion: prior.version, targetVersion: target.version,
    currentArtifact: prior.digest, targetArtifact: target.digest, enabled: row.enabled,
    migrations: pending.map(m => ({ id: m.id, checksum: checksum(m), operations: m.operations })),
    tables: [...new Set(pending.flatMap(m => m.operations.map(op => op.table)))],
    permissions: [], jobs: [], indexes: [], destructive: false, dataEffects: 'Existing rows unchanged; added columns are NULL',
    codeOnly: pending.every(m => m.operations.length === 0) }
  return { row, target, prior, pending, ledger, plan: { ...plan, planId: checksum(plan) } }
}

export function previewAppUpgrade(name: string, version: string) {
  return appOperation(async () => (await upgradePlan(name, version)).plan)
}

export function upgradeApp(name: string, version: string, planId: string) {
  return appOperation(async () => {
    const [done] = await sql`select * from installed_app where name = ${name}`
    if (done?.package_version === version && done.upgrade_plan === planId) {
      const target = await verifyArtifact(artifacts.get(`${name}@${version}`))
      if (!matchesInstalled(target, done)) refuse('Restore the exact committed artifact before retrying')
      return { name, version, activationPending: done.activation_pending }
    }
    const prepared = await upgradePlan(name, version)
    if (prepared.plan.planId !== planId) throw new AppError('ConflictError', 'Upgrade plan is stale; preview and review again')
    // @spec runtime_upgrade_commit_and_activation
    // @spec runtime_upgrade_commit_and_activation.failed_migration_preserves_active_version
    try {
      await withTransaction(async () => {
        await applyAdditions(prepared.pending, name)
        await sql`update installed_app set package_version = ${version}, artifact_digest = ${prepared.target.digest},
          manifest = ${sql.json(prepared.target.app.runtime_manifest as never)},
          migration_ledger = ${sql.json(prepared.ledger)}, activation_pending = true,
          previous_artifact = ${sql.json({ version: prepared.prior.version, digest: prepared.prior.digest })},
          upgrade_plan = ${planId} where name = ${name}`
      })
    } catch (error) {
      invalidateMeta()
      if (error instanceof AppError) throw error
      refuse('Migration failed; prior version and data are unchanged. Check for schema conflicts before retrying')
    }
    suspendRuntimeApp(name)
    selectPackage(prepared.target)
    return { name, version, activationPending: true }
  }, true)
}

export function activateAppUpgrade(name: string, version: string) {
  return appOperation(async () => {
    const [row] = await sql`select * from installed_app where name = ${name} and runtime_package`
    if (!row || row.package_version !== version) refuse('Activate requires the committed package version')
    // @spec runtime_upgrade_recovery_boundary
    // @spec runtime_upgrade_recovery_boundary.committed_target_disappears
    const target = await verifyArtifact(artifacts.get(`${name}@${version}`))
    if (!matchesInstalled(target, row)) refuse('Restore the exact committed artifact before activation')
    selectPackage(target)
    await sql`update installed_app set activation_pending = false where name = ${name}`
    await loadInstalledApps()
    return { name, version, enabled: row.enabled, activationPending: false }
  }, true)
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
