// #975: the first slice of #627's Change Proposal, and an app's reach into the instance's base
// Tables. An app reads and proposes on a Table only when its manifest declares it and an
// administrator lists it in the app's `linked_tables` setting, and only the declared columns.
// Reads run as the platform, as a scope provider's do, so staff need no grant on HR's data.
// Who may decide is checked here, whatever the app says, and no role bypasses it.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canRetire } from 'shared'
import type { ActionListArgs, ActionRow, ApprovalMode, ApproverRequest, BaseTablesHelper, ChangeProposal, ChangeProposalsHelper, ChangeProposalsReader, ChangeProposalState, DecisionApproval, DecisionNote, ProposalFilter, ProposalRequest, ReviewConfirmation, ReviewUndo } from 'shared'
import { anyTableLinkCount } from './any-table-link'
import { sql } from './db'
import { getDoc, retireDoc, saveDoc, saveSystemRow } from './document'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { canSignInNow } from './identities'
import { getRoles, permissionScope } from './permissions'
import { getList } from './query'
import { holdBeforeRowLock } from './row-lock-order'
import { tableRelation } from './table-engine'
import { linkTargetNames } from './views'

const name = z.string().min(1)
const distinct = (values: string[]) => new Set(values).size === values.length
export const baseTablesDeclaration = z.object({
  read: z.record(name, z.array(name).min(1).refine(distinct)).default({}),
  propose: z.record(name, z.object({
    columns: z.array(name).min(1).refine(distinct),
    /** Columns the app sets on a new row at approval, such as its identifier. */
    stamp: z.array(name).refine(distinct).default([]),
    startsOn: name,
    endsOn: name,
  }).strict()).default({}),
}).strict()
export type BaseTablesDeclaration = z.infer<typeof baseTablesDeclaration>

// #1191: the kinds of approval an app's proposals come as. Each one's mode is an Approval Type
// row; with none it is approve first. A type that grants a role or report access is approve
// first, always, whatever is stored.
export const APPROVE_FIRST: ApprovalMode = 'Approve first'
export const APPLY_NOW: ApprovalMode = 'Apply now, review after'
export const approvalTypesDeclaration = z.array(z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  title: z.string().min(1),
  grantsAccess: z.boolean().default(false),
}).strict()).refine(types => distinct(types.map(type => type.name)), 'Approval type names must be distinct')
export interface ApprovalTypeDeclaration { name: string; title: string; grantsAccess: boolean }

/** The approval types an installed app declares, as installed; null when it is not installed. */
export async function declaredApprovalTypes(app: string, tx: typeof sql = sql): Promise<ApprovalTypeDeclaration[] | null> {
  const [installed] = await tx`select manifest->'approvalTypes' as types from installed_app where name = ${app}`
  if (!installed) return null
  const types = Array.isArray(installed.types) ? installed.types as ApprovalTypeDeclaration[] : []
  return types.map(type => ({ name: type.name, title: type.title, grantsAccess: type.grantsAccess === true }))
}

/** The mode a proposal of this type is made under, and keeps. */
async function modeOf(app: string, type: unknown): Promise<ApprovalMode> {
  if (type === undefined) return APPROVE_FIRST
  const found = typeof type === 'string' ? (await declaredApprovalTypes(app))?.find(entry => entry.name === type) : undefined
  if (!found) reject(`The app has not declared the approval type ${String(type)}`)
  if (found!.grantsAccess) return APPROVE_FIRST
  const [row] = await sql`select mode from approval_type where row_id = ${`${app}.${found!.name}`} and retired_at is null`
  return row?.mode === APPLY_NOW ? APPLY_NOW : APPROVE_FIRST
}

function reject(message: string): never {
  throw new AppError('ValidationError', message)
}

/** Handlers must await helpers one at a time, as with documents: work left running past the
 *  handler's return would outlive the transaction it belongs to. */
function sequential() {
  let open = true
  let pending: Promise<unknown> | undefined
  let failure: unknown
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (!open || pending) {
        failure = new AppError('ValidationError', 'Base Table and proposal helpers must be awaited one at a time inside the handler')
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
    },
    async close() {
      open = false
      if (pending) {
        await pending.catch(() => {})
        failure ??= new AppError('ValidationError', 'A handler returned without awaiting a base Table or proposal helper')
      }
      if (failure) throw failure
    },
  }
}

/** The Table, when the app may reach it at all. */
async function reachable(app: string, table: string, declared: boolean, linked: readonly string[]): Promise<TableMeta> {
  if (!declared) reject(`The app has not declared Table ${table}`)
  const meta = await getMeta(table)
  // #1046: an app reads its own Tables as itself without the instance listing
  // them; an instance Table is read only once the instance links it.
  if (!linked.includes(table) && meta.owner_app !== app) reject(`Table ${table} is not listed in this app's linked Tables setting`)
  if (meta.system || meta.data_source || meta.kind !== 'table' || (meta.owner_app && meta.owner_app !== app)
    || meta.columns.some(column => column.column_type === 'Sub-table')) reject(`Table ${table} is not supported as a base Table`)
  return meta
}

export function baseTablesReader(app: string, declaration: BaseTablesDeclaration | undefined, linked: readonly string[]) {
  const guard = sequential()
  const helper: BaseTablesHelper = Object.freeze({
    list: (table: string, args: ActionListArgs & { fields: string[] }) => guard.run(async () => {
      const columns = declaration?.read[table]
      await reachable(app, table, !!columns, linked)
      if (!Array.isArray(args?.fields) || !args.fields.length) reject('A base Table read names its fields')
      const unknown = args.fields.find(field => field !== 'row_id' && !columns!.includes(field))
      if (unknown) reject(`The app has not declared column ${unknown} of Table ${table}`)
      if (args.filters?.some(([, operator]) => operator === 'related' || operator === 'not related')) reject('Base Table reads do not support related filters')
      // A filter or a sort on a column reveals it as surely as selecting it.
      const named = [...(args.filters ?? []).map(([column]) => column),
        ...String(args.order_by ?? '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)]
      // #1191: retired_at is the platform's, and says only that a row is out of use: an app may ask
      // for retired rows, to find the identifiers they still hold.
      const hidden = named.find(column => column !== 'row_id' && column !== 'retired_at' && !columns!.includes(String(column)))
      if (hidden !== undefined) reject(`The app has not declared column ${String(hidden)} of Table ${table}`)
      return (await getList(table, args)).data as ActionRow[]
    }),
  })
  return { helper, close: guard.close }
}

/** A value as a column holds it, as comparable text: a Date column is a calendar day. */
function asText(value: unknown, type?: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = value instanceof Date ? value.toISOString() : String(value)
  return type === 'Date' ? text.slice(0, 10) : text
}

const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

function checkedApprovers(value: unknown): ApproverRequest {
  const approvers = value as ApproverRequest | undefined
  const list = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string' && item.length > 0)
  if (!approvers || !list(approvers.people) || !list(approvers.fallbackRoles)) reject('Expected approvers: { people, fallbackRoles }')
  return approvers!
}

/** A person who can act on a proposal at all: a working way in, and the app opens for them. */
async function canAct(person: string, entryTable: string): Promise<boolean> {
  return await canSignInNow(person) && await permissionScope(person, entryTable, 'read') !== 'none'
}

/** Who may approve now: the named people who can act, else the holders of the roles. Never the maker. */
async function resolveRoute(request: ApproverRequest, maker: string, entryTable: string): Promise<{ people: string[]; roles: string[] } | null> {
  const named = request.people.filter(person => person !== maker)
  const enabled = named.length ? (await sql`select row_id from person where enabled and row_id in ${sql(named)} order by row_id`).map(row => String(row.row_id)) : []
  const people: string[] = []
  // A proposal must never wait for someone who could not reach it.
  for (const person of enabled) if (await canAct(person, entryTable)) people.push(person)
  if (people.length) return { people, roles: [] }
  if (!request.fallbackRoles.length) return null
  const holders = await sql`select distinct p.row_id from has_role r join person p on p.row_id = r.parent
    where r.parenttype = 'Person' and r.role in ${sql(request.fallbackRoles)} and p.enabled and p.row_id <> ${maker} order by p.row_id`
  for (const holder of holders) if (await canAct(String(holder.row_id), entryTable)) return { people: [], roles: [...request.fallbackRoles] }
  return null
}

async function proposalsWhere(app: string, filter: ProposalFilter): Promise<ChangeProposal[]> {
  const rows = await sql`select row_id, app, target_table, target_row, maker, proposal_state as state, about, decided_by, decided_at,
      decision_reason, result_row, ends_row, approval_type, approval_mode, created_at
    from change_proposal where app = ${app}
      ${filter.ids ? sql`and row_id in ${sql(filter.ids.length ? filter.ids : [''])}` : sql``}
      ${filter.states ? sql`and proposal_state in ${sql(filter.states.length ? filter.states : [''])}` : sql``}
      ${filter.makers ? sql`and maker in ${sql(filter.makers.length ? filter.makers : [''])}` : sql``}
    order by created_at desc, row_id limit ${Math.min(filter.limit ?? 200, 500)} offset ${filter.start ?? 0}`
  if (!rows.length) return []
  const ids = rows.map(row => String(row.row_id))
  const changes = await sql`select parent, column_name, original_value, proposed_value, review_base_value from change_proposal_column where parent in ${sql(ids)} order by "position", column_name`
  const approvers = await sql`select parent, person, role from change_proposal_approver where parent in ${sql(ids)} order by "position"`
  return rows.map(row => ({
    ...row,
    changes: changes.filter(change => change.parent === row.row_id).map(({ parent: _parent, ...change }) => change),
    route: { people: approvers.filter(a => a.parent === row.row_id && a.person).map(a => String(a.person)),
      roles: approvers.filter(a => a.parent === row.row_id && a.role).map(a => String(a.role)) },
  })) as unknown as ChangeProposal[]
}

async function oneProposal(app: string, id: unknown): Promise<ChangeProposal> {
  if (typeof id !== 'string' || !id) reject('A proposal is required')
  const [proposal] = await proposalsWhere(app, { ids: [id as string] })
  if (!proposal) throw new AppError('NotFoundError', 'That proposal does not exist')
  return proposal
}

async function writeRoute(id: string, route: { people: string[]; roles: string[] }, actor: string) {
  await sql`delete from change_proposal_approver where parent = ${id}`
  const rows = [...route.people.map(person => ({ person, role: null })), ...route.roles.map(role => ({ person: null, role }))]
  for (const [position, row] of rows.entries())
    await sql`insert into change_proposal_approver ${sql({ row_id: randomUUID(), created_by: actor, updated_by: actor, position, parent: id,
      parenttype: 'Change Proposal', parentfield: 'approvers', ...row } as unknown as Record<string, never>)}`
}

/** The decision rule, on its own: not the maker, and among those who may approve now. */
async function mayDecide(user: string, maker: string, approvers: unknown, entryTable: string): Promise<boolean> {
  if (maker === user) return false
  const route = await resolveRoute(checkedApprovers(approvers), maker, entryTable)
  return !!route && inRoute(user, route)
}

async function inRoute(user: string, route: { people: string[]; roles: string[] }): Promise<boolean> {
  if (route.people.includes(user)) return true
  const roles = route.roles.length ? await getRoles(user) : []
  return route.roles.some(role => roles.includes(role))
}

export function proposalsReader(app: string, user: string, entryTable: string) {
  const guard = sequential()
  const helper: ChangeProposalsReader = Object.freeze({
    list: (filter: ProposalFilter = {}) => guard.run(() => proposalsWhere(app, filter)),
    mayDecide: (maker: string, approvers: ApproverRequest) => guard.run(() => mayDecide(user, maker, approvers, entryTable)),
    routeFor: (maker: string, approvers: ApproverRequest) => guard.run(() => resolveRoute(checkedApprovers(approvers), maker, entryTable)),
    modeOf: (type: string) => guard.run(() => modeOf(app, type)),
  })
  return { helper, close: guard.close }
}

/** #1191: what applying left behind, as the database wrote it, so an undo can tell whether anyone has changed it since. */
interface AppliedRow { row: string; updated_at: string }
interface AppliedRows { target: AppliedRow | null; result: AppliedRow | null }

const updatedAt = async (meta: TableMeta, row: string): Promise<string> =>
  String((await sql`select updated_at::text as at from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${row}`)[0].at)

/** A day as people read it here: 12-Nov-2026, in India. */
const readableDay = (at: Date) => at.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).replaceAll(' ', '-')

/** Rows still in use that link to this one: retired rows have let go of it. */
async function liveLinksTo(table: string, rowId: string): Promise<number> {
  let links = await anyTableLinkCount(sql, table, rowId)
  const columns = await sql`select parent, column_name from column_def where column_type = 'Reference' and reference_table in ${sql(await linkTargetNames(table, sql))}`
  for (const column of columns) {
    const meta = await getMeta(String(column.parent))
    if (meta.data_source || meta.kind === 'settings') continue
    const [count] = await sql`select count(*)::int as n from ${sql(await tableRelation(meta.name))} where ${sql(String(column.column_name))} = ${rowId}
      ${canRetire(meta) ? sql`and retired_at is null` : sql``}`
    links += Number(count.n)
  }
  return links
}

export function proposalsWriter(app: string, declaration: BaseTablesDeclaration | undefined, linked: readonly string[], user: string, entryTable: string) {
  const guard = sequential()
  const rule = async (table: string) => {
    const declared = declaration?.propose[table]
    const meta = await reachable(app, table, !!declared, linked)
    return { declared: declared!, meta }
  }
  const typeOf = (meta: TableMeta, column: string) => meta.columns.find(c => c.column_name === column)?.column_type
  type Declared = BaseTablesDeclaration['propose'][string]

  /** The caller may decide this proposal, or the request is refused. No role is an exception. */
  async function authorize(proposal: ChangeProposal, approvers: unknown) {
    if (proposal.maker === user) reject('Nobody can decide their own proposal')
    // The ways-in lock first, as identity changes take it. Then the decider's own row holds still
    // to commit, so a disable either lands first and refuses this, or waits for it. One route:
    // the one checked is the one recorded.
    const able = await canAct(user, entryTable)
    // The named people too, in one order: re-enabling a manager either lands first or waits, so
    // a fallback decision can't take a proposal that has just gone back to them.
    const named = checkedApprovers(approvers).people
    await sql`select 1 from person where row_id in ${sql([...new Set([user, ...named])].sort())} order by row_id for share`
    const [me] = await sql`select enabled from person where row_id = ${user}`
    if (!able || me?.enabled !== true) reject('This proposal is not waiting for you')
    const route = await resolveRoute(checkedApprovers(approvers), proposal.maker, entryTable)
    if (!route || !(await inRoute(user, route))) reject('This proposal is not waiting for you')
    return route!
  }

  /** The proposal, locked, in the state named. Pre-row locks first, then the rows in one order, then
   *  the proposal: decisions on one row queue at the row, so none holds a proposal another waits on. */
  async function lockIn(id: unknown, state: ChangeProposalState, meta?: TableMeta, rows: (string | null)[] = []) {
    if (meta) for (const row of [...new Set(rows.filter((r): r is string => !!r))].sort()) {
      await holdBeforeRowLock(sql, meta, user, { [meta.row_key]: row })
      await sql`select 1 from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${row} for update`
    }
    await sql`select 1 from change_proposal where row_id = ${id as string} and app = ${app} for update`
    const proposal = await oneProposal(app, id)
    if (proposal.state !== state) reject(state === 'Pending' ? 'This has already been decided'
      : proposal.state === 'Pending' ? 'This has not been applied yet: it waits for approval' : 'This has already been reviewed')
    return proposal
  }

  async function close(id: string, state: ChangeProposalState, fields: { reason?: string | null; result?: string | null }) {
    await sql`update change_proposal set proposal_state = ${state}, decided_by = ${user}, decided_at = now(), updated_at = now(), updated_by = ${user},
      decision_reason = ${fields.reason ?? null}, result_row = coalesce(${fields.result ?? null}, result_row) where row_id = ${id}`
  }

  const note = (id: string, table: string, row: string, data: Record<string, unknown>) => saveSystemRow('Version', { ref_table: table, ref_name: row,
    data: { changed: [], change_proposal: id, ...data } }, user)

  /** The day and the new row's stamp, as an approval or an apply-now names them. */
  function checkedApplication(declared: Declared, value: { effectiveOn?: unknown; newRow?: unknown } | undefined) {
    if (!isDay(value?.effectiveOn)) reject('Expected the day the change takes effect')
    const stamp = Object.entries((value!.newRow ?? {}) as Record<string, string | null>)
    const unknown = stamp.find(([column]) => !declared.stamp.includes(column))
    if (unknown) reject(`The app has not declared column ${unknown[0]} as one it may set on a new row`)
    return { effective: value!.effectiveOn as string, stamp }
  }

  /** Makes the change, dated `effective`, with the rows already locked; or says why it no longer
   *  fits what was reviewed. `approvedBy` is null for a change that applies when it is asked for. */
  async function applyChange(proposal: ChangeProposal, declared: Declared, meta: TableMeta, effective: string, stamp: [string, string | null][],
    instead: [string, string | null][], approvedBy: string | null): Promise<{ stale: string } | { result: string | null; applied: AppliedRows }> {
    const made = { made_by: proposal.maker, approved_by: approvedBy }
    const proposed = Object.fromEntries(proposal.changes.filter(c => !proposal.target_row || c.proposed_value !== c.review_base_value).map(c => [c.column_name, c.proposed_value]))
    let current: ActionRow | null = null
    if (proposal.target_row) {
      const [exists] = await sql`select 1 from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${proposal.target_row}`
      if (!exists) return { stale: 'What this was about no longer exists.' }
      current = await getDoc(meta.name, proposal.target_row) as ActionRow
      const stale = proposal.changes.some(c => asText(current![c.column_name], typeOf(meta, c.column_name)) !== (c.review_base_value ?? null))
        || (asText(current[declared.startsOn], 'Date') ?? '') > effective
        // A planned end that has since passed: the row isn't in force, though nobody changed it.
        || (asText(current[declared.endsOn], 'Date') ?? '9999') < effective
      if (stale) return { stale: 'It changed after this was asked for.' }
    }
    const endTarget = async () => {
      await saveDoc(meta.name, { row_id: proposal.target_row, updated_at: current!.updated_at, [declared.endsOn]: dayBefore(effective) }, proposal.maker, 'upsert', { skipPermissions: true })
      await note(proposal.row_id, meta.name, proposal.target_row!, made)
      // #627 Q6: the row they were reviewed against has ended.
      await sql`update change_proposal set proposal_state = 'Needs fresh review', decision_reason = 'Another change to this was approved first.', updated_at = now(), updated_by = ${user}
        where app = ${app} and target_table = ${meta.name} and target_row = ${proposal.target_row} and proposal_state = 'Pending' and row_id <> ${proposal.row_id}`
      return { row: proposal.target_row!, updated_at: await updatedAt(meta, proposal.target_row!) }
    }
    if (proposal.ends_row) return { result: null, applied: { target: await endTarget(), result: null } }
    Object.assign(proposed, Object.fromEntries(instead))
    const copied: ActionRow = {}
    if (current) for (const column of meta.columns) {
      if (['Sub-table', 'Section Break', 'Column Break'].includes(column.column_type) || column.column_name === meta.row_key) continue
      copied[column.column_name] = current[column.column_name]
    }
    // A read-only column is copied as it stands: only the platform's trusted path can set one.
    const values: ActionRow = { ...copied, ...proposed, ...Object.fromEntries(stamp), [declared.startsOn]: effective }
    const managedValues = Object.fromEntries(meta.columns.filter(column => column.read_only && column.column_name in values).map(column => [column.column_name, values[column.column_name]]))
    const added = await saveDoc(meta.name, values, proposal.maker, 'insert', { skipPermissions: true, managedValues: managedValues as never })
    const result = String(added.row_id)
    const target = current ? await endTarget() : null
    await note(proposal.row_id, meta.name, result, made)
    return { result, applied: { target, result: { row: result, updated_at: await updatedAt(meta, result) } } }
  }

  /** Why the row an applied change left can't be put back, or null when nobody has touched it. */
  async function changedSince(meta: TableMeta, side: AppliedRow): Promise<string | null> {
    const [row] = await sql`select updated_at, updated_at::text as at, updated_by, retired_at from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${side.row}`
    if (!row || row.retired_at) return 'What it changed is no longer in use, so it can\'t be undone. Put it right by hand instead.'
    if (row.at === side.updated_at) return null
    const [who] = await sql`select full_name from person where row_id = ${String(row.updated_by)}`
    return `${who?.full_name || row.updated_by} changed it on ${readableDay(row.updated_at as Date)}, after this applied, so it can't be undone. Put it right by hand instead.`
  }

  const helper: ChangeProposalsHelper = Object.freeze({
    list: (filter: ProposalFilter = {}) => guard.run(() => proposalsWhere(app, filter)),
    mayDecide: (maker: string, approvers: ApproverRequest) => guard.run(() => mayDecide(user, maker, approvers, entryTable)),
    routeFor: (maker: string, approvers: ApproverRequest) => guard.run(() => resolveRoute(checkedApprovers(approvers), maker, entryTable)),
    modeOf: (type: string) => guard.run(() => modeOf(app, type)),

    // Who may decide comes from rows the app reads first. These hold still what it read until
    // the decision commits, so authority can't change while the decision waits for a lock.
    lockRow: (table: string, rowId: string) => guard.run(async () => {
      const meta = await reachable(app, table, !!(declaration?.read[table] || declaration?.propose[table]), linked)
      if (typeof rowId !== 'string' || !rowId) reject('A row is required')
      await holdBeforeRowLock(sql, meta, user, { [meta.row_key]: rowId })
      await sql`select 1 from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${rowId} for update`
    }),
    // For a rule no row can hold, such as "one placement per store and subcategory".
    serialize: (key: string) => guard.run(async () => {
      if (typeof key !== 'string' || !key) reject('A key is required')
      await sql`select pg_advisory_xact_lock(hashtextextended(${`change-proposal:${app}:${key}`}, 0))`
    }),

    propose: (request: ProposalRequest) => guard.run(async () => {
      const { table, row, changes, about, reviewed: mustStay = [], ends = false, type } = request ?? ({} as ProposalRequest)
      const target = row ?? null
      const { declared, meta } = await rule(table)
      const mode = await modeOf(app, type)
      // #1191: what applying needs is checked before anything is written.
      const application = mode === APPLY_NOW ? checkedApplication(declared, request.apply) : null
      const entries = Object.entries(changes ?? {})
      if (ends !== true && ends !== false) reject('Expected ends to be true or false')
      // An ending changes nothing on the row it ends: there is no new row to describe.
      if (ends && (target === null || entries.length)) reject('An ending names its row and changes no column')
      if (!ends && !entries.length) reject('A proposal changes at least one column')
      for (const [column, value] of entries) {
        if (!declared.columns.includes(column) || !typeOf(meta, column)) reject(`The app has not declared column ${column} of Table ${table}`)
        if (value !== null && typeof value !== 'string') reject('Proposed values are text')
      }
      for (const column of mustStay)
        if (!declared.columns.includes(column) || !typeOf(meta, column) || column in changes) reject(`Column ${column} of Table ${table} cannot be reviewed here`)
      // Applying at once: the row holds still from this read until the change has been made.
      if (application && target !== null) {
        await holdBeforeRowLock(sql, meta, user, { [meta.row_key]: target })
        await sql`select 1 from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${target} for update`
      }
      let current: ActionRow | null = null
      if (target !== null) current = await getDoc(table, String(target)) as ActionRow
      const before = (column: string) => current ? asText(current[column], typeOf(meta, column)) : null
      if (current && !ends && entries.every(([column, value]) => before(column) === value)) reject('That is already the case')
      if (ends && current && (asText(current[declared.endsOn], 'Date') ?? '9999') < '9999') reject('That already has an end')
      const route = await resolveRoute(checkedApprovers(request.approvers), user, entryTable)
      if (!route) reject('Nobody else can approve this, so it cannot be sent')
      const same = await proposalsWhere(app, { states: ['Pending'], makers: [user], limit: 500 })
      const key = (list: { column_name: string; proposed_value: string | null }[]) => JSON.stringify([...list].sort((a, b) => a.column_name.localeCompare(b.column_name)).map(c => [c.column_name, c.proposed_value]))
      const asked = key(entries.filter(([column, value]) => !current || before(column) !== value).map(([column_name, proposed_value]) => ({ column_name, proposed_value })))
      // Only what the proposal changes: the reviewed columns hold still.
      const askedOf = (p: ChangeProposal) => key(p.changes.filter(c => p.target_row === null || c.proposed_value !== c.review_base_value))
      if (same.some(p => p.target_table === table && p.target_row === target && p.ends_row === ends && askedOf(p) === asked)) reject('You have already asked for this')
      const saved = await saveSystemRow('Change Proposal', { app, target_table: table, target_row: target, maker: user, proposal_state: 'Pending', about: (about ?? null) as never }, user)
      const id = String(saved.row_id)
      await sql`update change_proposal set ends_row = ${ends}, approval_type = ${type ?? null}, approval_mode = ${mode} where row_id = ${id}`
      // The end date and the app's reviewed columns are compared at approval, though never
      // proposed: a row that ended, or now holds something else, is not what was reviewed.
      const reviewed = [...entries.map(([column, value]) => [column, before(column), value] as const),
        ...(current ? [...mustStay, declared.endsOn].map(column => [column, before(column), before(column)] as const) : [])]
      for (const [position, [column_name, original, proposed]] of reviewed.entries())
        await sql`insert into change_proposal_column ${sql({ row_id: randomUUID(), created_by: user, updated_by: user, position, parent: id,
          parenttype: 'Change Proposal', parentfield: 'changes', column_name, original_value: original, proposed_value: proposed, review_base_value: original } as unknown as Record<string, never>)}`
      await writeRoute(id, route!, user)
      if (application) {
        // The row is locked since the read above, but it may not fit the day named: starting later, or ended by then.
        const done = await applyChange(await oneProposal(app, id), declared, meta, application.effective, application.stamp, [], null)
        if ('stale' in done) reject(done.stale)
        const { result, applied } = done as { result: string | null; applied: AppliedRows }
        await sql`update change_proposal set proposal_state = 'Not yet reviewed', result_row = ${result}, applied_rows = ${sql.json(applied as never)},
          updated_at = now() where row_id = ${id}`
      }
      return oneProposal(app, id)
    }),

    approve: (id: string, decision: DecisionApproval) => guard.run(async () => {
      const first = await oneProposal(app, id)
      const { declared, meta } = await rule(first.target_table)
      const proposal = await lockIn(id, 'Pending', meta, [first.target_row])
      const route = await authorize(proposal, decision?.approvers)
      const { effective, stamp } = checkedApplication(declared, decision)
      await writeRoute(proposal.row_id, route, user)
      const proposed = proposal.changes.filter(c => !proposal.target_row || c.proposed_value !== c.review_base_value).map(c => c.column_name)
      // The approver may apply another value, but only for what the proposal changes.
      const instead = Object.entries(decision.instead ?? {})
      for (const [column, value] of instead) {
        if (proposal.ends_row || !proposed.includes(column)) reject(`Column ${column} is not one this proposal changes`)
        if (value !== null && typeof value !== 'string') reject('Proposed values are text')
      }
      if (decision.reason !== undefined && typeof decision.reason !== 'string') reject('A reason is text')
      const done = await applyChange(proposal, declared, meta, effective, stamp, instead, user)
      if ('stale' in done) await close(proposal.row_id, 'Needs fresh review', { reason: done.stale })
      else await close(proposal.row_id, 'Applied', { result: done.result, reason: decision.reason?.trim() || null })
      return oneProposal(app, id)
    }),

    reject: (id: string, decision: DecisionNote) => guard.run(async () => {
      const reason = typeof decision?.reason === 'string' ? decision.reason.trim() : ''
      if (!reason) reject('Say why you are rejecting this')
      const proposal = await lockIn(id, 'Pending')
      await writeRoute(proposal.row_id, await authorize(proposal, decision.approvers), user)
      await close(proposal.row_id, 'Rejected', { reason })
      return oneProposal(app, id)
    }),

    // #1175: Undo. Only the maker, only while it waits; it needs nobody's approval.
    withdraw: (id: string) => guard.run(async () => {
      const proposal = await lockIn(id, 'Pending')
      if (proposal.maker !== user) reject('Only the person who asked can withdraw this')
      await close(proposal.row_id, 'Withdrawn', {})
      return oneProposal(app, id)
    }),

    needsFreshReview: (id: string, decision: DecisionNote) => guard.run(async () => {
      const reason = typeof decision?.reason === 'string' ? decision.reason.trim() : ''
      if (!reason) reject('Say why this needs a fresh review')
      const proposal = await lockIn(id, 'Pending')
      await writeRoute(proposal.row_id, await authorize(proposal, decision.approvers), user)
      await close(proposal.row_id, 'Needs fresh review', { reason })
      return oneProposal(app, id)
    }),

    // #1191: a reviewer confirms a change that applied when it was asked for. Never the maker.
    confirm: (id: string, decision: ReviewConfirmation) => guard.run(async () => {
      if (decision?.note !== undefined && typeof decision.note !== 'string') reject('A note is text')
      const proposal = await lockIn(id, 'Not yet reviewed')
      await writeRoute(proposal.row_id, await authorize(proposal, decision?.approvers), user)
      await close(proposal.row_id, 'Confirmed', { reason: decision.note?.trim() || null })
      return oneProposal(app, id)
    }),

    // #1191: puts the rows back as they were: the row it added is retired, the row it ended runs on.
    // Refused, with nothing touched, when either has changed since or a row in use still links to it.
    undo: (id: string, decision: ReviewUndo) => guard.run(async () => {
      const first = await oneProposal(app, id)
      const { declared, meta } = await rule(first.target_table)
      const proposal = await lockIn(id, 'Not yet reviewed', meta, [first.target_row, first.result_row])
      if (decision?.reason !== undefined && typeof decision.reason !== 'string') reject('A reason is text')
      const reason = decision?.reason?.trim() ?? ''
      // The maker may take back their own change, as they could withdraw it while it waited.
      if (proposal.maker !== user) {
        if (!reason) reject('Say why you are undoing this')
        await writeRoute(proposal.row_id, await authorize(proposal, decision?.approvers), user)
      }
      const [{ applied_rows: applied }] = await sql`select applied_rows from change_proposal where row_id = ${proposal.row_id}` as unknown as { applied_rows: AppliedRows }[]
      for (const side of [applied.result, applied.target]) {
        const why = side && await changedSince(meta, side)
        if (why) reject(why)
      }
      if (applied.result && await liveLinksTo(meta.name, applied.result.row))
        reject('Other rows still link to what this added, so it can\'t be undone yet. Undo those first.')
      if (applied.result) {
        // Never in force, so whatever reads by date drops it (scope providers see retired rows,
        // ADR 0019); then out of every list, its history kept.
        const [added] = await sql`select updated_at, ${sql(declared.startsOn)} as starts from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${applied.result.row}`
        await saveDoc(meta.name, { row_id: applied.result.row, updated_at: added.updated_at, [declared.endsOn]: dayBefore(asText(added.starts, 'Date')!) }, user, 'upsert', { skipPermissions: true })
        await retireDoc(meta.name, applied.result.row, `Undone: ${reason || 'taken back by the person who made it'}`, user, { skipPermissions: true })
      }
      if (applied.target) {
        const original = proposal.changes.find(change => change.column_name === declared.endsOn)?.original_value ?? null
        const [row] = await sql`select updated_at from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${applied.target.row}`
        await saveDoc(meta.name, { row_id: applied.target.row, updated_at: row.updated_at, [declared.endsOn]: original }, user, 'upsert', { skipPermissions: true })
        await note(proposal.row_id, meta.name, applied.target.row, { undone_by: user })
      }
      await close(proposal.row_id, 'Undone', { reason: reason || null })
      return oneProposal(app, id)
    }),
  })
  return { helper, close: guard.close }
}
