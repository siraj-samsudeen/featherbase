// #627: deciding a rule-made Change Proposal. Approving needs no edit permission on the row: the
// platform saves the held values again AS THE MAKER, so the maker's permissions, the Table's
// validation and hooks, and history all run on the change that is applied. Before that it checks
// again that the values the proposal was based on are unchanged and that the rules still route
// the maker's change to this approver. A proposal is not a permanent pass.
import { withTransaction, sql } from './db'
import { AppError } from './errors'
import { getMeta, ROW_KEY, type TableMeta } from './meta'
import { getRoles } from './permissions'
import { canSignInNow } from './identities'
import { tableRelation } from './table-engine'
import { holdBeforeRowLock } from './row-lock-order'
import { getDoc, saveDoc } from './document'
import { comparable, decide, decideUpdate, writeRequirements, type Operation, type Requirement } from './approval-rules'
import { readerFor, restrictRow, FULL_READER } from './row-readers'
import { isSharedWith } from './permissions'
import { displayName } from './people-directory'
import { SYSTEM_ACTOR_LABELS } from 'shared'

type Row = Record<string, unknown>
const OPEN = ['Pending', 'Needs fresh review']

export interface RuleProposal {
  row_id: string
  target_table: string
  target_row: string | null
  operation: Operation
  maker: string
  state: string
  decided_by: string | null
  decided_at: Date | null
  decision_reason: string | null
  result_row: string | null
  created_at: Date
  changes: { column_name: string; original_value: string | null; proposed_value: string | null; review_base_value: string | null }[]
  waiting_for: { key: string; people: string[]; roles: string[]; approved_by: string | null; approved_at: Date | null }[]
  /** The names of the people it names (maker, approvers, decider), for whoever may see it. */
  names: Record<string, string>
  can_decide?: boolean
}

async function load(where: { ids?: string[]; table?: string; row?: string; openOnly?: boolean }): Promise<RuleProposal[]> {
  const rows = await sql`select row_id, target_table, target_row, operation, maker, proposal_state as state, decided_by, decided_at,
      decision_reason, result_row, created_at
    from change_proposal where app is null and operation is not null
      ${where.ids ? sql`and row_id in ${sql(where.ids)}` : sql``}
      ${where.table ? sql`and target_table = ${where.table}` : sql``}
      ${where.row ? sql`and target_row = ${where.row}` : sql``}
      ${where.openOnly ? sql`and proposal_state in ${sql(OPEN)}` : sql``}
    order by created_at desc, row_id limit 200`
  if (!rows.length) return []
  const ids = rows.map(r => String(r.row_id))
  const changes = await sql`select parent, column_name, original_value, proposed_value, review_base_value from change_proposal_column
    where parent in ${sql(ids)} order by "position", column_name`
  const approvers = await sql`select parent, requirement, person, role, approved_by, approved_at from change_proposal_approver
    where parent in ${sql(ids)} order by "position"`
  const actorIds = [...new Set([...rows.flatMap(r => [r.maker, r.decided_by]), ...approvers.flatMap(a => [a.person, a.approved_by])]
    .filter((id): id is string => typeof id === 'string'))]
  // Every proposal has a maker, so there is always someone to name.
  const actors = await sql`select row_id, full_name, username from person where row_id in ${sql(actorIds)}
    union all select row_id, label as full_name, null as username from service_account where row_id in ${sql(actorIds)}`
  const named = new Map(actors.map(actor => [String(actor.row_id), displayName(actor)]))
  const nameOf = (id: string) => named.get(id) ?? SYSTEM_ACTOR_LABELS[id] ?? 'Unnamed person'
  return rows.map(row => {
    const mine = approvers.filter(a => a.parent === row.row_id)
    const people = [row.maker, row.decided_by, ...mine.flatMap(a => [a.person, a.approved_by])].filter((id): id is string => typeof id === 'string')
    const keys = [...new Set(mine.map(a => String(a.requirement)))]
    return {
      ...row,
      changes: changes.filter(c => c.parent === row.row_id).map(({ parent: _parent, ...change }) => change),
      waiting_for: keys.map(key => {
        const entries = mine.filter(a => String(a.requirement) === key)
        const done = entries.find(a => a.approved_by)
        return { key, people: entries.filter(a => a.person).map(a => String(a.person)), roles: entries.filter(a => a.role).map(a => String(a.role)),
          approved_by: (done?.approved_by as string | null) ?? null, approved_at: (done?.approved_at as Date | null) ?? null }
      }),
      names: Object.fromEntries(people.map(id => [id, nameOf(id)])),
    } as unknown as RuleProposal
  })
}

async function canAct(user: string): Promise<boolean> {
  const [me] = await sql`select enabled from person where row_id = ${user}`
  return me?.enabled === true && await canSignInNow(user)
}

/** The first requirement this person can meet, among those not met yet. One person meets one. */
function requirementFor(user: string, roles: string[], requirements: Requirement[], approvals: Map<string, { by: string; at: Date }>): Requirement | undefined {
  if ([...approvals.values()].some(a => a.by === user)) return undefined
  return requirements.find(r => !approvals.has(r.key) && (r.people.includes(user) || r.roles.some(role => roles.includes(role))))
}

async function mayDecideNow(proposal: RuleProposal, user: string, roles: string[]): Promise<boolean> {
  if (!OPEN.includes(proposal.state) || proposal.maker === user) return false
  const approvals = new Map(proposal.waiting_for.filter(w => w.approved_by).map(w => [w.key, { by: w.approved_by!, at: w.approved_at! }]))
  return !!requirementFor(user, roles, proposal.waiting_for, approvals) && await canAct(user)
}

/** What the reader may see of a proposal: the changes to columns they can read. */
async function visible(proposal: RuleProposal, user: string): Promise<RuleProposal> {
  const meta = await getMeta(proposal.target_table)
  const shared = proposal.target_row !== null && await isSharedWith(user, meta.name, proposal.target_row, 'read')
  const reader = shared ? FULL_READER : await readerFor(user, meta.name, 'read', proposal.maker)
  const probe = Object.fromEntries(proposal.changes.map(c => [c.column_name, c.proposed_value]))
  const allowed = await restrictRow(meta, { table: meta.name, ...probe }, reader)
  return { ...proposal, changes: proposal.changes.filter(c => Object.hasOwn(allowed, c.column_name)) }
}

/** A row's proposals, for anyone who can read the row. */
export async function proposalsForRow(table: string, row: string, user: string): Promise<RuleProposal[]> {
  await getDoc(table, row, user)
  const roles = await getRoles(user)
  const out: RuleProposal[] = []
  for (const proposal of await load({ table, row })) out.push({ ...(await visible(proposal, user)), can_decide: await mayDecideNow(proposal, user, roles) })
  return out
}

/** The open proposals waiting for this person's approval. */
export async function proposalsWaitingFor(user: string): Promise<RuleProposal[]> {
  const roles = await getRoles(user)
  const candidates = await sql`select distinct a.parent from change_proposal_approver a join change_proposal p on p.row_id = a.parent
    where p.app is null and p.operation is not null and p.proposal_state in ${sql(OPEN)} and p.maker <> ${user} and a.approved_by is null
      and (a.person = ${user} ${roles.length ? sql`or a.role in ${sql(roles)}` : sql``})`
  if (!candidates.length) return []
  const out: RuleProposal[] = []
  for (const proposal of await load({ ids: candidates.map(c => String(c.parent)) }))
    if (await mayDecideNow(proposal, user, roles)) out.push({ ...proposal, can_decide: true })
  return out
}

/** One proposal, for its maker, someone who may decide it, or a reader of its row. */
export async function proposalFor(id: string, user: string): Promise<RuleProposal> {
  const [proposal] = await load({ ids: [id] })
  if (!proposal) throw new AppError('NotFoundError', 'That proposal does not exist')
  const roles = await getRoles(user)
  const decides = await mayDecideNow(proposal, user, roles)
  const listed = proposal.decided_by === user
    || proposal.waiting_for.some(w => w.approved_by === user || w.people.includes(user) || w.roles.some(role => roles.includes(role)))
  if (proposal.maker === user || decides || listed) return { ...proposal, can_decide: decides }
  if (!proposal.target_row) throw new AppError('NotFoundError', 'That proposal does not exist')
  await getDoc(proposal.target_table, proposal.target_row, user)
  return { ...(await visible(proposal, user)), can_decide: false }
}

/** The proposal, locked and still open. Pre-row locks, then the row, then the proposal, as #975
 *  does: decisions on one row queue at the row. */
async function lockOpen(id: string, user: string): Promise<{ proposal: RuleProposal; meta: TableMeta; current: Row | null }> {
  const [first] = await load({ ids: [id] })
  if (!first) throw new AppError('NotFoundError', 'That proposal does not exist')
  const meta = await getMeta(first.target_table)
  let current: Row | null = null
  if (first.target_row) {
    await holdBeforeRowLock(sql, meta, user, { [meta.row_key]: first.target_row })
    const [row] = await sql`select * from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${first.target_row} for update`
    current = (row as Row | undefined) ?? null
  }
  await sql`select 1 from change_proposal where row_id = ${id} for update`
  const [proposal] = await load({ ids: [id] })
  if (!OPEN.includes(proposal.state)) throw new AppError('ValidationError', 'This has already been decided')
  if (proposal.maker === user) throw new AppError('PermissionError', 'Nobody can decide their own proposal')
  if (!(await canAct(user))) throw new AppError('PermissionError', 'This proposal is not waiting for you')
  return { proposal, meta, current }
}

async function close(id: string, state: string, user: string, fields: { reason?: string | null; result?: string | null }) {
  await sql`update change_proposal set proposal_state = ${state}, decided_by = ${user}, decided_at = now(), updated_at = now(), updated_by = ${user},
    decision_reason = ${fields.reason ?? null}, result_row = ${fields.result ?? null} where row_id = ${id}`
}

/** Send a proposal back for a fresh review against the row as it is now. Approvals given so far
 *  were for other values, so they no longer count. */
async function freshReview(proposal: RuleProposal, meta: TableMeta, current: Row, user: string, reason: string) {
  const type = (column: string) => meta.columns.find(c => c.column_name === column)?.column_type
  for (const change of proposal.changes)
    await sql`update change_proposal_column set review_base_value = ${comparable(current[change.column_name], type(change.column_name))}, updated_at = now()
      where parent = ${proposal.row_id} and column_name = ${change.column_name}`
  await sql`update change_proposal_approver set approved_by = null, approved_at = null where parent = ${proposal.row_id}`
  await sql`update change_proposal set proposal_state = 'Needs fresh review', decision_reason = ${reason}, updated_at = now(), updated_by = ${user} where row_id = ${proposal.row_id}`
}

export async function approveProposal(id: string, user: string): Promise<RuleProposal> {
  const result = await withTransaction(async () => {
    const { proposal, meta, current } = await lockOpen(id, user)
    const type = (column: string) => meta.columns.find(c => c.column_name === column)?.column_type
    if (proposal.target_row && !current) {
      await close(id, 'Rejected', user, { reason: 'The row no longer exists.' })
      return { id, applied: false }
    }
    // A value that changed since the proposal was reviewed asks for a fresh review.
    if (current && proposal.changes.some(c => comparable(current[c.column_name], type(c.column_name)) !== c.review_base_value)) {
      await freshReview(proposal, meta, current, user, 'It changed after this was asked for.')
      return { id, applied: false }
    }
    const [stored] = await sql`select proposed_values from change_proposal where row_id = ${id}`
    const values = stored.proposed_values as Row
    const columns = proposal.changes.map(c => c.column_name)
    // The rules, asked again for the maker as things are now.
    const decision = current
      ? await decideUpdate(meta, current, { ...current, ...values }, columns, proposal.maker)
      : await decide(meta, proposal.operation, values, columns, proposal.maker)
    if (decision.kind === 'refuse')
      throw new AppError('ValidationError', `The approval rules no longer let ${proposal.maker} make this change. Reject it instead.`)
    const roles = await getRoles(user)
    const approvals = new Map(proposal.waiting_for.filter(w => w.approved_by).map(w => [w.key, { by: w.approved_by!, at: w.approved_at! }]))
    const requirements = decision.kind === 'route' ? decision.requirements : proposal.waiting_for
    const meets = requirementFor(user, roles, requirements, approvals)
    if (!meets) throw new AppError('PermissionError', 'This proposal is not waiting for you')
    approvals.set(meets.key, { by: user, at: new Date() })
    // Approvals for requirements the rules no longer ask for fall away.
    for (const key of [...approvals.keys()]) if (!requirements.some(r => r.key === key)) approvals.delete(key)
    await writeRequirements(id, requirements, user, approvals)
    const done = decision.kind === 'apply' || requirements.every(r => approvals.has(r.key))
    if (!done) {
      if (proposal.state !== 'Pending') await sql`update change_proposal set proposal_state = 'Pending', updated_at = now(), updated_by = ${user} where row_id = ${id}`
      return { id, applied: false }
    }
    const saved = proposal.target_row
      ? await saveDoc(meta.name, { ...values, [ROW_KEY]: proposal.target_row, updated_at: current!.updated_at }, proposal.maker, 'upsert', { approvedProposal: id })
      : await saveDoc(meta.name, values, proposal.maker, 'insert', { approvedProposal: id })
    const rowId = String(saved[ROW_KEY])
    // History says who made it and who approved it.
    const approvers = [...approvals.values()].map(a => a.by)
    const [version] = await sql`select row_id, data from version where ref_table = ${meta.name} and ref_name = ${rowId} order by created_at desc, row_id desc limit 1`
    if (version) await sql`update version set data = ${sql.json({ ...(version.data as object), change_proposal: id, made_by: proposal.maker, approved_by: approvers })} where row_id = ${version.row_id}`
    await close(id, 'Applied', user, { result: rowId })
    // #627 Q6: other open proposals on this row that touch the same columns were reviewed against
    // values that have just changed.
    if (proposal.target_row) {
      const after = (await sql`select * from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${proposal.target_row}`)[0] as Row
      for (const other of await load({ table: meta.name, row: proposal.target_row, openOnly: true }))
        if (other.row_id !== id && other.changes.some(c => columns.includes(c.column_name)))
          await freshReview(other, meta, after, user, 'Another change to this was approved first.')
    }
    return { id, applied: true, table: meta.name, row: rowId }
  })
  return proposalFor(result.id, user)
}

export async function rejectProposal(id: string, user: string, reason: unknown): Promise<RuleProposal> {
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (!why) throw new AppError('ValidationError', 'Say why you are rejecting this', { reason: 'Required' })
  await withTransaction(async () => {
    const { proposal } = await lockOpen(id, user)
    const roles = await getRoles(user)
    if (![...proposal.waiting_for].some(r => r.people.includes(user) || r.roles.some(role => roles.includes(role))))
      throw new AppError('PermissionError', 'This proposal is not waiting for you')
    await close(id, 'Rejected', user, { reason: why })
  })
  return proposalFor(id, user)
}
