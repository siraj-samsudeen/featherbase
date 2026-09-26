import { z } from 'zod'
import type { ActionRow, RuntimeActionContext, RuntimeActionHandler, RuntimeReadHandler } from 'shared'
import { sql } from './db'
import { appOperation, assertAppAvailable } from './app-lifecycle'
import { canonicalJson, recordAppAccessRefusal, withAppAuthorization, type DeclaredAppOperation } from './app-access'
import { AppError } from './errors'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { assertUserPermissions, deleteDoc, getDoc, saveDoc } from './document'
import { documentActivity, retainedDocumentCounts } from './document-activity'
import { getList } from './query'

export interface DeclaredOperations<H = RuntimeActionHandler> {
  entryTable: string
  tables: string[]
  handlers: Map<string, H>
  operations: Map<string, DeclaredAppOperation>
}

const requestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  payload: z.unknown().refine(value => value !== undefined, 'payload is required'),
}).strict()

function reject(message: string, fields?: Record<string, string>): never {
  throw new AppError('ValidationError', message, fields)
}

function callerDocuments(app: string, allowed: string[], user: string) {
  let open = true
  let pending: Promise<unknown> | undefined
  let failure: unknown
  async function operation<T>(fn: () => Promise<T>): Promise<T> {
    if (!open || pending) {
      failure = new AppError('ValidationError', 'Action document helpers must be awaited sequentially inside the handler')
      throw failure
    }
    const work = fn()
    pending = work
    try {
      const value = await work
      return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
    }
    catch (error) { failure = error; throw error }
    finally { pending = undefined }
  }
  async function metaFor(table: string, appendComment = false) {
    if (!allowed.includes(table)) reject(`Action has not declared Table ${table}`)
    const meta = await getMeta(table)
    // No generic privilege-bearing platform rows. Comment is the only v1
    // shared system relation; its target is separately authorized below.
    if ((meta.system && !(table === 'Comment' && appendComment)) || meta.data_source || meta.kind !== 'table'
      || meta.columns.some(column => column.column_type === 'Sub-table'))
      reject(`Table ${table} is not supported by transactional actions`)
    if (meta.owner_app && meta.owner_app !== app) reject('Actions cannot access another application’s owned Tables')
    return meta
  }
  async function locked(table: string, rowId: string) {
    const meta = await metaFor(table)
    if (typeof rowId !== 'string' || !rowId) reject('A row ID is required')
    await sql`select 1 from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${rowId} for update`
    return getDoc(table, rowId, user)
  }
  async function state(table: string, rowId: string) {
    await locked(table, rowId)
    return retainedDocumentCounts(sql, table, rowId)
  }
  async function save(table: string, values: ActionRow, insert: boolean) {
    const meta = await metaFor(table, insert)
    if (!values || typeof values !== 'object' || Array.isArray(values)) reject('Expected row values')
    if (!insert) {
      if (typeof values.row_id !== 'string' || values.updated_at == null) reject('Update requires row_id and updated_at')
      await locked(table, values.row_id)
    }
    if (table === 'Comment') {
      if (typeof values.ref_table !== 'string' || typeof values.ref_name !== 'string') reject('Comment requires its document target')
      await locked(values.ref_table, values.ref_name)
    }
    const saved = await saveDoc(table, values, user, insert ? 'insert' : 'upsert')
    // Recheck the finalized row, including defaults and trusted validation
    // hooks, rather than trusting only the incoming payload's references.
    await assertUserPermissions(user, meta, saved)
    for (const column of meta.columns) {
      // Comment's Table pointer is authorized through its concrete target,
      // not by granting callers broad access to platform Table metadata.
      if (table === 'Comment' && column.column_name === 'ref_table') continue
      const value = saved[column.column_name]
      if (column.column_type === 'Reference' && column.reference_table && value != null && value !== '')
        await getDoc(column.reference_table, String(value), user)
    }
    return getDoc(table, String(saved.row_id), user)
  }
  const documents: RuntimeActionContext['documents'] = Object.freeze({
    get: (table, id) => operation(() => locked(table, id)),
    list: (table, args = {}) => operation(async () => {
      await metaFor(table)
      if (args.filters?.some(([, operator]) => operator === 'related')) reject('Action lists do not support cross-table related filters')
      return (await getList(table, args, user)).data
    }),
    create: (table, values) => operation(() => save(table, values, true)),
    update: (table, values) => operation(() => save(table, values, false)),
    activity: (table, id) => operation(async () => { await locked(table, id); return documentActivity(table, id, user) }),
    deletionState: (table, id) => operation(() => state(table, id)),
    delete: (table, id, updatedAt) => operation(async () => {
      if ((await metaFor(table)).owner_app !== app) reject('Actions may delete only their owned rows')
      await locked(table, id)
      if (typeof updatedAt !== 'string') reject('Delete requires updatedAt')
      await deleteDoc(table, id, user, { expectUpdatedAt: updatedAt })
    }),
  })
  return { documents, async close() {
    open = false
    if (pending) {
      await pending.catch(() => {})
      failure ??= new AppError('ValidationError', 'Action returned without awaiting its document operation')
    }
    if (failure) throw failure
  } }
}

export function executeRuntimeAction(app: string, name: string, input: unknown, user: string, declaration: () => DeclaredOperations | undefined) {
  return appOperation(async () => {
    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) reject('Expected { idempotencyKey, payload }')
    if (!user || user === 'Guest') throw new AppError('AuthenticationError', 'Sign in to run an application action')
    try { await assertAppAvailable(`${app}.__action`, true) }
    catch (error) {
      if (error instanceof AppError && error.type === 'PermissionError') return recordAppAccessRefusal(user, app, name, 'permission')
      throw error
    }
    const contribution = declaration()
    const handler = contribution?.handlers.get(name)
    if (!contribution || !handler) throw new AppError('NotFoundError', 'Application action is undeclared or unavailable')
    const { idempotencyKey, payload } = parsed.data
    return withAppAuthorization({ app, operation: name, kind: 'action', user, payload, idempotencyKey,
      entryTable: contribution.entryTable, contribution: contribution.operations.get(name),
      loadReplay: async normalized => {
        const [previous] = await sql`select payload, "authorization" from runtime_action_result
          where caller = ${user} and app = ${app} and action = ${name} and idempotency_key = ${idempotencyKey}`
        if (previous && previous.payload !== canonicalJson(normalized)) throw new AppError('ConflictError', 'Idempotency key was already used with a different payload')
        return previous ? { authorization: previous.authorization } : undefined
      },
    }, async (authorization, normalized, metadata, replay) => {
      if (replay) {
        const [previous] = await sql`select result from runtime_action_result
          where caller = ${user} and app = ${app} and action = ${name} and idempotency_key = ${idempotencyKey}`
        return { result: previous.result }
      }
      const context = callerDocuments(app, contribution.tables, user)
      let result: unknown
      try { result = await handler(Object.freeze({ user, payload: normalized, authorization, documents: context.documents, reject })) }
      finally { await context.close() }
      const json = canonicalJson(result)
      await sql`insert into runtime_action_result (caller, app, action, idempotency_key, payload, result, "authorization")
        values (${user}, ${app}, ${name}, ${idempotencyKey}, ${canonicalJson(normalized)}, ${sql.json(JSON.parse(json))}, ${sql.json(JSON.parse(JSON.stringify(metadata)))})`
      return { result: JSON.parse(json) as unknown }
    })
  })
}

export function executeRuntimeRead(app: string, name: string, input: unknown, user: string,
  declaration: () => DeclaredOperations<RuntimeReadHandler> | undefined, discovery = false) {
  return appOperation(async () => {
    const parsed = requestSchema.omit({ idempotencyKey: true }).safeParse(input)
    if (!discovery && !parsed.success) reject('Expected { payload }')
    const contribution = declaration()
    const handler = contribution?.handlers.get(name)
    if (!contribution || !handler) return recordAppAccessRefusal(user, app, name, 'configuration')
    return withAppAuthorization({ app, operation: name, kind: discovery ? 'discovery' : 'read', user,
      payload: parsed.success ? parsed.data.payload : undefined, entryTable: contribution.entryTable,
      contribution: contribution.operations.get(name),
    }, async (authorization, payload) => {
      if (discovery) return { storeCodes: authorization.storeCodes }
      const context = callerDocuments(app, contribution.tables, user)
      const { get, list, activity } = context.documents
      try {
        const result = await handler(Object.freeze({ user, payload, authorization, reject, documents: Object.freeze({ get, list, activity }) }))
        return { result: JSON.parse(canonicalJson(result)) as unknown }
      } finally { await context.close() }
    })
  })
}
