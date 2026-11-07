// #627: approval rules. A rule says, for one Table, which changes a maker may make and whether
// each applies at once (and is logged) or waits for approvers as a Change Proposal. Once a Table
// has an enabled rule, a change no rule covers is refused. Rules narrow what a maker's ordinary
// permissions allow; they never widen them. The check runs in the platform's one save path
// (document.ts), before any hook, so the form, list, bulk edit, import and API all obey it.
import { randomUUID } from 'node:crypto'
import { rowHref } from 'shared'
import { sql, inAppTransaction, whenTransactionEnds } from './db'
import { AppError } from './errors'
import { getMeta, ROW_KEY, type TableMeta } from './meta'
import { getRoles, sameStoredValue } from './permissions'
import { canSignInNow } from './identities'
import { tableRelation } from './table-engine'
import { mailApprovers } from './workflow'
import { isActingSystemActor } from './system-actor'
import { approvalResolver } from './approval-resolvers'

type Row = Record<string, unknown>
export type Operation = 'update' | 'create'

export interface ApprovalRule {
  row_id: string
  ref_table: string
  operations: string
  governed_columns: string[]
  row_condition: unknown[] | null
  maker_role: string | null
  maker_resolver: string | null
  outcome: 'Route to approvers' | 'Apply and log'
  approvals_needed: 'All' | 'Any'
  approvers: { role: string | null; resolver: string | null }[]
}

/** One approval the change needs: anyone among these people, or holding these roles. */
export interface Requirement { key: string; people: string[]; roles: string[] }

export type Decision =
  | { kind: 'none' }
  | { kind: 'apply'; rules: string[] }
  | { kind: 'route'; rules: string[]; requirements: Requirement[] }
  | { kind: 'refuse'; message: string; gap: boolean }

// The Approval Rule Table arrives in 0155, but earlier migrations already save rows.
let ready = false
async function rulesReady(): Promise<boolean> {
  if (ready) return true
  const [row] = await sql`select 1 as ok from information_schema.columns
    where table_schema = 'featherbase' and table_name = 'change_proposal_approver' and column_name = 'approved_by'`
  ready = Boolean(row)
  return ready
}

export const OPERATORS = new Set(['=', '!=', '>', '<', '>=', '<=', 'in', 'not in', 'like', 'not like', 'is'])
const splitColumns = (value: unknown) => String(value ?? '').split(/[\n,]/).map(part => part.trim()).filter(Boolean)
function asJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  if (!value.trim()) return null
  try { return JSON.parse(value) } catch { return value }
}

/** The enabled rules on a Table, in the order they were added. */
export async function rulesFor(table: string): Promise<ApprovalRule[]> {
  if (!(await rulesReady())) return []
  const rows = await sql`select * from approval_rule where ref_table = ${table} and enabled is true order by "position", created_at, row_id`
  if (!rows.length) return []
  const approvers = await sql`select parent, role, resolver from approval_rule_approver
    where parenttype = 'Approval Rule' and parent in ${sql(rows.map(r => String(r.row_id)))} order by "position", row_id`
  return rows.map(r => ({
    row_id: String(r.row_id),
    ref_table: String(r.ref_table),
    operations: String(r.operations ?? 'Changes and new rows'),
    governed_columns: splitColumns(r.governed_columns),
    row_condition: (asJson(r.row_condition) as unknown[] | null) ?? null,
    maker_role: (r.maker_role as string | null) || null,
    maker_resolver: (r.maker_resolver as string | null) || null,
    outcome: r.outcome === 'Apply and log' ? 'Apply and log' : 'Route to approvers',
    approvals_needed: r.approvals_needed === 'Any' ? 'Any' : 'All',
    approvers: approvers.filter(a => a.parent === r.row_id).map(a => ({ role: (a.role as string | null) || null, resolver: (a.resolver as string | null) || null })),
  }))
}

/** A value as comparable text, the way history records it: a Date column is a calendar day. */
export function comparable(value: unknown, type?: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return type === 'Date' ? value.toISOString().slice(0, 10) : value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (type === 'Check') return value === 1 || value === '1' || value === 'true' ? '1' : '0'
  const text = String(value)
  return type === 'Date' ? text.slice(0, 10) : text
}

function likeMatches(text: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'is')
  return regex.test(text)
}

/** The list filter language, held against one row in memory: a held new row is not in the Table. */
export function rowMatches(meta: TableMeta, row: Row, filters: unknown[] | null): boolean {
  if (!filters || !filters.length) return true
  return filters.every((filter) => {
    const [column, operator, value] = filter as [string, string, unknown]
    const type = column === ROW_KEY ? 'Data' : meta.columns.find(c => c.column_name === column)?.column_type
    const actual = comparable(row[column], type)
    switch (operator) {
      case '=': return actual === comparable(value, type)
      case '!=': return actual !== comparable(value, type)
      case 'is': return value === 'not set' ? actual === null : actual !== null
      case 'in': return Array.isArray(value) && value.some(v => comparable(v, type) === actual)
      case 'not in': return Array.isArray(value) && !value.some(v => comparable(v, type) === actual)
      case 'like': return actual !== null && likeMatches(actual, String(value))
      case 'not like': return actual === null || !likeMatches(actual, String(value))
      default: {
        if (actual === null || value === null || value === undefined) return false
        const numeric = ['Int', 'Float', 'Currency', 'Percent'].includes(String(type))
        const a = numeric ? Number(actual) : actual
        const b = numeric ? Number(value) : String(comparable(value, type))
        return operator === '>' ? a > b : operator === '<' ? a < b : operator === '>=' ? a >= b : a <= b
      }
    }
  })
}

/** The people a resolver names for this row. A resolver that fails, or whose app isn't running,
 *  names nobody; `strict` throws instead, so a maker condition never quietly fails to match. */
async function resolve(name: string, table: string, row: Row, strict = false): Promise<string[]> {
  const fn = approvalResolver(name)
  if (!fn) {
    if (strict) throw new RuleRefusal(`The app that says who ${name} is isn't running, so this change can't be checked`, false, table, '')
    return []
  }
  try {
    const people = await fn(table, row)
    return Array.isArray(people) ? [...new Set(people.filter((p): p is string => typeof p === 'string' && p.length > 0))] : []
  } catch (error) {
    console.warn(`[approval rules] resolver ${name} failed for ${table}:`, error instanceof Error ? error.message : error)
    // A failed maker condition must not let a broader rule apply the change instead.
    if (strict) throw new RuleRefusal(`Who ${name} is could not be worked out, so this change can't be checked`, false, table, '')
    return []
  }
}

async function makerMatches(rule: ApprovalRule, maker: string, roles: string[], table: string, row: Row): Promise<boolean> {
  if (rule.maker_role && !roles.includes(rule.maker_role)) return false
  if (rule.maker_resolver && !(await resolve(rule.maker_resolver, table, row, true)).includes(maker)) return false
  return true
}

const covers = (rule: ApprovalRule, operation: Operation) =>
  rule.operations === 'Changes and new rows' || (operation === 'update' ? rule.operations === 'Changes' : rule.operations === 'New rows')

/** People who can act on a proposal: enabled, with a working way in. Never the maker. */
async function eligible(people: string[], maker: string): Promise<string[]> {
  const others = people.filter(person => person !== maker)
  if (!others.length) return []
  const enabled = (await sql`select row_id from person where enabled and row_id in ${sql(others)} order by row_id`).map(r => String(r.row_id))
  const out: string[] = []
  for (const person of enabled) if (await canSignInNow(person)) out.push(person)
  return out
}

async function roleHolders(roles: string[], maker: string): Promise<string[]> {
  if (!roles.length) return []
  const holders = await sql`select distinct p.row_id from has_role r join person p on p.row_id = r.parent
    where r.parenttype = 'Person' and r.role in ${sql(roles)} and p.enabled and p.row_id <> ${maker} order by p.row_id`
  return eligible(holders.map(h => String(h.row_id)), maker)
}

/** Who must approve, rule by rule: "all" needs one person per approver it names, "any" one person
 *  among them. Null when some approval could only come from the maker or from nobody. */
async function requirementsFor(rules: ApprovalRule[], maker: string, table: string, row: Row): Promise<Requirement[] | null> {
  const requirements: Requirement[] = []
  for (const rule of rules) {
    const slots: Requirement[] = []
    for (const [index, approver] of rule.approvers.entries()) {
      const people = approver.resolver ? await eligible(await resolve(approver.resolver, table, row), maker) : []
      const roles = approver.role ? [approver.role] : []
      slots.push({ key: `${rule.row_id}:${index}`, people, roles })
    }
    if (!slots.length) return null
    if (rule.approvals_needed === 'Any') {
      requirements.push({ key: `${rule.row_id}:any`, people: [...new Set(slots.flatMap(s => s.people))], roles: [...new Set(slots.flatMap(s => s.roles))] })
    } else requirements.push(...slots)
  }
  // Each approval must be possible from someone other than the maker, and "all" needs as many
  // different people as approvals.
  const everyone = new Set<string>()
  for (const requirement of requirements) {
    const reachable = [...requirement.people, ...(await roleHolders(requirement.roles, maker))]
    if (!reachable.length) return null
    for (const person of reachable) everyone.add(person)
  }
  if (everyone.size < requirements.length) return null
  return requirements
}

/** What happens to a maker's change to `row` (the stored row, or the new row for a create). */
export async function decide(meta: TableMeta, operation: Operation, row: Row, changed: string[], maker: string): Promise<Decision> {
  const rules = await rulesFor(meta.name)
  if (!rules.length) return { kind: 'none' }
  const roles = await getRoles(maker)
  const matching: ApprovalRule[] = []
  for (const rule of rules) {
    if (!covers(rule, operation)) continue
    if (operation === 'update' && rule.governed_columns.length && !changed.some(column => rule.governed_columns.includes(column))) continue
    if (!rowMatches(meta, row, rule.row_condition)) continue
    if (await makerMatches(rule, maker, roles, meta.name, row)) matching.push(rule)
  }
  if (!matching.length)
    return { kind: 'refuse', gap: true, message: `No approval rule covers this ${operation === 'create' ? 'new row in' : 'change to'} ${meta.label ?? meta.name}` }
  // Approval beats apply: any matching rule that routes wins over one that applies at once.
  const routing = matching.filter(rule => rule.outcome === 'Route to approvers')
  if (!routing.length) return { kind: 'apply', rules: matching.map(rule => rule.row_id) }
  const requirements = await requirementsFor(routing, maker, meta.name, row)
  if (!requirements) return { kind: 'refuse', gap: false, message: 'Nobody else can approve this change, so it cannot be made' }
  return { kind: 'route', rules: routing.map(rule => rule.row_id), requirements }
}

/** A change is judged on the row as it is and as it would be: moving a shelf from site A to site
 *  B needs what both sites' rules ask. Either refusing refuses it; either routing routes it to
 *  everyone either names, an approval asked for twice by the same people counted once. */
export async function decideUpdate(meta: TableMeta, before: Row, after: Row, changed: string[], maker: string): Promise<Decision> {
  const now = await decide(meta, 'update', before, changed, maker)
  if (now.kind === 'none' || now.kind === 'refuse') return now
  const then = await decide(meta, 'update', after, changed, maker)
  if (then.kind === 'none' || then.kind === 'refuse') return then
  const rules = [...new Set([...now.rules, ...then.rules])]
  const requirements = [...(now.kind === 'route' ? now.requirements : [])]
  const same = (a: Requirement, b: Requirement) => a.key === b.key && JSON.stringify([a.people, a.roles]) === JSON.stringify([b.people, b.roles])
  for (const requirement of then.kind === 'route' ? then.requirements : [])
    if (!requirements.some(r => same(r, requirement))) requirements.push(requirements.some(r => r.key === requirement.key) ? { ...requirement, key: `${requirement.key}:after` } : requirement)
  return requirements.length ? { kind: 'route', rules, requirements } : { kind: 'apply', rules }
}

/** Whether this save is checked at all: the platform's own trusted writes, background system
 *  actors and the built-in Administrator account are not; every person is, whatever their roles. */
export function isChecked(user: string, opts: { skipPermissions?: boolean; approvedProposal?: string }): boolean {
  return !opts.skipPermissions && !opts.approvedProposal && user !== 'Administrator' && !isActingSystemActor(user)
}

/** The columns a save changes, by value, among the Table's own columns. */
export function changedColumns(meta: TableMeta, before: Row, values: Row): string[] {
  return meta.columns.filter(column => !['Sub-table', 'Section Break', 'Column Break', 'Tab Break'].includes(column.column_type)
    && Object.hasOwn(values, column.column_name)
    && !sameStoredValue(column.column_type, values[column.column_name], before[column.column_name]))
    .map(column => column.column_name)
}

export class RuleRefusal extends AppError {
  constructor(message: string, readonly gap: boolean, readonly table: string, readonly maker: string) {
    super('PermissionError', message)
  }
}

export interface HeldChange { proposal: string; state: 'Pending'; waiting_for: Requirement[]; repeated?: boolean }

async function writeRequirements(id: string, requirements: Requirement[], actor: string, approvals: Map<string, { by: string; at: Date }> = new Map()) {
  await sql`delete from change_proposal_approver where parent = ${id}`
  let position = 0
  for (const requirement of requirements) {
    const done = approvals.get(requirement.key)
    const entries = [...requirement.people.map(person => ({ person, role: null })), ...requirement.roles.map(role => ({ person: null, role }))]
    for (const entry of entries)
      await sql`insert into change_proposal_approver ${sql({ row_id: randomUUID(), created_by: actor, updated_by: actor, position: position++, parent: id,
        parenttype: 'Change Proposal', parentfield: 'approvers', requirement: requirement.key, approved_by: done?.by ?? null, approved_at: done?.at ?? null,
        ...entry } as unknown as Record<string, never>)}`
  }
}

/** Hold a change as a Change Proposal, inside the save's transaction. The row is not touched. */
export async function holdChange(meta: TableMeta, operation: Operation, target: string | null, before: Row | null, values: Row,
  changed: string[], maker: string, requirements: Requirement[]): Promise<HeldChange> {
  // The same change asked for again (a second click, a re-save) is the proposal already waiting.
  const [same] = await sql`select row_id from change_proposal where app is null and maker = ${maker} and target_table = ${meta.name}
    and ${target === null ? sql`target_row is null` : sql`target_row = ${target}`} and operation = ${operation}
    and proposal_state = 'Pending' and proposed_values = ${sql.json(values as never)}::jsonb limit 1`
  if (same) return { proposal: String(same.row_id), state: 'Pending', waiting_for: requirements, repeated: true }
  const id = randomUUID().replaceAll('-', '').slice(0, 10)
  await sql`insert into ${sql(await tableRelation('Change Proposal'))} ${sql({ row_id: id, created_by: maker, updated_by: maker, submission_status: 'draft', position: 0,
    app: null, target_table: meta.name, target_row: target, maker, proposal_state: 'Pending', operation,
    proposed_values: sql.json(values as never) } as unknown as Record<string, never>)}`
  const type = (column: string) => meta.columns.find(c => c.column_name === column)?.column_type
  for (const [position, column] of changed.entries()) {
    const original = before ? comparable(before[column], type(column)) : null
    await sql`insert into change_proposal_column ${sql({ row_id: randomUUID(), created_by: maker, updated_by: maker, position, parent: id,
      parenttype: 'Change Proposal', parentfield: 'changes', column_name: column, original_value: original,
      proposed_value: comparable(values[column], type(column)), review_base_value: original } as unknown as Record<string, never>)}`
  }
  await writeRequirements(id, requirements, maker)
  return { proposal: id, state: 'Pending', waiting_for: requirements }
}

async function personName(id: string): Promise<string> {
  const [person] = await sql`select full_name, email from person where row_id = ${id}`
  return String(person?.full_name || person?.email || id)
}

/** Email who can approve, through the same approval mail a workflow state sends. */
export async function mailProposal(proposal: string, table: string, target: string | null, maker: string, requirements: Requirement[], repeated = false) {
  if (repeated) return
  try {
    const people = new Set<string>()
    for (const requirement of requirements) {
      for (const person of requirement.people) people.add(person)
      for (const holder of await roleHolders(requirement.roles, maker)) people.add(holder)
    }
    people.delete(maker)
    const subject = target ? `${table} ${target}` : `a new ${table} row`
    await mailApprovers([...people], {
      subject: `Approval required: ${subject}`,
      body: `${await personName(maker)} proposed ${target ? `a change to ${subject}` : subject}. It waits for your approval.\n\nAvailable actions: Approve, Reject\nOpen it: ${target ? rowHref(table, target) : `/featherbase/admin/approvals?proposal=${encodeURIComponent(proposal)}`}`,
      ref_table: target ? table : 'Change Proposal',
      reference_name: target ?? proposal,
    })
  } catch (error) {
    console.error(`[approval rules] proposal ${proposal}: approvers not emailed:`, error)
  }
}

/** Tell System Managers about a change no rule covers, at most once an hour per Table. Sent
 *  after the refused save's transaction ends, so the refusal's rollback can't take it back. */
export function noticeGap(refusal: RuleRefusal): Promise<void> | void {
  const send = async () => {
    try {
      const managers = await sql`select distinct p.row_id from has_role r join person p on p.row_id = r.parent
        where r.parenttype = 'Person' and r.role = 'System Manager' and p.enabled order by p.row_id`
      const subject = `No approval rule covers a change to ${refusal.table}`
      const [recent] = await sql`select 1 from email_queue where subject = ${subject} and created_at > now() - interval '1 hour' limit 1`
      if (recent) return
      await mailApprovers(managers.map(m => String(m.row_id)).filter(person => person !== refusal.maker), {
        subject,
        body: `${await personName(refusal.maker)} tried to change ${refusal.table}, and no approval rule covers that change, so it was refused.\n\n${refusal.message}.\nIf they should be able to make it, add or adjust an approval rule for ${refusal.table} in Admin.`,
        ref_table: 'Approval Rule',
        reference_name: refusal.table,
      })
    } catch (error) {
      console.error(`[approval rules] gap notice for ${refusal.table} not sent:`, error)
    }
  }
  if (inAppTransaction()) whenTransactionEnds(() => { void send() })
  else return send()
}

export { writeRequirements }
