import { z } from 'zod'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { appOperation, assertAppAvailable, isProvisioningApp } from './app-lifecycle'
import { getMeta, type TableMeta } from './meta'
import { saveSystemRow } from './document'
import { appDeclaresRole } from './apps'
import { tableRelation } from './table-engine'
import { permissionGrants, type PermissionGrant, type PermAction } from './permissions'
import { administrationFor, administrationApps, administrationAccessTables, administrationSources, assignmentPredicate, holdAdministrationSources, jobAssignments, type AssignmentScope } from './administration-scopes'

const reservedRoles = new Set(['Administrator', 'System Manager', 'All', 'Guest'])
const tuples = z.array(z.record(z.string().min(1), z.string().min(1)).refine(value => Object.keys(value).length > 0))
const scopeShape = z.object({ app: z.string(), mode: z.enum(['all', 'creator', 'self', 'named', 'direct_reports', 'subtree']), tuples: tuples.nullable() })
const refused = () => new AppError('PermissionError', 'No current scoped authority for this administration operation')

export async function loadScope(app: string, id: string): Promise<AssignmentScope | null> {
  const [row] = await sql`select app, mode, tuples from featherbase.scope where app = ${app} and row_id = ${id}`
  const parsed = scopeShape.safeParse(row)
  if (!parsed.success || (parsed.data.mode === 'named' && !parsed.data.tuples?.length)) return null
  return parsed.data
}

/** Structural containment, not a scan of today's Rows: a grant must remain
 * bounded when new members arrive. Relative scopes also retain their anchor. */
export function scopeContains(max: AssignmentScope, requested: AssignmentScope, samePrincipal = false): boolean {
  if (max.app !== requested.app) return false
  if (max.mode === 'all') return true
  if (max.mode !== 'named' && !(samePrincipal && (max.mode === requested.mode || max.mode === 'subtree' && requested.mode === 'direct_reports'))) return false
  if (max.mode === 'named' && !['named', 'direct_reports', 'subtree'].includes(requested.mode)) return false
  const allowed = tuples.safeParse(max.tuples ?? [])
  const wanted = tuples.safeParse(requested.tuples ?? [])
  if (!allowed.success || !wanted.success) return false
  if (!allowed.data.length) return max.mode !== 'named'
  return wanted.data.length > 0 && wanted.data.every(tuple => allowed.data.some(limit =>
    Object.entries(limit).every(([dimension, value]) => tuple[dimension] === value)))
}

export interface EffectiveAssignment {
  id: string
  role: string
  person: string
  scope: AssignmentScope
  allowFurther: boolean
  authority?: string
  boundary?: string
}

/** Re-resolve provenance on every operation. The issuing person is history;
 * authority survives that person's departure, but not its own withdrawal or
 * a narrower boundary. Cyclic/missing legacy provenance contributes nothing. */
export async function effectiveAssignments(app: string, person: string): Promise<EffectiveAssignment[]> {
  if (!administrationFor(app)) return []
  const rows = await sql`select a.* from featherbase.role_assignment a
    join installed_app i on i.name = a.app and i.enabled and not i.activation_pending
    where a.app = ${app} and a.revoked_at is null
      and (a.starts_on is null or a.starts_on <= (now() at time zone 'Asia/Kolkata')::date)
      and (a.ends_on is null or a.ends_on > (now() at time zone 'Asia/Kolkata')::date)`
  const byId = new Map(rows.map(row => [String(row.row_id), row]))
  async function resolve(id: string, seen: Set<string>): Promise<EffectiveAssignment | null> {
    const row = byId.get(id)
    if (!row || seen.has(id) || reservedRoles.has(String(row.role))) return null
    seen.add(id)
    const scope = await loadScope(app, String(row.scope))
    if (!scope) return null
    const principal = String(row.person ?? row.service_account)
    let allowFurther = row.allow_further_delegation === true
    if (row.authority || row.delegation_boundary) {
      const [boundary] = await sql`select b.*, a.scope as authority_scope from featherbase.delegation_boundary b
        join featherbase.authority a on a.row_id = b.authority and a.app = b.app and a.enabled
        where b.row_id = ${String(row.delegation_boundary)} and b.authority = ${String(row.authority)}
          and b.app = ${app} and b.action = 'grant' and b.target_role = ${String(row.role)}`
      if (!boundary) return null
      const maximum = await loadScope(app, String(boundary.max_scope))
      const authorityScope = await loadScope(app, String(boundary.authority_scope))
      if (!maximum || !authorityScope || !scopeContains(maximum, scope) || !scopeContains(authorityScope, scope)) return null
      allowFurther &&= boundary.allow_further_delegation === true
    }
    if (row.parent_assignment) {
      const parent = await resolve(String(row.parent_assignment), seen)
      if (!parent || !parent.allowFurther || parent.role !== row.role || !scopeContains(parent.scope, scope, parent.person === principal)) return null
    }
    return { id, role: String(row.role), person: principal, scope, allowFurther,
      authority: row.authority ? String(row.authority) : undefined,
      boundary: row.delegation_boundary ? String(row.delegation_boundary) : undefined }
  }
  const result: EffectiveAssignment[] = []
  for (const row of rows.filter(row => row.person === person || row.service_account === person)) {
    const assignment = await resolve(String(row.row_id), new Set())
    if (assignment) result.push(assignment)
  }
  return [...result, ...(await jobAssignments(app)).filter(job => job.person === person && !reservedRoles.has(job.role))]
}

export async function personInScope(person: string, scope: AssignmentScope, anchor: string): Promise<boolean> {
  const declaration = administrationFor(scope.app)
  const target = declaration && Object.entries(declaration.targets)[0]
  if (!target) return false
  const [result] = await sql`select ${(await assignmentPredicate(anchor, target[0], scope, { [target[1].person]: person })).frag} as allowed`
  return result.allowed === true
}

async function lockAdministration(app: string) {
  const declaration = administrationFor(app)
  const target = declaration && Object.keys(declaration.targets)[0]
  if (!target) throw refused()
  await assertAppAvailable(target)
  await holdAdministrationSources(sql, await getMeta(target))
  await assertAppAvailable(target)
}

export async function checkDelegation(user: string, app: string, action: 'grant' | 'revoke', role: string,
  person: string, requested: AssignmentScope, allowFurther = false,
  before?: { held: EffectiveAssignment[]; jobs: Awaited<ReturnType<typeof jobAssignments>>;
    recipients: Map<string, Set<string>> }): Promise<{ authority: string; boundary: string }> {
  if (reservedRoles.has(role)) throw refused()
  const held = before?.held ?? await effectiveAssignments(app, user)
  const jobs = before?.jobs ?? await jobAssignments(app)
  const boundaries = await sql`select b.*, a.scope as authority_scope, a.holder_role, a.office_job
    from featherbase.delegation_boundary b join featherbase.authority a
      on a.row_id = b.authority and a.app = b.app and a.enabled
    where b.app = ${app} and b.action = ${action} and b.target_role = ${role} order by b.row_id`
  for (const boundary of boundaries) {
    if (allowFurther && !boundary.allow_further_delegation) continue
    const maximum = await loadScope(app, String(boundary.max_scope))
    const office = await loadScope(app, String(boundary.authority_scope))
    const recipients = await loadScope(app, String(boundary.recipient_scope))
    if (!maximum || !office || !recipients || !scopeContains(maximum, requested) || !scopeContains(office, requested)) continue
    if (boundary.office_job && !jobs.some(job => job.person === user && job.job === boundary.office_job
      && scopeContains(job.scope, requested) && scopeContains(office, job.scope))) continue
    if (!held.some(grant => grant.role === boundary.required_role && scopeContains(grant.scope, requested, user === person))) continue
    if (!held.some(grant => grant.role === boundary.holder_role && scopeContains(grant.scope, requested, user === person))) continue
    const eligible = before ? recipients.mode === 'all' || before.recipients.get(String(boundary.row_id))?.has(person)
      : await personInScope(person, recipients, user)
    if (!eligible) continue
    return { authority: String(boundary.authority), boundary: String(boundary.row_id) }
  }
  throw refused()
}

/** Take this after the fixed source locks, before any hooks or Row changes.
 * The caller cannot authorize an appointment with the powers it just added. */
async function actorAuthority(app: string, user: string) {
  const membership = administrationFor(app)!.memberships
  const people = await sql`select distinct ${sql(membership.person)} as person from ${sql(await tableRelation(membership.table))}`
  const boundaries = await sql`select row_id, recipient_scope from featherbase.delegation_boundary where app = ${app}`
  const recipients = new Map<string, Set<string>>()
  for (const boundary of boundaries) {
    const scope = await loadScope(app, String(boundary.recipient_scope))
    if (!scope) continue
    const allowed = new Set<string>()
    for (const row of people) if (row.person && await personInScope(String(row.person), scope, user)) allowed.add(String(row.person))
    recipients.set(String(boundary.row_id), allowed)
  }
  return { app, user, jobs: await jobAssignments(app), held: await effectiveAssignments(app, user),
    recipients }
}

export async function captureJobAuthority(meta: TableMeta, user: string) {
  const app = meta.owner_app
  if (!app || isProvisioningApp(app) || !administrationFor(app)?.jobs || !(await administrationSources(app)).has(meta.name)) return null
  return { ...await actorAuthority(app, user), scheduled: await jobAssignments(app, true) }
}

export async function checkJobAuthority(before: Awaited<ReturnType<typeof captureJobAuthority>>) {
  if (!before) return
  const after = await jobAssignments(before.app, true)
  type Job = (typeof after)[number]
  const covers = (limit: Job, candidate: Job) => limit.id === candidate.id && limit.person === candidate.person
    && scopeContains(limit.scope, candidate.scope, true)
    && (!limit.startsOn || !!candidate.startsOn && limit.startsOn <= candidate.startsOn)
    && (!limit.endsOn || !!candidate.endsOn && limit.endsOn >= candidate.endsOn)
  for (const [action, jobs] of [['revoke', before.scheduled.filter(job => !after.some(next => covers(next, job)))],
    ['grant', after.filter(job => !before.scheduled.some(old => covers(old, job)))]] as const) {
    for (const job of jobs) await checkDelegation(before.user, before.app, action, job.role, job.person, job.scope, false, before)
  }
}

async function accessContributions(app: string) {
  const result = new Map<string, { role: string; person: string; scope: AssignmentScope }>()
  const principals = await sql`select row_id from person union select row_id from service_account`
  const targets = await sql`select distinct p.ref_table, p.operation from permission p
    join table_def t on t.name = p.ref_table where t.owner_app = ${app}`
  const identity = (grant: PermissionGrant): unknown => ({ id: grant.id, scope: grant.scope,
    assignments: grant.assignments, prerequisite: grant.prerequisite && identity(grant.prerequisite) })
  for (const principal of principals) for (const target of targets) {
    const action = (target.operation === 'update' ? 'write' : target.operation) as PermAction
    for (const grant of await permissionGrants(String(principal.row_id), String(target.ref_table), action)) {
      const scope = grant.assignments?.[0] ?? { app, mode: grant.scope === 'own_rows' ? 'creator' : 'all', tuples: null }
      for (const column of ['@row', ...grant.columns]) {
        const key = JSON.stringify([principal.row_id, target.ref_table, action, identity(grant), column])
        result.set(key, { role: grant.role, person: String(principal.row_id), scope })
      }
    }
  }
  return result
}

/** Shared role/binding edits are delegation acts for every affected holder,
 * not just permission to edit a platform configuration Row. */
export async function captureAccessAuthority(meta: TableMeta, user: string) {
  if (!administrationAccessTables.has(meta.name)) return []
  const snapshots = []
  for (const app of administrationApps()) {
    if (isProvisioningApp(app)) continue
    snapshots.push({ ...await actorAuthority(app, user), contributions: await accessContributions(app) })
  }
  return snapshots
}

export async function checkAccessAuthority(snapshots: Awaited<ReturnType<typeof captureAccessAuthority>>) {
  for (const before of snapshots) {
    const after = await accessContributions(before.app)
    for (const [action, changes, existing] of [['revoke', before.contributions, after], ['grant', after, before.contributions]] as const) {
      const checked = new Set<string>()
      for (const [key, contribution] of changes) {
        if (existing.has(key)) continue
        const signature = JSON.stringify(contribution)
        if (checked.has(signature)) continue
        await checkDelegation(before.user, before.app, action, contribution.role, contribution.person, contribution.scope, false, before)
        checked.add(signature)
      }
    }
  }
}

const grantInput = z.object({
  app: z.string().min(1), person: z.string().min(1), role: z.string().min(1), scope: z.string().min(1),
  starts_on: z.iso.date().optional(), ends_on: z.iso.date().optional(),
  parent_assignment: z.string().min(1).optional(),
  allow_further_delegation: z.boolean().default(false),
}).strict().refine(input => !input.starts_on || !input.ends_on || input.starts_on < input.ends_on)

export function grantAdministration(user: string, input: unknown) {
  const parsed = grantInput.safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', 'Expected an app, recipient, role, scope and valid optional dates')
  const args = parsed.data
  return appOperation(() => withTransaction(async () => {
    await lockAdministration(args.app)
    const [person] = await sql`select row_id from person where row_id = ${args.person} and enabled`
    if (!person || !appDeclaresRole(args.app, args.role)) throw refused()
    const scope = await loadScope(args.app, args.scope)
    if (!scope) throw refused()
    let proof: { authority: string; boundary: string }
    if (args.parent_assignment) {
      const parent = (await effectiveAssignments(args.app, user)).find(assignment => assignment.id === args.parent_assignment)
      if (!parent?.allowFurther || !parent.authority || !parent.boundary || parent.role !== args.role
        || !scopeContains(parent.scope, scope, user === args.person)) throw refused()
      const [boundary] = await sql`select recipient_scope from featherbase.delegation_boundary
        where row_id = ${parent.boundary} and app = ${args.app} and action = 'grant' and allow_further_delegation`
      const recipients = boundary && await loadScope(args.app, String(boundary.recipient_scope))
      if (!recipients || !await personInScope(args.person, recipients, user)) throw refused()
      proof = { authority: parent.authority, boundary: parent.boundary }
    } else proof = await checkDelegation(user, args.app, 'grant', args.role, args.person, scope, args.allow_further_delegation)
    return saveSystemRow('Role Assignment', { ...args, grantor: user,
      authority: proof.authority, delegation_boundary: proof.boundary }, user)
  }))
}

export function revokeAdministration(user: string, input: unknown) {
  const parsed = z.object({ assignment: z.string().min(1) }).strict().safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', 'Expected an assignment')
  return appOperation(() => withTransaction(async () => {
    const [initial] = await sql`select app from featherbase.role_assignment where row_id = ${parsed.data.assignment}`
    if (!initial) throw refused()
    await lockAdministration(String(initial.app))
    const [assignment] = await sql`select * from featherbase.role_assignment where row_id = ${parsed.data.assignment} for update`
    if (!assignment || assignment.revoked_at) throw refused()
    const scope = await loadScope(String(assignment.app), String(assignment.scope))
    if (!scope) throw refused()
    await checkDelegation(user, String(assignment.app), 'revoke', String(assignment.role),
      String(assignment.person ?? assignment.service_account), scope)
    await sql`update featherbase.role_assignment set revoked_at = now(), revoked_by = ${user},
      updated_at = now(), updated_by = ${user} where row_id = ${parsed.data.assignment}`
    return { revoked: true, assignment: parsed.data.assignment }
  }))
}
