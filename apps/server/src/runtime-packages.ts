import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { registerApp, forgetRuntimePackages, listInstalledApps, suspendRuntimeApp, loadInstalledApps, provisionGrants, type AppManifest } from './apps'
import { tableDefSchema } from './table-engine'
import { hasPermission } from './permissions'
import { AppError } from './errors'
import { appOperation, provisionApp, withAppIdentity } from './app-lifecycle'
import { APP_TAB_ICONS, APP_TAB_LABEL_MAX, APP_TAB_PATH, RESERVED_APP_ROOTS, appHref, appTabLinks, type AppScopeProvider, type AppScopeResolver, type AppProductAuthorizer, type AppOperationDeclaration, type RuntimeActionHandler, type RuntimeReadHandler } from 'shared'
import { executeRuntimeAction, executeRuntimeRead, type DeclaredOperations } from './runtime-actions'
import { actionDeclaration, readDeclaration, scopeProviderDeclaration, validateOperationFacts, freezeJson, type DeclaredAppOperation } from './app-access'
import type { ScopeProviderBinding } from './person-scope'
import { loadAppSetup, secretEntries, secretsDeclaration, settingsDeclaration } from './app-settings'
import { roleDefaultsDeclaration, validateRoleDefaults } from './app-role-bindings'
import { datasetsDeclaration, forgetAppDatasets, registerAppDatasets } from './app-datasets'
import { glossaryDeclaration, syncAppGlossary, validateGlossary } from './glossary'
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { invalidateMeta } from './meta'
import { migrationSchema, migrationLedger, packageVersion, validateMigrations, canonical, checksum, compareVersions, applyMigrations, countLosses, describeLoss, refuse, replayForward, sameDeclaration, type Loss, type Operation } from './runtime-migrations'

// Public v1 hook contract is structural: packages never import core classes.
interface PackageHookContext {
  row: Record<string, unknown>
  old?: Record<string, unknown>
  user: string
  isNew: boolean
  reject(message: string, fields?: Record<string, string>): never
}
type Validator = (context: PackageHookContext) => void | Promise<void>

// #551 (ADR 0011): an app names the platform version it was built for, dated by
// month. These are the versions this Featherbase runs apps on.
export const SUPPORTED_PLATFORM_VERSIONS: readonly string[] = ['2026-10']

// #380 task 4.4: the tabs an app's staff move between on a phone, drawn by
// the shared top bar. An extension point with its own version, so the bar can
// change shape without moving the whole manifest.
const tabsDeclaration = z.object({
  version: z.literal(1),
  items: z.array(z.object({
    // Visible characters only: no zero-width or direction-control marks.
    label: z.string().trim().min(1).max(APP_TAB_LABEL_MAX).regex(/^[^\p{C}]*$/u, 'a tab label is visible text').refine(label => /[^\p{Z}]/u.test(label), 'a tab label is visible text'),
    icon: z.enum(APP_TAB_ICONS),
    path: z.string().regex(APP_TAB_PATH, 'a tab path is lower-case segments under the app, like "targets" or "" for its root'),
  }).strict()).min(2).max(5)
    .refine(items => new Set(items.map(item => item.path)).size === items.length, 'each tab opens a path of its own'),
}).strict()

// #642 (E4): an outside site the app frames, written as its exact origin:
// https, no wildcard, no path. The URL parser's own origin must read back the
// same text, which refuses a path, a trailing slash, credentials and a
// default port written out.
const frameOrigin = z.string().refine((value) => {
  if (value.includes('*')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value
  } catch {
    return false
  }
}, 'frameOrigins must be absolute https origins, like https://embed.example.com, with no wildcard or path')

// #642 (E8): a control the platform draws in the shared top bar. A picker is
// named by its label, filled from one of the app's reads, and sets one
// query-string key in the app's address.
const barControl = z.object({
  picker: z.string().min(1),
  options: z.string().min(1),
  sets: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'A bar control sets a query-string key: lower case letters, digits and _, starting with a letter'),
}).strict()

// What a picker's read answers: its options, in order. The value goes into
// the address, so it is text.
const barOptions = z.array(z.object({ value: z.string().min(1), label: z.string().min(1) }).strict())

const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  platformVersion: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'platformVersion must be a month, like 2026-10'),
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
  // #559: this app provides people's scope for the instance (one app at most).
  scopeProvider: scopeProviderDeclaration.optional(),
  // #620 (E2): what the app reads per instance, and the deployment variables
  // it reads. D4: which of the instance's roles should carry each app role,
  // written as App Role Binding rows once, at install.
  settings: settingsDeclaration.optional(),
  secrets: secretsDeclaration.optional(),
  roleDefaults: roleDefaultsDeclaration.optional(),
  // #625 (E3): the cached datasets the app reads, built by the platform.
  datasets: datasetsDeclaration.optional(),
  // #642 (E4): the outside sites the app's own pages may frame.
  frameOrigins: z.array(frameOrigin).optional(),
  // #642 (E8): the app's controls in the shared top bar.
  bar: z.array(barControl).optional(),
  tabs: tabsDeclaration.optional(),
  // #629: the app's glossary terms, written under the app at install and
  // upgrade.
  glossary: glossaryDeclaration.optional(),
  migrations: z.array(migrationSchema).default([]),
}).strict()

interface RuntimePackage {
  name: string
  title: string
  entryTable: string
  clientRoot?: string
  actions?: DeclaredOperations
  reads?: DeclaredOperations<RuntimeReadHandler>
  scopeProvider?: ScopeProviderBinding
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
// `transform` may rewrite a file's bytes (by its path relative to the root)
// before hashing; only migration 0125 uses it, to fingerprint files as they
// were before a rename.
export async function artifactDigest(root: string, transform?: (file: string, bytes: Buffer) => Buffer) {
  const hash = createHash('sha256')
  async function walk(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      if (entry.isSymbolicLink()) refuse('Package artifact must not contain symbolic links')
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else {
        const bytes = await readFile(file)
        hash.update(canonical([relative(root, file), (transform ? transform(relative(root, file), bytes) : bytes).toString('base64')]))
      }
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
  registerAppDatasets(pkg.name, pkg.manifest.datasets)
}

export async function verifySelectedRuntimePackage(name: string) {
  const pkg = await verifyArtifact(packages.get(name))
  const [row] = await sql`select * from installed_app where name = ${name}`
  if (row && !matchesInstalled(pkg, row)) refuse('Restore the exact installed artifact before enabling')
  await assertOnlyScopeProvider(pkg)
}

// #559: exactly one enabled app provides people's scope. Checked when an app
// that provides it is installed, enabled, upgraded or activated.
async function assertOnlyScopeProvider(pkg: RuntimePackage) {
  if (!pkg.scopeProvider) return
  const others = await sql`select name from installed_app where name <> ${pkg.name} and enabled and manifest ? 'scopeProvider' order by name`
  if (others.length) throw new AppError('ConflictError',
    `Only one enabled app may provide people's scope; ${others.map(r => String(r.name)).join(', ')} already does`)
}

// #559: the instance's one scope provider: the enabled, active app whose
// installed manifest declares it, running its exact installed artifact. None,
// or more than one, is no provider at all.
export async function findScopeProvider(): Promise<ScopeProviderBinding | undefined> {
  const rows = await sql`select * from installed_app
    where runtime_package and enabled and not activation_pending and manifest ? 'scopeProvider'`
  if (rows.length !== 1) return undefined
  const pkg = packages.get(String(rows[0].name))
  return pkg && matchesInstalled(pkg, rows[0]) ? pkg.scopeProvider : undefined
}

function matchesInstalled(pkg: RuntimePackage, row: Record<string, unknown>) {
  if (row.package_version !== pkg.version) return false
  if (row.artifact_digest) return row.artifact_digest === pkg.digest
  // Legacy installs have no artifact fingerprint. Require their recorded
  // declaration, not just version, before trusting the operator's v1 artifact.
  const stored = { ...(row.manifest as object), migrations: (row.manifest as { migrations?: unknown })?.migrations ?? [] }
  return canonical(stored) === canonical(pkg.app.runtime_manifest)
}

// An app's directory: its npm identity and its parsed manifest.
async function readArtifact(directory: string) {
  const root = await realpath(directory)
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string')
    throw new Error('Expected npm package name and version')
  packageVersion.parse(pkg.version)
  const manifestPath = await contained(root, pkg.featherbase ?? 'featherbase.json')
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  return { root, pkg: pkg as { name: string; version: string }, manifest }
}

/** An app directory's name, version and resolved root (migration 0125). */
export async function artifactIdentity(directory: string) {
  const { root, pkg, manifest } = await readArtifact(directory)
  return { name: manifest.name, version: pkg.version, root }
}

// One app directory, validated and loaded: its manifest, fingerprint and
// server module. Registers nothing.
async function loadArtifact(directory: string): Promise<RuntimePackage> {
  const { root, pkg, manifest } = await readArtifact(directory)
  if (!SUPPORTED_PLATFORM_VERSIONS.includes(manifest.platformVersion))
    throw new Error(`App ${manifest.name} was built for platform version ${manifest.platformVersion}; this Featherbase supports ${SUPPORTED_PLATFORM_VERSIONS.join(', ')}`)
  if ((RESERVED_APP_ROOTS as readonly string[]).includes(manifest.name))
    throw new Error(`App name ${manifest.name} is reserved for Featherbase`)
  validateMigrations(manifest.name, pkg.version, manifest.tables, manifest.migrations)
  const digest = await artifactDigest(root)
  validateRoleDefaults(manifest.roleDefaults, manifest.roles)
  validateGlossary(manifest.glossary, manifest.tables, manifest.permissions)
  const names = new Set(manifest.tables.map((t) => t.name))
  if (names.size !== manifest.tables.length || !names.has(manifest.entryTable))
    throw new Error('Duplicate Tables or unknown entryTable')
  for (const table of manifest.tables) {
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
  let providers = new Map<string, AppScopeProvider>()
  const provider = manifest.scopeProvider
  if (provider) {
    if (!manifest.server) throw new Error('A scope provider requires a server module')
    // An owned Table the provider reads must carry the mark; another
    // Table's mark is checked on every read.
    for (const table of provider.tables) {
      const owned = manifest.tables.find(t => t.name === table)
      if (owned && !owned.decides_scope) throw new Error('A scope provider reads only Tables marked decides_scope')
      if (owned?.columns.some(column => column.column_type === 'Sub-table')) throw new Error('A scope provider cannot read Tables with Sub-tables')
    }
  }
  const actionOperations = manifest.actions?.version === 2 ? manifest.actions.operations : {}
  const readOperations = manifest.reads?.operations ?? {}
  const allOperations = [...Object.values(actionOperations), ...Object.values(readOperations)]
  const barKeys = new Set<string>()
  for (const control of manifest.bar ?? []) {
    if (!Object.hasOwn(readOperations, control.options))
      throw new Error(`The bar's ${control.picker} picker is filled from ${control.options}, which is not one of the app's reads`)
    if (barKeys.has(control.sets)) throw new Error(`Two bar controls set ${control.sets}; each sets its own key`)
    barKeys.add(control.sets)
  }
  // #666: an operation needs only secrets the app declares.
  const declaredSecrets = new Set(secretEntries(manifest.secrets).map(entry => entry.name))
  for (const [kind, operations] of [['read', readOperations], ['action', actionOperations]] as const)
    for (const [operation, declaration] of Object.entries(operations))
      for (const secret of declaration.needs ?? [])
        if (!declaredSecrets.has(secret)) throw new Error(`The ${kind} ${operation} needs the secret ${secret}, which the app does not declare in its secrets`)
  for (const operation of allOperations) validateOperationFacts(operation, manifest.tables)
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
    if (module.platformVersion !== manifest.platformVersion)
      throw new Error(`App ${manifest.name}'s server module was built for platform version ${String(module.platformVersion)}, but its manifest says ${manifest.platformVersion}`)
    handlers = namedFunctions(module.actions, manifest.actions?.version === 1 ? manifest.actions.names : Object.keys(actionOperations))
    readHandlers = namedFunctions(module.reads, Object.keys(readOperations))
    resolvers = namedFunctions(module.scopeResolvers, allOperations.flatMap(o => 'scope' in o && o.scope.kind === 'resolver' ? [o.scope.name] : []))
    authorizers = namedFunctions(module.authorizers, allOperations.flatMap(o => o.authorization.kind === 'product' ? [o.authorization.name] : []))
    providers = namedFunctions(module.scopeProviders, provider ? [provider.name] : [])
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
      authorizer: declaration.authorization.kind === 'product' ? authorizers.get(declaration.authorization.name) : undefined,
      ...(declaration.policy.kind === 'person_scope' ? { scopeProvider: findScopeProvider } : {}) }]))
  const setup = () => loadAppSetup(manifest.name, manifest)
  const app: AppManifest = { name: manifest.name, tables: manifest.tables,
    roles: manifest.roles, permissions: manifest.permissions, doc_events, runtime_package: true,
    runtime_identity: { version: pkg.version, digest, ledger: migrationLedger(manifest.migrations) },
    runtime_manifest: { ...manifest, packageName: pkg.name, packageVersion: pkg.version } }
  return { name: manifest.name, title: manifest.title,
    entryTable: manifest.entryTable, clientRoot, root, version: pkg.version, digest, manifest, app,
    scopeProvider: provider ? { app: manifest.name, title: manifest.title, version: pkg.version, tables: provider.tables, identifiers: provider.identifiers ?? [], provide: providers.get(provider.name)! } : undefined,
    // V1 stays recognizable as an exact upgrade predecessor, never gets a default policy.
    actions: manifest.actions ? { entryTable: manifest.entryTable, tables: manifest.actions.tables, handlers, operations: bindOperations(actionOperations), setup } : undefined,
    reads: manifest.reads ? { entryTable: manifest.entryTable, tables: manifest.reads.tables, handlers: readHandlers, operations: bindOperations(readOperations), setup, datasets: manifest.datasets } : undefined }
}

// The apps on `paths`, by name@version, as boot takes them: each loaded and
// validated, and a version shipped twice with different files dropped as a
// conflict (Codex round 1 on #643: the release guard must agree with boot).
// Registers nothing.
async function loadArtifacts(paths: string[]) {
  const loaded = new Map<string, RuntimePackage>()
  const failures: { path: string; error: string }[] = []
  const duplicates = new Set<string>()
  for (const directory of paths) {
    try {
      const pkg = await loadArtifact(directory)
      const key = `${pkg.name}@${pkg.version}`
      if (duplicates.has(key)) refuse('Duplicate different artifacts for one package version')
      const duplicate = loaded.get(key)
      if (duplicate) {
        if (duplicate.digest === pkg.digest) continue
        loaded.delete(key)
        duplicates.add(key)
        refuse('Duplicate different artifacts for one package version')
      }
      loaded.set(key, pkg)
    } catch (error) {
      failures.push({ path: directory, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { loaded, failures }
}

/** #642 (E7): the installed rows (`name`, `package_version`,
 *  `artifact_digest`, `manifest`) whose exact version and fingerprint no app on
 *  `paths` ships, as boot would take them. */
export async function unshippedApps<Row extends Record<string, unknown>>(installed: Row[], paths: string[]): Promise<Row[]> {
  const shipped = [...(await loadArtifacts(paths)).loaded.values()]
  return installed.filter(row => !shipped.some(pkg => pkg.name === row.name && matchesInstalled(pkg, row)))
}

// Boot discovery indexes versions without upgrading an installed application.
// Importing any server module grants full Node privileges, deliberately.
export function discoverPackages(paths: string[]) {
  return appOperation(async () => {
    forgetRuntimePackages()
    forgetAppDatasets()
    packages.clear()
    artifacts.clear()
    packageFailures.length = 0
    const { loaded, failures } = await loadArtifacts(paths)
    for (const [key, pkg] of loaded) artifacts.set(key, pkg)
    for (const failure of failures) {
      packageFailures.push(failure)
      console.warn('[runtime-packages] Artifact rejected:', failure.path, failure.error)
    }
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

async function upgradePlan(name: string, version: string, preview = true) {
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
  // #651: the installed declaration with the pending history replayed must be
  // exactly the target's declaration; anything else is an undeclared change.
  const operations = pending.flatMap(m => m.operations)
  if (!sameDeclaration(replayForward(name, prior.manifest.tables, operations), target.manifest.tables))
    refuse('Unsupported destructive or undeclared schema change')
  // #437: an upgrade may withdraw grants (narrowing access is always safe to
  // apply) but never add or widen one on a Table the app already had; those
  // still need a reviewed install. #651: a renamed Table's grants follow it,
  // a dropped Table's grants end with it (a Table later given its name does
  // not inherit them), and a Table the upgrade adds arrives with exactly the
  // grants this version declares for it, listed in the preview.
  const { added, follow } = tableFates(prior.manifest.tables.map(t => t.name), operations)
  const priorGrants = prior.manifest.permissions.map(p => ({ prior: p, now: follow(p.table) === undefined ? null : { ...p, table: follow(p.table)! } }))
  const held = new Set(priorGrants.flatMap(g => g.now ? [canonical(g.now)] : []))
  if (!target.manifest.permissions.every((p) => added.has(p.table) || held.has(canonical(p))) || prior.app.runtime_manifest == null ||
      (prior.app.runtime_manifest as { packageName: string }).packageName !== (target.app.runtime_manifest as { packageName: string }).packageName)
    refuse('Permission or package identity changes are unsupported')
  const kept = new Set(target.manifest.permissions.map(canonical))
  const withdrawn = priorGrants.filter(g => !g.now || !kept.has(canonical(g.now))).map(g => g.prior)
  const granted = target.manifest.permissions.filter(p => added.has(p.table))
  const destructive = operations.some(op => 'destructive' in op && op.destructive === true)
  const plan = { name, currentVersion: prior.version, targetVersion: target.version,
    currentArtifact: prior.digest, targetArtifact: target.digest, enabled: row.enabled,
    migrations: pending.map(m => ({ id: m.id, checksum: checksum(m), operations: m.operations })),
    tables: [...new Set(operations.flatMap(op => op.kind === 'renameTable' ? [op.from, op.to] : [typeof op.table === 'string' ? op.table : op.table.name]))],
    permissions: [...withdrawn.map((p) => ({ withdraw: p })), ...granted.map((p) => ({ grant: p }))], jobs: [], indexes: [], destructive,
    dataEffects: destructive ? 'Destructive: the steps under losses remove data; every other row is unchanged' : 'Existing rows unchanged; added columns are NULL unless backfilled',
    codeOnly: operations.length === 0 }
  // What this instance would lose: the steps run in a rolled-back
  // transaction, so a step the upgrade would refuse here (an unmarked
  // narrowing that rows still use, a required column left empty) is refused
  // now. Kept outside the plan's identity: rows written between preview and
  // apply must not make the review stale. Applying runs the steps for real
  // in its own transaction, so it does not count them first.
  const losses = preview ? await countLosses(name, pending, { ownsClient: typeof target.manifest.client === 'string' }) : []
  return { row, target, prior, pending, ledger, withdrawn, granted,
    plan: { ...plan, planId: checksum(plan), losses: losses.map(describeLoss) } }
}

// #651: where an upgrade's operations take the app's Tables, by identity,
// not by name: each installed Table ends under its final name, or is dropped
// (undefined); the names that end up holding a Table this upgrade added.
// A Table that is not the app's own keeps its name.
function tableFates(installed: string[], operations: Operation[]) {
  // Name held now -> the installed Table it is, or null when this upgrade added it.
  const holds = new Map<string, string | null>(installed.map(name => [name, name]))
  for (const op of operations) {
    if (op.kind === 'addTable') holds.set(op.table.name, null)
    if (op.kind === 'dropTable') holds.delete(op.table.name)
    if (op.kind === 'renameTable') {
      holds.set(op.to, holds.get(op.from) ?? null)
      holds.delete(op.from)
    }
  }
  const finalName = new Map([...holds].flatMap(([name, origin]) => origin === null ? [] : [[origin, name] as const]))
  return { added: new Set([...holds].flatMap(([name, origin]) => origin === null ? [name] : [])),
    follow: (table: string) => installed.includes(table) ? finalName.get(table) : table }
}

// Exclusive: the preview runs the steps (and their DDL) to count what they remove.
export function previewAppUpgrade(name: string, version: string) {
  return appOperation(async () => (await upgradePlan(name, version)).plan, true)
}

export function upgradeApp(name: string, version: string, planId: string, actor = 'Administrator') {
  return appOperation(async () => {
    const [done] = await sql`select * from installed_app where name = ${name}`
    if (done?.package_version === version && done.upgrade_plan === planId) {
      const target = await verifyArtifact(artifacts.get(`${name}@${version}`))
      if (!matchesInstalled(target, done)) refuse('Restore the exact committed artifact before retrying')
      return { name, version, activationPending: done.activation_pending }
    }
    const prepared = await upgradePlan(name, version, false)
    if (prepared.plan.planId !== planId) throw new AppError('ConflictError', 'Upgrade plan is stale; preview and review again')
    if (prepared.row.enabled) await assertOnlyScopeProvider(prepared.target)
    try {
      // Provisioning: the app's Tables answer the engine while it rebuilds
      // them, enabled or not. Everything below is one transaction.
      await withTransaction(() => provisionApp(name, async () => {
        // Only the grants this app owns: an adopted, pre-existing grant stays.
        // Withdrawn first, under the names the Tables have before any rename.
        for (const p of prepared.withdrawn) {
          const gone = await sql`
            delete from permission
            where owner_app = ${name} and ref_table = ${p.table} and role = ${p.role} and tier = ${p.tier ?? 'basic'}
            returning row_id`
          for (const g of gone) {
            await sql`update installed_app set perms = perms - ${String(g.row_id)} where name = ${name}`
            await logActivity(actor, `app_grant_withdrawn ${name}@${version}: ${p.role} on ${p.table} (${p.tier ?? 'basic'}, ${String(g.row_id)})`.slice(0, 140))
          }
        }
        const losses = await applyMigrations(prepared.pending, name, actor, { ownsClient: typeof prepared.target.manifest.client === 'string' })
        // Counts only, never values: what each destructive step removed.
        for (const loss of losses)
          await logActivity(actor, `app_data_removed ${name}@${version}: ${describeLoss(loss)}`.slice(0, 140))
        if (prepared.granted.length) {
          const created = await provisionGrants({ name, roles: prepared.target.manifest.roles, runtime_package: true }, prepared.granted)
          await sql`update installed_app set roles = roles || ${sql.json(created.roles)}, perms = perms || ${sql.json(created.perms)} where name = ${name}`
          for (const p of prepared.granted)
            await logActivity(actor, `app_grant_added ${name}@${version}: ${p.role} on ${p.table} (${p.tier ?? 'basic'})`.slice(0, 140))
        }
        await sql`update installed_app set package_version = ${version}, artifact_digest = ${prepared.target.digest},
          manifest = ${sql.json(prepared.target.app.runtime_manifest as never)},
          migration_ledger = ${sql.json(prepared.ledger)}, activation_pending = true,
          previous_artifact = ${sql.json({ version: prepared.prior.version, digest: prepared.prior.digest })},
          upgrade_plan = ${planId} where name = ${name}`
        await syncAppGlossary(name, prepared.target.manifest.glossary, actor)
      }))
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
    const target = await verifyArtifact(artifacts.get(`${name}@${version}`))
    if (!matchesInstalled(target, row)) refuse('Restore the exact committed artifact before activation')
    if (row.enabled) await assertOnlyScopeProvider(target)
    selectPackage(target)
    await sql`update installed_app set activation_pending = false where name = ${name}`
    await loadInstalledApps()
    return { name, version, enabled: row.enabled, activationPending: false }
  }, true)
}

/** #651: for each installed app (`name`, `package_version`,
 *  `migration_ledger` rows), the newest version on `paths` newer than the one
 *  installed, as boot would take it, and the migrations upgrading to it runs. */
export async function shippedUpgrades(installed: Record<string, unknown>[], paths: string[]) {
  const shipped = [...(await loadArtifacts(paths)).loaded.values()]
  return installed.flatMap((row) => {
    const newest = shipped.filter(pkg => pkg.name === row.name && compareVersions(pkg.version, String(row.package_version)) > 0)
      .sort((a, b) => compareVersions(b.version, a.version))[0]
    if (!newest) return []
    return [{ name: String(row.name), from: String(row.package_version), to: newest.version,
      ownsClient: typeof newest.manifest.client === 'string',
      migrations: newest.manifest.migrations.slice((row.migration_ledger as unknown[]).length) }]
  })
}

const removesData = (loss: Loss) => (loss.rows ?? 0) + (loss.childRows ?? 0) + (loss.values ?? 0) > 0

/** #651: the release guard's line for one shipped upgrade that would remove
 *  data on this instance, counted before anything runs; null when it removes
 *  none. Counts only, never values. */
export async function upgradeLossWarning(upgrade: Awaited<ReturnType<typeof shippedUpgrades>>[number]): Promise<string | null> {
  let losses: Loss[]
  try {
    losses = (await countLosses(upgrade.name, upgrade.migrations, { ownsClient: upgrade.ownsClient })).filter(removesData)
  } catch (error) {
    return `WARNING: upgrading app ${upgrade.name} from ${upgrade.from} to ${upgrade.to} would fail here: ${(error as Error).message}`
  }
  return losses.length
    ? `WARNING: upgrading app ${upgrade.name} from ${upgrade.from} to ${upgrade.to} removes data here: ${losses.map(describeLoss).join('; ')}`
    : null
}

/** #651 (`cli migrate:rehearse`): run each shipped app upgrade inside the
 *  caller's rolled-back transaction, one savepoint per app, and say what each
 *  removed, or why it would fail. Counts only, never values. */
export async function rehearseAppUpgrades(paths: string[]): Promise<string[]> {
  const installed = await sql`select name, package_version, migration_ledger from installed_app
    where runtime_package and package_version is not null order by name`
  const lines: string[] = []
  for (const upgrade of await shippedUpgrades(installed, paths)) {
    const label = `app ${upgrade.name} ${upgrade.from} to ${upgrade.to}`
    try {
      const losses = (await sql.begin(() => provisionApp(upgrade.name, () =>
        applyMigrations(upgrade.migrations, upgrade.name, 'Administrator', { ownsClient: upgrade.ownsClient })))).filter(removesData)
      lines.push(`${label}: rehearsed; ${losses.length ? `it removes ${losses.map(describeLoss).join('; ')}` : 'it removes no data'}`)
    } catch (error) {
      lines.push(`${label}: the upgrade would fail: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return lines
}

/** #667: an installed app's declared datasets, or undefined when no such app
 *  is installed. */
export async function installedAppDatasets(name: string) {
  const [row] = await sql`select 1 from installed_app where name = ${name} and runtime_package`
  const pkg = packages.get(name)
  return row && pkg ? pkg.manifest.datasets ?? [] : undefined
}

/** A discovered app package's title, for an address that opens it (#488). */
export function packageTitle(name: string): string | undefined {
  return packages.get(name)?.title
}

/** The Table that opens an app (its catalog gate), for a loaded package. */
export function appEntryTable(name: string): string | undefined {
  return packages.get(name)?.entryTable
}

export async function appCatalog(user: string) {
  const installed = await listInstalledApps()
  const result = []
  for (const item of installed) {
    const pkg = packages.get(item.name)
    // Its installation declares pages of its own (#659's classification), and
    // this process holds them to serve.
    if (item.active && item.ownPages && pkg?.clientRoot && await hasPermission(user, pkg.entryTable, 'read'))
      result.push({
        name: pkg.name, title: pkg.title, href: appHref(pkg.name),
        ...(pkg.manifest.tabs && { tabs: appTabLinks(appHref(pkg.name), pkg.manifest.tabs.items) }),
      })
  }
  return result
}

/** #642 (E8): an app's controls for the shared top bar, each picker with its
 *  options: the answer of the app's own read, run for `user` under their own
 *  scope, as the serving version (the platform draws the bar, not the app's
 *  client, so there is no client version to name). */
export async function appBar(name: string, user: string) {
  // The bar is drawn on the app's own pages: the same gate as serving them.
  // The request holds no lifecycle lock (index.ts), so the check takes its
  // own; each read below takes it again only while it authorizes.
  const pkg = await appOperation(async () => {
    if (!(await appCatalog(user)).some((entry) => entry.name === name))
      throw new AppError('NotFoundError', 'App is unavailable')
    return packages.get(name)!
  })
  const controls = []
  for (const { picker, options, sets } of pkg.manifest.bar ?? []) {
    let result: unknown
    try {
      ({ result } = await withAppIdentity(name, pkg.version, () => runPackageRead(name, options, { payload: {} }, user)) as { result: unknown })
    } catch (error) {
      // A person the read refuses (no role for it, no places) has nothing to
      // choose; the read has already logged the refusal.
      if (!(error instanceof AppError && error.type === 'PermissionError')) throw error
      result = []
    }
    const parsed = barOptions.safeParse(result)
    if (!parsed.success)
      throw new AppError('InternalError', `App ${name}'s read ${options} answered options the bar cannot show: it must answer a list of { value, label }, both text`)
    controls.push({ picker, sets, options: parsed.data })
  }
  return { controls }
}

export async function appAsset(name: string, asset: string, user: string, clientNavigation = false) {
  const catalog = await appCatalog(user)
  if (!catalog.some((entry) => entry.name === name))
    throw new AppError('NotFoundError', 'App is unavailable')
  const pkg = packages.get(name)!
  try {
    let file: string
    try {
      file = await contained(pkg.clientRoot!, asset || 'index.html')
      if (!(await stat(file)).isFile()) throw new Error('Not a file')
    } catch (error) {
      if (!clientNavigation || !asset || asset.includes('.')) throw error
      file = await contained(pkg.clientRoot!, 'index.html')
    }
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
    const clientEntry = file === await contained(pkg.clientRoot!, 'index.html')
    return { file, bytes: await readFile(file), catalog, clientEntry, frameOrigins: pkg.manifest.frameOrigins ?? [] }
  } catch {
    throw new AppError('NotFoundError', 'App asset not found')
  }
}
