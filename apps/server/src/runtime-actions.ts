import { z } from 'zod'
import type { ActionRow, RuntimeActionContext, RuntimeActionHandler } from 'shared'
import { sql } from './db'
import { appOperation, assertAppAvailable } from './app-lifecycle'
import { actionTransaction } from './action-transaction'
import { AppError } from './errors'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { assertDocPermission, assertPermission } from './permissions'
import { assertUserPermissions, deleteDoc, getDoc, saveDoc } from './document'
import { documentActivity } from './document-activity'
import { getList } from './query'

export const actionDeclaration = z.object({
  version: z.literal(1),
  names: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).min(1),
  tables: z.array(z.string().min(1)).min(1),
}).strict()

export interface DeclaredActions {
  entryTable: string
  tables: string[]
  handlers: Map<string, RuntimeActionHandler>
}

const requestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  payload: z.unknown().refine(value => value !== undefined, 'payload is required'),
}).strict()

function reject(message: string, fields?: Record<string, string>): never {
  throw new AppError('ValidationError', message, fields)
}

// Canonical JSON preserves array order and sorts object keys; malformed result
// types fail before commit rather than producing an unreplayable response.
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as ActionRow)[key])}`).join(',')}}`
  return reject('Action payload and result must be JSON values')
}

// @spec action_helpers_preserve_caller_authority
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
  async function metaFor(table: string) {
    if (!allowed.includes(table)) reject(`Action has not declared Table ${table}`)
    const meta = await getMeta(table)
    // No generic privilege-bearing platform rows. Comment is the only v1
    // shared system relation; its target is separately authorized below.
    if ((meta.system && table !== 'Comment') || meta.data_source || meta.kind !== 'table'
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
    const [counts] = await sql`
      select (select count(*)::int from comment where ref_table = ${table} and ref_name = ${rowId}) as comments,
             (select count(*)::int from version where ref_table = ${table} and ref_name = ${rowId}) as versions`
    let references = 0
    const columns = await sql`select parent, column_name from column_def where column_type = 'Reference' and reference_table = ${table}`
    for (const column of columns) {
      const meta = await getMeta(String(column.parent))
      if (meta.data_source || meta.kind === 'settings') reject('Deletion cannot prove references from nonlocal Tables')
      const [count] = await sql`select count(*)::int as n from ${sql(await tableRelation(meta.name))} where ${sql(String(column.column_name))} = ${rowId}`
      references += Number(count.n)
    }
    return { comments: Number(counts.comments), versions: Number(counts.versions), references }
  }
  async function save(table: string, values: ActionRow, insert: boolean) {
    const meta = await metaFor(table)
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
    list: (table, args = {}) => operation(async () => { await metaFor(table); return (await getList(table, args, user)).data }),
    create: (table, values) => operation(() => save(table, values, true)),
    update: (table, values) => operation(() => save(table, values, false)),
    activity: (table, id) => operation(async () => { await locked(table, id); return documentActivity(table, id, user) }),
    deletionState: (table, id) => operation(() => state(table, id)),
    // @spec guarded_action_deletion_preserves_retained_work
    delete: (table, id, updatedAt) => operation(async () => {
      if (table === 'Comment') reject('Actions cannot delete discussion')
      const row = await locked(table, id)
      await assertDocPermission(user, table, 'delete', String(row.created_by))
      if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) || new Date(row.updated_at as string).getTime() !== Date.parse(updatedAt))
        throw new AppError('ConflictError', `${table} ${id} has been modified after you loaded it`)
      const counts = await state(table, id)
      if (Object.values(counts).some(Boolean)) reject('This document has retained activity or references and cannot be deleted', Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, String(count)])))
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

// @spec action_writes_and_replay_are_atomic
export function executeRuntimeAction(app: string, name: string, input: unknown, user: string, declaration: () => DeclaredActions | undefined) {
  return appOperation(async () => {
    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) reject('Expected { idempotencyKey, payload }')
    if (!user || user === 'Guest') throw new AppError('AuthenticationError', 'Sign in to run an application action')
    await assertAppAvailable(`${app}.__action`)
    const contribution = declaration()
    const handler = contribution?.handlers.get(name)
    if (!contribution || !handler) throw new AppError('NotFoundError', 'Application action is undeclared or unavailable')
    await assertPermission(user, contribution.entryTable, 'read')
    const { idempotencyKey, payload } = parsed.data
    const encoded = canonical(payload)
    return actionTransaction(async () => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([user, app, name, idempotencyKey])}, 296))`
      const [previous] = await sql`select payload, result from runtime_action_result
        where caller = ${user} and app = ${app} and action = ${name} and idempotency_key = ${idempotencyKey}`
      if (previous) {
        if (previous.payload !== encoded) throw new AppError('ConflictError', 'Idempotency key was already used with a different payload')
        return { result: previous.result }
      }
      const context = callerDocuments(app, contribution.tables, user)
      let result: unknown
      try { result = await handler(Object.freeze({ user, payload, documents: context.documents, reject })) }
      finally { await context.close() }
      const json = canonical(result)
      await sql`insert into runtime_action_result (caller, app, action, idempotency_key, payload, result)
        values (${user}, ${app}, ${name}, ${idempotencyKey}, ${encoded}, ${sql.json(JSON.parse(json))})`
      return { result: JSON.parse(json) as unknown }
    })
  })
}
