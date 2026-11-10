import { randomUUID } from 'node:crypto'
import { enabledPeople, namesForApp, ownDisplayName, tableMembers } from './people-directory'
import { z } from 'zod'
import type { ActionRow, AppAuthorizationContext, RuntimeActionContext, RuntimeActionHandler, RuntimeReadContext, RuntimeReadHandler } from 'shared'
import { inAppTransaction, sql } from './db'
import { appOperation, assertAppAvailable, assertStillServing, servingIdentity } from './app-lifecycle'
import { canonicalJson, recordAppAccessRefusal, withAppAuthorization, type DeclaredAppOperation } from './app-access'
import { AppError } from './errors'
import { PLATFORM_ROLES, assertSystemManager, getRoles } from './permissions'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { assertUserPermissions, deleteDoc, getDoc, saveDoc } from './document'
import { holdBeforeRowLock } from './row-lock-order'
import { documentActivity, retainedDocumentCounts } from './document-activity'
import { getList } from './query'
import { logActivity } from './audit'
import { assertNoSecret, readyAppSetup, withSecretsKept, type AppSetup, type ReadySetup } from './app-settings'
import { callerMail, readsRow } from './runtime-mail'
import { appDatasets, recordPlaceDrops, type DatasetDeclaration, type DropProvenance, type DropVersions, type PlaceDrop } from './app-datasets'
import { baseTablesReader, proposalsReader, proposalsWriter, type BaseTablesDeclaration } from './change-proposals'

const NO_SETUP: AppSetup = { title: '', settings: Object.freeze({}), secrets: Object.freeze({}), missing: { settings: [], secrets: [] }, optionalSecrets: [] }

export interface DeclaredOperations<H = RuntimeActionHandler> {
  entryTable: string
  tables: string[]
  handlers: Map<string, H>
  operations: Map<string, DeclaredAppOperation>
  /** #620: the app's declared settings and secrets, read fresh per request. */
  setup?: () => Promise<AppSetup>
  /** #625: the app's declared cached datasets. */
  datasets?: readonly DatasetDeclaration[]
  /** #975: the instance Tables the app reads and proposes on. */
  baseTables?: BaseTablesDeclaration
}

const requestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  payload: z.unknown().refine(value => value !== undefined, 'payload is required'),
}).strict()

function reject(message: string, fields?: Record<string, string>): never {
  throw new AppError('ValidationError', message, fields)
}

/** #912: the instance Tables an administrator lists in an app's declared
 *  `linked_tables` setting. The app reads them as the caller, never writes. */
export function linkedTables(settings: Readonly<Record<string, string>>): string[] {
  try {
    const value: unknown = JSON.parse(settings.linked_tables ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
  } catch { return [] }
}

/** #912: names of people, read as the caller (the Person permission applies),
 *  except people the app's own settings name (#1097). */
function callerPeople(user: string, app: string, settings: Readonly<Record<string, string>>): RuntimeActionContext['people'] {
  return Object.freeze({
    names: (ids: string[]) => namesForApp(ids, user, settings),
    enabled: (ids: string[]) => enabledPeople(ids, user),
    // #1046: an app that gives things to roles says why someone has one.
    rolesOf: async (person: string) => {
      if (typeof person !== 'string' || !person) return Object.freeze([])
      const [live] = await sql`select 1 from person where row_id = ${person} and enabled and replaced_by is null and not coalesce(built_in, false)`
      return Object.freeze(live ? [...new Set(await getRoles(person))].filter((role) => role !== 'All').sort() : [])
    },
    roleNames: async () => Object.freeze((await sql`select row_id from role where row_id not in ${sql(PLATFORM_ROLES)} order by row_id`).map((r) => String(r.row_id))),
    waitingForAccess: async () => {
      const roles = await getRoles(user)
      // Imported when called: runtime-packages imports this module, and a static
      // import back would run it before apps.ts has defined what it needs.
      const [{ accessApprovers }, { settleAccessRequests }] = await Promise.all([import('./runtime-packages'), import('./waiting-for-access')])
      if (!roles.includes('System Manager') && !accessApprovers(app).roles.some((role) => roles.includes(role))) return Object.freeze([])
      await settleAccessRequests()
      // Their name, so an approver who can't read people still sees who is waiting; a name that is still an address isn't shown.
      const rows = await sql`select r.person, r.created_at, p.full_name from access_request r left join person p on p.row_id = r.person
        where r.app_name = ${app} and r.declined_at is null order by r.created_at, r.person`
      return Object.freeze(rows.map((r) => ({ person: String(r.person), name: r.full_name && !String(r.full_name).includes('@') ? String(r.full_name) : null,
        asked_at: new Date(r.created_at as string).toISOString() })))
    },
  })
}

// #918: the caller's own roles, so an app can let a role take a step.
async function callerRoles(user: string): Promise<readonly string[]> {
  return Object.freeze([...new Set(await getRoles(user))].sort())
}

export function callerDocuments(app: string, allowed: string[], user: string, linked: string[] = []) {
  let open = true
  const readOnly = (table: string) => !allowed.includes(table) && linked.includes(table)
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
  async function metaFor(table: string, appendComment = false, write = false) {
    if (!allowed.includes(table) && (write || !linked.includes(table))) reject(`Action has not declared Table ${table}`)
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
    // #693: the pre-row locks the later saveDoc or deleteDoc takes, first.
    await holdBeforeRowLock(sql, meta, user, { [meta.row_key]: rowId })
    await sql`select 1 from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${rowId} for update`
    return getDoc(table, rowId, user)
  }
  async function state(table: string, rowId: string) {
    await locked(table, rowId)
    return retainedDocumentCounts(sql, table, rowId)
  }
  async function save(table: string, values: ActionRow, insert: boolean) {
    const meta = await metaFor(table, insert, true)
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
    // A linked Table is read without a row lock: the app never writes it.
    get: (table, id) => operation(async () => readOnly(table) ? (await metaFor(table), getDoc(table, id, user)) : locked(table, id)),
    members: table => operation(async () => { await metaFor(table); return tableMembers(table, user) }),
    list: (table, args = {}) => operation(async () => {
      await metaFor(table)
      if (args.filters?.some(([, operator]) => operator === 'related' || operator === 'not related')) reject('Action lists do not support cross-table related filters')
      // What the caller may not read of a linked Table reads as nothing.
      if (readOnly(table)) return getList(table, args, user).then(r => r.data, (error: unknown) =>
        error instanceof AppError && error.type === 'PermissionError' ? [] : Promise.reject(error))
      return (await getList(table, args, user)).data
    }),
    create: (table, values) => operation(() => save(table, values, true)),
    update: (table, values) => operation(() => save(table, values, false)),
    activity: (table, id) => operation(async () => { await (readOnly(table) ? metaFor(table).then(() => getDoc(table, id, user)) : locked(table, id)); return documentActivity(table, id, user) }),
    deletionState: (table, id) => operation(async () => { await metaFor(table, false, true); return state(table, id) }),
    // #963: an own-rows grant follows a row's creator, which no save can set.
    // The privilege is judged here, so an app's bug cannot hand a row away for
    // an ordinary caller. Saves' validators don't run: the row's fields stay.
    handOver: (table, id, person) => operation(async () => {
      const meta = await metaFor(table, false, true)
      if (meta.owner_app !== app) reject('Actions may hand over only their owned rows')
      await assertSystemManager(user)
      if (!(await enabledPeople([person], user)).length) reject('A row is handed over only to an enabled person')
      await locked(table, id)
      await sql`update ${sql(await tableRelation(table))} set created_by = ${person}, updated_by = ${user}, updated_at = now() where ${sql(meta.row_key)} = ${id}`
    }),
    // #925: whether setReaders names the caller as a reader of this row, and
    // the row still reads for them. Never fails the handler.
    isReader: (table, id) => operation(async () => {
      await metaFor(table)
      const [shared] = await sql`select 1 from share where share_table = ${table} and share_name = ${id} and person = ${user}
        and read and not coalesce(write, false) and not coalesce(share, false) limit 1`
      return !!shared && readsRow(user, table, id)
    }),
    // #925: the people who read one row of the app's own Table besides those
    // its grants already let read it: read-only shares, replaced as a set.
    // The caller must read the row; a person who is not enabled is left out.
    setReaders: (table, id, people) => operation(async () => {
      const meta = await metaFor(table, false, true)
      if (meta.owner_app !== app) reject('Actions may set readers only on their owned rows')
      if (!Array.isArray(people) || people.some(person => typeof person !== 'string' || !person)) reject('Readers are a list of Person IDs')
      await locked(table, id)
      const asked = [...new Set(people)]
      const wanted = asked.length ? (await sql`select row_id from person where row_id in ${sql(asked)}
        and enabled and replaced_by is null and not coalesce(built_in, false)`).map(row => String(row.row_id)) : []
      const held = await sql`select row_id, person from share where share_table = ${table} and share_name = ${id}
        and person is not null and read and not coalesce(write, false) and not coalesce(share, false)`
      const gone = held.filter(row => !wanted.includes(String(row.person)))
      const added = wanted.filter(person => !held.some(row => String(row.person) === person))
      if (gone.length) await sql`delete from share where row_id in ${sql(gone.map(row => String(row.row_id)))}`
      for (const person of added)
        await sql`insert into share (row_id, share_table, share_name, person, read, write, share, created_by, updated_by)
          values (${randomUUID()}, ${table}, ${id}, ${person}, true, false, false, ${user}, ${user})`
      if (gone.length || added.length)
        await logActivity(user, `row_readers_set ${table} ${id}: +${added.length} -${gone.length}`.slice(0, 140))
    }),
    delete: (table, id, updatedAt) => operation(async () => {
      if ((await metaFor(table, false, true)).owner_app !== app) reject('Actions may delete only their owned rows')
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
    // A refusal is recorded in the access log before it is answered.
    await assertAppAvailable(`${app}.__action`, true).catch((error: unknown) =>
      error instanceof AppError && error.type === 'PermissionError'
        ? recordAppAccessRefusal(user, app, name, 'permission', error)
        : Promise.reject(error))
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
      const { settings, secrets, kept } = await readyAppSetup(app, await (contribution.setup?.() ?? NO_SETUP), contribution.operations.get(name)?.declaration.needs)
      const context = callerDocuments(app, contribution.tables, user, linkedTables(settings))
      const base = baseTablesReader(app, contribution.baseTables, linkedTables(settings))
      const proposals = proposalsWriter(app, contribution.baseTables, linkedTables(settings), user, contribution.entryTable)
      // Serialized inside the guard (Codex round 2 on #670): a getter on the
      // result is the app's code running, and may log or throw a secret.
      const json = await withSecretsKept(kept, async () => {
        try { return canonicalJson(await handler(Object.freeze({ user, userName: await ownDisplayName(user), roles: await callerRoles(user), people: callerPeople(user, app, settings), payload: normalized, authorization, settings, secrets, mail: callerMail(app, contribution.tables), documents: context.documents, baseTables: base.helper, changeProposals: proposals.helper, reject }))) }
        finally { await context.close(); await base.close(); await proposals.close() }
      })
      assertNoSecret(kept, JSON.parse(json))
      await sql`insert into runtime_action_result (caller, app, action, idempotency_key, payload, result, "authorization")
        values (${user}, ${app}, ${name}, ${idempotencyKey}, ${canonicalJson(normalized)}, ${sql.json(JSON.parse(json))}, ${sql.json(JSON.parse(JSON.stringify(metadata)))})`
      return { result: JSON.parse(json) as unknown }
    })
  })
}

export async function executeRuntimeRead(app: string, name: string, input: unknown, user: string,
  declaration: () => DeclaredOperations<RuntimeReadHandler> | undefined, discovery = false) {
  const decided = await appOperation(async () => {
    const parsed = requestSchema.omit({ idempotencyKey: true }).safeParse(input)
    if (!discovery && !parsed.success) reject('Expected { payload }')
    const contribution = declaration()
    const handler = contribution?.handlers.get(name)
    if (!contribution || !handler) return recordAppAccessRefusal(user, app, name, 'configuration')
    const outbound = !discovery && contribution.operations.get(name)?.declaration.outbound === true
    return withAppAuthorization({ app, operation: name, kind: discovery ? 'discovery' : 'read', user,
      payload: parsed.success ? parsed.data.payload : undefined, entryTable: contribution.entryTable,
      contribution: contribution.operations.get(name),
    }, async (authorization, payload, _metadata, _replay, providerKeys): Promise<{ answer: unknown; drops: PlaceDrop[] } | { outbound: Outbound }> => {
      if (discovery) return { answer: { storeCodes: authorization.storeCodes }, drops: [] }
      const setup = await readyAppSetup(app, await (contribution.setup?.() ?? NO_SETUP), contribution.operations.get(name)?.declaration.needs)
      // #667: the versions a dropped place is recorded against, decided with
      // the places, under the same lifecycle lock (Codex round 1 on #678).
      const versions = authorization.places && providerKeys ? await dropVersions(app, contribution.operations.get(name)?.scopeProvider) : undefined
      const provenance = versions && providerKeys ? { versions, providerKeys } : undefined
      // #625 (E5): an outbound read stops here. Its authorization, payload,
      // setup and the app version serving it are decided and frozen; the
      // handler runs once this transaction AND the request's lifecycle lock
      // have been released, so it holds no row lock, no transaction and no
      // lifecycle connection while it calls out.
      const inTransaction = async (step: RuntimeReadHandler) => {
        const context = callerDocuments(app, contribution.tables, user, linkedTables(setup.settings))
        const { get, list, activity, isReader } = context.documents
        const base = baseTablesReader(app, contribution.baseTables, linkedTables(setup.settings))
        const proposals = proposalsReader(app, user, contribution.entryTable)
        return runRead(app, name, user, step, contribution, { authorization, payload, setup, provenance },
          Object.freeze({ get, list, activity, isReader }), async () => { await context.close(); await base.close(); await proposals.close() }, undefined, base.helper, proposals.helper)
      }
      if (outbound) {
        // #967: the one chance to read documents before the transaction closes.
        const prepared = handler.prepare ? (await inTransaction(handler.prepare)).answer.result : undefined
        return { outbound: { handler, contribution, frozen: { authorization, payload, setup, provenance, prepared }, identity: await servingIdentity(app) } }
      }
      return await inTransaction(handler)
    })
  })
  // #667: drops are recorded once the read's transaction has committed, on
  // a transaction of their own; a read that failed never gets here.
  if ('answer' in decided) {
    await recordPlaceDrops(decided.drops)
    return decided.answer
  }
  // Outside every lock. Whatever the handler produced is written or answered
  // only if the app is still enabled and serving the version it ran under.
  const { handler, contribution, frozen, identity } = decided.outbound
  const views: (() => Promise<void>)[] = []
  const { answer, drops } = await runRead(app, name, user, handler, contribution, frozen, CLOSED_DOCUMENTS, async () => {}, (write) => views.push(write))
  // One shared lifecycle lock for the final check and the view records, so
  // the app cannot be disabled or upgraded between them.
  await assertStillServing(app, identity, async () => { for (const write of views) await write() })
  // #667: only an answer that stands records its drops, against the
  // versions it was authorized under.
  await recordPlaceDrops(drops)
  return answer
}

interface Outbound {
  handler: RuntimeReadHandler
  contribution: DeclaredOperations<RuntimeReadHandler>
  frozen: Frozen
  identity: string
}

// An outbound handler runs after its transaction has closed: a document read
// would take a row lock in a transaction that no longer exists.
function closedDocuments(): never {
  throw new AppError('ValidationError', 'This read is outbound and its transaction has closed: read documents in a read that is not outbound')
}
const CLOSED_DOCUMENTS: RuntimeReadContext['documents'] = Object.freeze({ get: closedDocuments, list: closedDocuments, activity: closedDocuments, isReader: closedDocuments })
const CLOSED_BASE_TABLES: RuntimeReadContext['baseTables'] = Object.freeze({ list: closedDocuments })
const CLOSED_PROPOSALS: RuntimeReadContext['changeProposals'] = Object.freeze({ list: closedDocuments, mayDecide: closedDocuments, routeFor: closedDocuments })

interface Frozen { authorization: AppAuthorizationContext; payload: unknown; setup: ReadySetup; provenance?: DropProvenance; prepared?: unknown }

// The app's installed version and the scope provider that answered, as they
// are while the read is authorized. No provider means no drop to name.
async function dropVersions(app: string, scopeProvider: (() => Promise<{ app: string; version: string } | undefined>) | undefined): Promise<DropVersions | undefined> {
  const provider = await scopeProvider?.()
  if (!provider) return undefined
  const [installed] = await sql`select package_version from installed_app where name = ${app}`
  return { app: String(installed?.package_version ?? ''), provider: { app: provider.app, version: provider.version } }
}

async function runRead(app: string, name: string, user: string, handler: RuntimeReadHandler, contribution: DeclaredOperations<RuntimeReadHandler>,
  { authorization, payload, setup, provenance, prepared }: Frozen,
  documents: RuntimeReadContext['documents'], close: () => Promise<void>, deferWrite?: (write: () => Promise<void>) => void,
  baseTables: RuntimeReadContext['baseTables'] = CLOSED_BASE_TABLES, changeProposals: RuntimeReadContext['changeProposals'] = CLOSED_PROPOSALS) {
  const { title, settings, secrets, kept } = setup
  const { datasets, recordView, drops } = appDatasets({ app, operation: name, user, title, declarations: contribution.datasets ?? [],
    places: authorization.places, outbound: !inAppTransaction(), deferWrite, provenance })
  const json = await withSecretsKept(kept, async () => {
    try {
      return canonicalJson(await handler(Object.freeze({ user, userName: await ownDisplayName(user), roles: await callerRoles(user), people: callerPeople(user, app, settings), payload, prepared, authorization, settings, secrets, reject, documents, baseTables, changeProposals, datasets, recordView })))
    } finally { await close() }
  })
  assertNoSecret(kept, JSON.parse(json))
  return { answer: { result: JSON.parse(json) as unknown }, drops: drops() }
}
