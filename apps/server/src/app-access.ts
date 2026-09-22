import { z } from 'zod'
import type { AppAuthorizationContext, AppFactDeclaration, AppOperationDeclaration, AppProductAuthorizer, AppScopeFacts, AppScopeResolver, RuntimeActionAuthorization } from 'shared'
import { sql, withTransaction } from './db'
import { appOperation, assertAppAvailable } from './app-lifecycle'
import { actionTransaction } from './action-transaction'
import { assertPermission, getRoles, getUserPermissionMap } from './permissions'
import { getMeta } from './meta'
import { tableRelation, type TableDef } from './table-engine'
import { AppError } from './errors'
import { logAccess } from './audit'

const name = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const text = z.string().min(1).refine(s => s.trim().length > 0)
const distinct = (values: string[]) => new Set(values).size === values.length
const facts = z.array(z.object({ table: text, columns: z.array(text).min(1).refine(distinct) }).strict())
  .refine(rows => distinct(rows.map(row => row.table)))
const product = z.discriminatedUnion('kind', [z.object({ kind: z.literal('generic') }).strict(),
  z.object({ kind: z.literal('product'), name, facts }).strict()])
const scope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('request') }).strict(),
  z.object({ kind: z.literal('resolver'), name, facts }).strict()])
const storePolicy = z.object({ kind: z.literal('stores'), storeTable: text,
  readRoles: z.array(text).refine(distinct), actionRoles: z.array(text).refine(distinct),
}).strict().refine(p => p.readRoles.length + p.actionRoles.length > 0)
// @spec declared_app_actions_fail_closed
const operationSchema = z.union([
  z.object({ policy: z.object({ kind: z.literal('table') }).strict(), authorization: product }).strict(),
  z.object({ policy: storePolicy, scope, authorization: product, discoverStoreAccess: z.literal(true).optional() }).strict(),
])
export const readDeclaration = z.object({ version: z.literal(1), tables: z.array(text).refine(distinct),
  operations: z.record(name, operationSchema).refine(o => Object.keys(o).length > 0),
}).strict()
export const actionDeclaration = z.union([
  z.object({ version: z.literal(1), names: z.array(name).min(1).refine(distinct), tables: z.array(text).min(1).refine(distinct) }).strict(),
  readDeclaration.extend({ version: z.literal(2) }).refine(d => Object.values(d.operations).every(o =>
    !('discoverStoreAccess' in o) && (o.authorization.kind !== 'product' || ('scope' in o && o.scope.kind === 'resolver')))),
])

export interface DeclaredAppOperation {
  declaration: AppOperationDeclaration
  resolver?: AppScopeResolver
  authorizer?: AppProductAuthorizer
}

// Validation uses the artifact's owned Table definitions, before they exist in DB.
export function validateOperationFacts(operation: AppOperationDeclaration, tables: TableDef[]) {
  const owned = (table: string) => {
    const def = tables.find(t => t.name === table)
    if (!def || def.system || def.data_source || (def.kind && def.kind !== 'table')) throw new Error('Authorization dimensions and facts require owned local Tables')
    return def
  }
  if (operation.policy.kind === 'stores') owned(operation.policy.storeTable)
  for (const source of [('scope' in operation && operation.scope.kind === 'resolver') ? operation.scope : undefined,
    operation.authorization.kind === 'product' ? operation.authorization : undefined]) {
    for (const declaration of source?.facts ?? []) {
      const table = owned(declaration.table)
      for (const column of declaration.columns)
        if (!table.columns.some(c => c.column_name === column && !['Sub-table', 'Section Break', 'Column Break'].includes(c.column_type))) throw new Error('Authorization fact column is missing or unsupported')
    }
  }
}

class AccessRefusal extends AppError {
  constructor(readonly reason: string) { super('PermissionError', 'Application access refused') }
}
export function refuseAppAccess(reason = 'scope'): never { throw new AccessRefusal(reason) }

export async function recordAppAccessRefusal(user: string, app: string, operation: string, reason: string): Promise<never> {
  const boundedName = (value: string) => name.safeParse(value).success ? value : 'unknown'
  await logAccess(user, 'app_access_denied', { method: `${boundedName(app)}.${boundedName(operation)}:${reason}` })
  throw new AppError('PermissionError', 'Application access refused')
}

export function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  throw new AppError('ValidationError', 'Expected JSON values')
}
function codes(value: unknown): string[] {
  const parsed = z.array(text).min(1).safeParse(value)
  if (!parsed.success) refuseAppAccess()
  return [...new Set(parsed.data)].sort()
}

interface AccessRequest {
  app: string
  operation: string
  kind: 'read' | 'action' | 'discovery'
  user: string
  entryTable: string
  contribution: DeclaredAppOperation | undefined
  payload: unknown
  idempotencyKey?: string
  loadReplay?: (payload: unknown) => Promise<{ authorization: unknown } | undefined>
}

// @spec fresh_app_store_access
async function currentAccess(request: AccessRequest, declaration: AppOperationDeclaration): Promise<Set<string>> {
  const { user, app, entryTable, kind } = request
  const [enabled] = await sql`select enabled from "user" where row_id = ${user}`
  if (!user || user === 'Guest' || !enabled?.enabled) refuseAppAccess('user')
  await assertAppAvailable(`${app}.__access`)
  await assertPermission(user, entryTable, 'read')
  const policy = declaration.policy
  if (policy.kind === 'table') return new Set()
  const dimension = await getMeta(policy.storeTable).catch(() => refuseAppAccess('configuration'))
  if (dimension.owner_app !== app || dimension.system || dimension.data_source || dimension.kind !== 'table') refuseAppAccess('configuration')
  const roles = await getRoles(user)
  if (!(kind === 'action' ? policy.actionRoles : policy.readRoles).some(role => roles.includes(role))) refuseAppAccess('role')
  return (await getUserPermissionMap(user)).get(policy.storeTable) ?? new Set()
}
function subset(requested: readonly string[], allowed: Set<string>) {
  if (requested.some(code => !allowed.has(code))) refuseAppAccess()
}

// A separate capability from documents: only declared authorization columns,
// under locks that survive callback completion until the outer transaction ends.
// @spec authoritative_object_store_scope
async function withFacts<T>(app: string, declarations: AppFactDeclaration[], fn: (facts: AppScopeFacts) => Promise<T>): Promise<T> {
  let open = true
  let pending: Promise<unknown> | undefined
  let failed = false
  const facts: AppScopeFacts = Object.freeze({ async get(table: string, rowId: string) {
    if (!open || pending) { failed = true; refuseAppAccess('facts') }
    const work = (async () => {
      const declaration = declarations.find(d => d.table === table)
      if (!declaration || typeof rowId !== 'string' || !rowId) refuseAppAccess('facts')
      const meta = await getMeta(table)
      if (meta.owner_app !== app || meta.system || meta.data_source || meta.kind !== 'table') refuseAppAccess('facts')
      const [row] = await sql`select ${sql([...new Set([meta.row_key, ...declaration.columns])])}
        from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${rowId} for update`
      if (!row) refuseAppAccess()
      return freezeJson(JSON.parse(JSON.stringify(row))) as Readonly<Record<string, unknown>>
    })()
    pending = work
    try { return await work } catch (error) { failed = true; throw error } finally { pending = undefined }
  } })
  try { return await fn(facts) }
  finally {
    open = false
    if (pending) { failed = true; await pending.catch(() => {}) }
    if (failed) refuseAppAccess('facts')
  }
}

const replaySchema = z.object({ version: z.literal(1), policy: z.enum(['table', 'stores']),
  storeTable: text.optional(), storeCodes: z.array(text), productScope: z.unknown().optional(),
}).strict()

// A context is valid only inside this callback and transaction. Never accept a
// client context or keep this decision for another request.
export function withAppAuthorization<T>(request: AccessRequest,
  handler: (authorization: AppAuthorizationContext, payload: unknown, metadata: RuntimeActionAuthorization, replay: boolean) => Promise<T>): Promise<T> {
  return appOperation(async () => {
    try {
      return await (request.kind === 'action' ? actionTransaction : withTransaction)(async () => {
        const contribution = request.contribution
        if (!contribution) refuseAppAccess('configuration')
        const { declaration, resolver, authorizer } = contribution
        const policy = declaration.policy
        if ('scope' in declaration && declaration.scope.kind === 'resolver' && !resolver) refuseAppAccess('configuration')
        if (declaration.authorization.kind === 'product' && !authorizer) refuseAppAccess('configuration')
        if (request.idempotencyKey) await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([request.user, request.app, request.operation, request.idempotencyKey])}, 296))`
        const allowed = await currentAccess(request, declaration)
        // @spec self_store_access_discovery
        if (request.kind === 'discovery') {
          if (!('discoverStoreAccess' in declaration) || !declaration.discoverStoreAccess || policy.kind !== 'stores') refuseAppAccess('configuration')
          const storeCodes = [...allowed].sort()
          return handler(freezeJson({ app: request.app, operation: request.operation, user: request.user, policy: 'stores', storeCodes }), undefined,
            { version: 1, policy: 'stores', storeTable: policy.storeTable, storeCodes }, false)
        }
        let payload = request.payload
        let requested: readonly string[] | undefined
        if (policy.kind === 'stores') {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('scope' in declaration)) refuseAppAccess()
          const raw = (payload as Record<string, unknown>).storeCodes
          if (raw !== undefined) requested = freezeJson(codes(raw))
          if (!requested && declaration.scope.kind === 'request') refuseAppAccess()
          if (requested) subset(requested, allowed)
          payload = { ...payload, ...(requested ? { storeCodes: requested } : {}) }
        }
        payload = freezeJson(JSON.parse(canonicalJson(payload)))
        const previous = await request.loadReplay?.(payload)
        let metadata: RuntimeActionAuthorization
        if (previous) {
          // @spec action_writes_and_replay_are_atomic
          if (previous.authorization === null && policy.kind === 'table' && declaration.authorization.kind === 'generic')
            metadata = { version: 1, policy: 'table', storeCodes: [] }
          else {
            const parsed = replaySchema.safeParse(previous.authorization)
            if (!parsed.success || parsed.data.policy !== policy.kind) refuseAppAccess('replay')
            metadata = parsed.data
            if (policy.kind === 'stores') {
              if (metadata.storeTable !== policy.storeTable) refuseAppAccess('replay')
              metadata.storeCodes = codes(metadata.storeCodes)
            } else if (metadata.storeTable || metadata.storeCodes.length) refuseAppAccess('replay')
          }
        } else {
          let resolved = { storeCodes: requested ?? [] } as { storeCodes: readonly string[]; productScope?: unknown }
          if ('scope' in declaration && declaration.scope.kind === 'resolver') {
            resolved = await withFacts(request.app, declaration.scope.facts, async facts =>
              resolver!(Object.freeze({ user: request.user, payload, requestedStoreCodes: requested, facts, reject: () => refuseAppAccess('scope') })))
          }
          const storeCodes = policy.kind === 'stores' ? codes(resolved?.storeCodes) : []
          if (requested && JSON.stringify(requested) !== JSON.stringify(storeCodes)) refuseAppAccess()
          metadata = { version: 1, policy: policy.kind, ...(policy.kind === 'stores' ? { storeTable: policy.storeTable } : {}),
            storeCodes, ...(resolved.productScope !== undefined ? { productScope: JSON.parse(canonicalJson(resolved.productScope)) } : {}) }
        }
        if (policy.kind === 'stores') subset(metadata.storeCodes, await currentAccess(request, declaration))
        const authorization = freezeJson({ app: request.app, operation: request.operation, user: request.user, policy: policy.kind,
          storeCodes: metadata.storeCodes, ...(metadata.productScope !== undefined ? { productScope: metadata.productScope } : {}) })
        // @spec declared_product_gate_composes
        if (declaration.authorization.kind === 'product') {
          if (request.kind === 'action' && metadata.productScope === undefined) refuseAppAccess('product')
          const approved = await withFacts(request.app, declaration.authorization.facts, async facts =>
            authorizer!(Object.freeze({ authorization, payload, facts, reject: () => refuseAppAccess('product') })))
          if (approved !== true) refuseAppAccess('product')
        }
        // Final barrier after every possible authorization-fact lock wait.
        const final = await currentAccess(request, declaration)
        if (policy.kind === 'stores') subset(metadata.storeCodes, final)
        return handler(authorization, payload, freezeJson(metadata), !!previous)
      })
    } catch (error) {
      // @spec app_refusals_are_auditable
      // Outside the failed business transaction so the audit survives rollback.
      if (error instanceof AccessRefusal || (error instanceof AppError && error.type === 'PermissionError')) {
        return recordAppAccessRefusal(request.user, request.app, request.operation, error instanceof AccessRefusal ? error.reason : 'permission')
      }
      throw error
    }
  })
}
