import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { tableRelation } from './table-engine'
import { appOperation, assertAppAvailable, isProvisioningApp } from './app-lifecycle'
import { actionTransaction, afterDocumentCommit } from './action-transaction'
import { publishDocEvent } from './realtime'
import { saveDoc, deleteDoc, saveSystemRow, assertUserPermissions } from './document'
import { getRoles, permissionGrants, grantMatches, permittedColumns, stripUnwritableFields, assertDocPermission, enabledPrincipal } from './permissions'
import { administrationFor, assignmentPredicate, scopedRoles, jobAssignments, type ApprovalRule } from './administration-scopes'
import { loadScope, scopeContains } from './administration-authority'
import { holdBeforeRowLock } from './row-lock-order'
import { queueApprovalEmails } from './workflow'

type Row = Record<string, unknown>
type Operation = 'create' | 'update' | 'delete'
type Change = { column: string; columnId: string; original: unknown; current: unknown; proposed: unknown }
const same = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)))
const refused = () => new AppError('PermissionError', 'No current authority for this proposal')
const conflict = () => new AppError('ConflictError', 'This proposal changed; load its current revision before deciding')
const applying = new AsyncLocalStorage<{ proposal: string; revision: number; operation: Operation; maker: string; table: string; name: string; changes: Change[]; reviewers: string[]; authorities: string[] }>()

export function correctionHistory(table: string, name: string) {
  const context = applying.getStore()
  if (!context || context.table !== table || context.name !== name) return undefined
  return { proposal: context.proposal, revision: context.revision, operation: context.operation,
    maker: context.maker, reviewers: context.reviewers, authorities: context.authorities }
}

class HeldCorrection extends Error {
  constructor(readonly meta: TableMeta, readonly maker: string, readonly old: Row, readonly row: Row,
    readonly changes: Change[], readonly rules: ApprovalRule[], readonly operation: Operation) { super('Correction held for approval') }
}

function managed(meta: TableMeta) {
  return !!meta.owner_app && !isProvisioningApp(meta.owner_app)
    && !!administrationFor(meta.owner_app)?.approvals?.some(rule => rule.table === meta.name)
}

async function hasRoleOn(user: string, role: string, meta: TableMeta, old: Row, row: Row) {
  if ((await getRoles(user)).includes(role)) return true
  for (const scope of (await scopedRoles(user, meta.name)).get(role) ?? []) {
    const [result] = await sql`select (${(await assignmentPredicate(user, meta.name, scope, old)).frag})
      and (${(await assignmentPredicate(user, meta.name, scope, row)).frag}) as allowed`
    if (result.allowed) return true
  }
  return false
}

async function applicableRules(meta: TableMeta, user: string, old: Row, row: Row, changes: Change[], operation: Operation): Promise<ApprovalRule[]> {
  const rules: ApprovalRule[] = []
  for (const rule of administrationFor(meta.owner_app!)?.approvals ?? []) {
    if (rule.table !== meta.name || rule.operation !== operation || !changes.some(change => rule.columns.includes(change.column))) continue
    if (rule.maker?.self !== undefined) {
      const target = administrationFor(meta.owner_app!)?.targets[meta.name]
      if (!target || !('person' in target)
        || (old[target.person] === user) !== rule.maker.self || (row[target.person] === user) !== rule.maker.self) continue
    }
    if (rule.maker?.role && !await hasRoleOn(user, rule.maker.role, meta, old, row)) continue
    if (rule.maker?.notRole && await hasRoleOn(user, rule.maker.notRole, meta, old, row)) continue
    rules.push(rule)
  }
  if (changes.some(change => !rules.some(rule => rule.columns.includes(change.column)))) throw refused()
  return rules
}

/** Runs at the end of the normal save transaction, including validations,
 * hooks and authority checks. Throwing discards every tentative write/effect. */
export async function checkCorrectionApproval(meta: TableMeta, user: string, old: Row, row: Row, operation: Operation = 'update') {
  const approvalManaged = managed(meta)
  if (!approvalManaged && (!meta.owner_app || isProvisioningApp(meta.owner_app)
    || !administrationFor(meta.owner_app)?.targets[meta.name])) return
  if (operation !== 'delete') {
    const [stored] = await sql`select * from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${String(row[meta.row_key])}`
    // Post-save SQL cannot substitute a payload after normal validation and
    // permission checks. Transformations belong in the before-save hooks.
    if (!stored || meta.columns.some(column => !same(stored[column.column_name], row[column.column_name]))) throw conflict()
  }
  if (!approvalManaged) return
  const changes: Change[] = meta.columns.filter(column => !column.read_only && (operation === 'delete' || !same(old[column.column_name], row[column.column_name])))
    .map(column => ({ column: column.column_name, columnId: column.row_id, original: old[column.column_name] ?? null,
      current: old[column.column_name] ?? null, proposed: operation === 'delete' ? null : row[column.column_name] ?? null }))
  const context = applying.getStore()
  if (context) {
    const expected = context.changes.filter(change => operation === 'delete' || !same(change.current, change.proposed))
    if (context.operation !== operation || context.maker !== user || context.table !== meta.name || context.name !== String(row[meta.row_key])
      || changes.length !== expected.length || changes.some(change => !expected.some(reviewed =>
        reviewed.columnId === change.columnId && same(reviewed.proposed, change.proposed) && same(reviewed.current, change.current)))) throw conflict()
    return correctionHistory(meta.name, String(row[meta.row_key]))
  }
  if (!changes.length) return
  const rules = await applicableRules(meta, user, operation === 'create' ? row : old, row, changes, operation)
  if (rules.some(rule => rule.outcome === 'approval')) throw new HeldCorrection(meta, user, old, row, changes, rules, operation)
  const proposal = await recordProposal(new HeldCorrection(meta, user, old, row, changes, rules, operation), 'applied')
  for (const rule of rules) await saveSystemRow('Decision', { proposal: proposal.proposal, revision: 1,
    reviewer: user, rule: rule.id, decision: 'apply_and_log' }, user)
  return { proposal: proposal.proposal, revision: 1, operation, maker: user, reviewers: [] as string[], authorities: [] as string[] }
}

async function recordProposal(held: HeldCorrection, state: 'pending' | 'applied') {
  const proposal = await saveSystemRow('Proposal', { app: held.meta.owner_app, ref_table: held.meta.name,
    ref_name: held.row[held.meta.row_key], maker: held.maker, operation: held.operation, state, revision: 1,
    original_row: held.old, rules: held.rules }, held.maker)
  for (const change of held.changes) await saveSystemRow('Proposal Change', { proposal: proposal.row_id,
    target_column: change.columnId, original: change.original, current: change.current, proposed: change.proposed }, held.maker)
  if (state === 'pending') {
    const recipients: string[] = []
    for (const person of await sql`select row_id, email from featherbase.person where enabled and email is not null and row_id <> ${held.maker}`) {
      try {
        for (const rule of held.rules) if (rule.outcome === 'approval' && await reviewerProof(String(person.row_id), held.meta,
          held.operation === 'create' ? held.row : held.old, held.row, held.changes, rule)) {
          recipients.push(String(person.email))
          break
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.type !== 'PermissionError') throw error
      }
    }
    await queueApprovalEmails(held.meta.name, String(held.row[held.meta.row_key]), 'Pending correction', 'Approve, Reject', recipients,
      `/api/administration/proposals?table=${encodeURIComponent(held.meta.name)}`)
  }
  return { outcome: state === 'pending' ? 'pending_approval' : 'applied', proposal: String(proposal.row_id), version: 1,
    table: held.meta.name, row_id: String(held.row[held.meta.row_key]) }
}

/** The outer transaction keeps authority and the target stable while the
 * inner savepoint rolls the tentative correction back and stores only work
 * awaiting review. HTTP actors cannot select the applying context. */
export async function withCorrectionApproval<T extends Row | void>(meta: TableMeta, user: string, values: Row, save: () => Promise<T>): Promise<T | Row> {
  if (!managed(meta) || applying.getStore()) return save()
  return actionTransaction(async () => {
    await holdBeforeRowLock(sql, meta, user, values)
    if (values[meta.row_key]) await sql`select 1 from ${sql(await tableRelation(meta.name))}
      where ${sql(meta.row_key)} = ${String(values[meta.row_key])} for update`
    try { return await actionTransaction(save) }
    catch (error) {
      if (!(error instanceof HeldCorrection)) throw error
      return recordProposal(error, 'pending')
    }
  })
}

export function isPendingCorrection(row: Row): boolean { return row.outcome === 'pending_approval' && typeof row.proposal === 'string' }

async function reviewerProof(user: string, meta: TableMeta, old: Row, row: Row, changes: Change[], rule: ApprovalRule): Promise<{ authority?: string } | null> {
  if (!await enabledPrincipal(user)) return null
  const relevant = changes.filter(change => rule.columns.includes(change.column))
  const grants = (await permissionGrants(user, meta.name, 'approve')).filter(grant => grant.role === rule.approverRole)
  for (const change of relevant) {
    let allowed = false
    for (const grant of grants) if (grant.columns.includes(change.columnId)
      && await grantMatches(user, meta.name, grant, old) && await grantMatches(user, meta.name, grant, row)) { allowed = true; break }
    if (!allowed) return null
  }
  await assertUserPermissions(user, meta, old)
  await assertUserPermissions(user, meta, row)
  if (!rule.authorityRole) return {}
  if (!await hasRoleOn(user, rule.authorityRole, meta, old, row)) return null
  const jobs = await jobAssignments(meta.owner_app!)
  const authorities = await sql`select * from featherbase.authority where app = ${meta.owner_app!}
    and holder_role = ${rule.authorityRole} and enabled`
  for (const authority of authorities) {
    const scope = await loadScope(meta.owner_app!, String(authority.scope))
    if (!scope) continue
    if (authority.office_job) {
      let occupies = false
      for (const job of jobs.filter(job => job.person === user && job.job === authority.office_job && scopeContains(scope, job.scope))) {
        const [matches] = await sql`select (${(await assignmentPredicate(user, meta.name, job.scope, old)).frag})
          and (${(await assignmentPredicate(user, meta.name, job.scope, row)).frag}) as allowed`
        if (matches.allowed) occupies = true
      }
      if (!occupies) continue
    }
    const [allowed] = await sql`select (${(await assignmentPredicate(user, meta.name, scope, old)).frag})
      and (${(await assignmentPredicate(user, meta.name, scope, row)).frag}) as allowed`
    if (allowed.allowed) return { authority: String(authority.row_id) }
  }
  return null
}

async function proposalChanges(proposal: string): Promise<Change[]> {
  const rows = await sql`select pc.*, c.column_name from featherbase.proposal_change pc
    join column_def c on c.row_id = pc.target_column where pc.proposal = ${proposal} order by c.position, c.row_id`
  return rows.map(row => ({ column: String(row.column_name), columnId: String(row.target_column),
    original: row.original, current: row.current, proposed: row.proposed }))
}

/** Reviewing reveals only the Columns covered by this reviewer's complete
 * approval contributions, not the proposal's other required reviews. */
export function listCorrections(user: string, table: string) {
  return appOperation(() => actionTransaction(async () => {
    const meta = await getMeta(table)
    await assertAppAvailable(table)
    await holdBeforeRowLock(sql, meta, user, {})
    const data: Row[] = []
    for (const proposal of await sql`select * from featherbase.proposal where ref_table = ${table}
      and state = 'pending' order by created_at, row_id`) {
      if (proposal.maker === user) continue
      const [stored] = await sql`select * from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${String(proposal.ref_name)}`
      const changes = await proposalChanges(String(proposal.row_id))
      const proposed = proposal.operation === 'delete' ? stored : { ...stored, [meta.row_key]: proposal.ref_name,
        ...Object.fromEntries(changes.map(change => [change.column, change.proposed])) }
      const original = proposal.operation === 'create' ? proposed : stored
      if (!original || !proposed) continue
      try {
        const rules = await applicableRules(meta, String(proposal.maker), original, proposed, changes, proposal.operation as Operation)
        const visible = new Set<string>()
        for (const rule of rules) if (rule.outcome === 'approval' && await reviewerProof(user, meta, original, proposed, changes, rule))
          for (const column of rule.columns) visible.add(column)
        if (!visible.size) continue
        data.push({ proposal: proposal.row_id, version: Number(proposal.revision), table, row_id: proposal.ref_name,
          operation: proposal.operation, maker: proposal.maker,
          changes: changes.filter(change => visible.has(change.column)).map(change => ({ column: change.column,
            original: change.original, current: stored?.[change.column] ?? null, proposed: change.proposed })) })
      } catch (error) {
        if (!(error instanceof AppError) || error.type !== 'PermissionError') throw error
      }
    }
    return { data }
  }))
}

const reviewInput = z.object({ proposal: z.string().min(1), version: z.number().int().positive(),
  decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(1).optional(), rule: z.string().optional() }).strict()

export function reviewCorrection(user: string, input: unknown) {
  const parsed = reviewInput.safeParse(input)
  if (!parsed.success || parsed.data.decision === 'reject' && !parsed.data.reason)
    throw new AppError('ValidationError', 'A decision needs the exact proposal revision; rejection also needs a reason')
  const args = parsed.data
  return appOperation(() => actionTransaction(async () => {
    const [initial] = await sql`select ref_table from featherbase.proposal where row_id = ${args.proposal}`
    if (!initial) throw refused()
    const meta = await getMeta(String(initial.ref_table))
    await assertAppAvailable(meta.name)
    await holdBeforeRowLock(sql, meta, user, {})
    const [proposal] = await sql`select * from featherbase.proposal where row_id = ${args.proposal} for update`
    if (!proposal || proposal.maker === user) throw refused()
    if (proposal.state !== 'pending' || Number(proposal.revision) !== args.version) throw conflict()
    const operation = proposal.operation as Operation
    const [existing] = await sql`select * from ${sql(await tableRelation(meta.name))}
      where ${sql(meta.row_key)} = ${String(proposal.ref_name)} for update`
    if (operation === 'create' ? !!existing : !existing) throw conflict()
    const current = existing ?? {}
    const changes = await proposalChanges(args.proposal)
    const wanted = Object.fromEntries(changes.map(change => [change.column, change.proposed]))
    const proposed = operation === 'delete' ? current : { ...current, [meta.row_key]: proposal.ref_name, ...wanted }
    const originalScope = operation === 'create' ? proposed : current
    const maker = String(proposal.maker)
    // Withdrawal prevents application, not an authorised reviewer's refusal
    // of obsolete work. Rejection still checks current review authority below.
    if (args.decision === 'approve') {
      if (!await enabledPrincipal(maker)) throw refused()
      const action = operation === 'update' ? 'write' : operation
      await assertDocPermission(maker, meta.name, action, originalScope)
      await assertDocPermission(maker, meta.name, action, proposed)
      await assertUserPermissions(maker, meta, originalScope)
      await assertUserPermissions(maker, meta, proposed)
      if (operation !== 'delete') stripUnwritableFields(meta.columns,
        await permittedColumns(maker, meta.name, operation === 'create' ? 'create' : 'write', originalScope, proposed), wanted, current)
    }
    const allRules = await applicableRules(meta, maker, originalScope, proposed, changes, operation)
    const rules = allRules.filter(rule => rule.outcome === 'approval')
    const eligible: ApprovalRule[] = []
    for (const rule of rules) if ((!args.rule || args.rule === rule.id) && await reviewerProof(user, meta, originalScope, proposed, changes, rule)) eligible.push(rule)
    if (!eligible.length) throw refused()
    if (changes.some(change => !same(current[change.column], change.current)) || !same(proposal.rules, allRules)) {
      for (const change of changes) await sql`update featherbase.proposal_change set current = ${sql.json(current[change.column] as never)}
        where proposal = ${args.proposal} and target_column = ${change.columnId}`
      await sql`update featherbase.proposal set revision = revision + 1, rules = ${sql.json(allRules)},
        updated_at = now(), updated_by = ${user} where row_id = ${args.proposal}`
      const visible = new Set(eligible.flatMap(rule => rule.columns))
      return { outcome: 'conflict', proposal: args.proposal, version: args.version + 1,
        changes: changes.filter(change => visible.has(change.column)).map(change => ({ column: change.column,
          original: change.original, current: current[change.column], proposed: change.proposed })) }
    }
    const [decided] = await sql`select 1 from featherbase.decision where proposal = ${args.proposal}
      and revision = ${args.version} and reviewer = ${user} and rule in ${sql(eligible.map(rule => rule.id))}`
    if (decided) throw conflict()
    for (const rule of eligible) await saveSystemRow('Decision', { proposal: args.proposal, revision: args.version,
      reviewer: user, rule: rule.id, decision: args.decision, reason: args.reason }, user)
    if (args.decision === 'reject') {
      await sql`update featherbase.proposal set state = 'rejected', updated_at = now(), updated_by = ${user} where row_id = ${args.proposal}`
      return { outcome: 'rejected', proposal: args.proposal, version: args.version }
    }
    const decisions = await sql`select * from featherbase.decision where proposal = ${args.proposal} and revision = ${args.version} and decision = 'approve'`
    const satisfied = new Set<string>()
    const reviewers = new Set<string>()
    const authorities = new Set<string>()
    for (const rule of rules) for (const decision of decisions) if (decision.rule === rule.id
      && decision.reviewer !== maker) {
      const proof = await reviewerProof(String(decision.reviewer), meta, originalScope, proposed, changes, rule)
      if (!proof) continue
      satisfied.add(rule.alternativeGroup ?? rule.id)
      reviewers.add(String(decision.reviewer))
      if (proof.authority) authorities.add(proof.authority)
    }
    if (rules.some(rule => !satisfied.has(rule.alternativeGroup ?? rule.id)))
      return { outcome: 'pending_approval', proposal: args.proposal, version: args.version }
    await applying.run({ proposal: args.proposal, revision: args.version, operation, maker, table: meta.name,
      name: String(proposal.ref_name), changes, reviewers: [...reviewers], authorities: [...authorities] },
      async () => {
        if (operation === 'delete') await deleteDoc(meta.name, String(proposal.ref_name), maker, {
          expectUpdatedAt: current.updated_at instanceof Date ? current.updated_at.toISOString() : String(current.updated_at),
        })
        else await saveDoc(meta.name, { row_id: proposal.ref_name, ...(operation === 'update' ? { updated_at: current.updated_at } : {}), ...wanted }, maker,
          operation === 'create' ? 'insert' : 'upsert')
      })
    await sql`update featherbase.proposal set state = 'applied', updated_at = now(), updated_by = ${user} where row_id = ${args.proposal}`
    await afterDocumentCommit(async () => {
      publishDocEvent(meta.name, String(proposal.ref_name), operation === 'create' ? 'created' : operation === 'delete' ? 'deleted' : 'updated')
    })
    return { outcome: 'applied', proposal: args.proposal, version: args.version }
  }))
}
