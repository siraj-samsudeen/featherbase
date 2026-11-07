// #919 (piece B of #683): an app's store administration. A job gives its
// holder reach over stores, worked out fresh by the app's reach provider; a
// Permission row with scope_mode 'reach' covers only rows of those stores; a
// holder may give the app's narrower roles to people who work in their
// stores (Role Assignment). Deny by default: anything missing, invalid or
// failing reaches nothing.
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { getMeta, type TableMeta } from './meta'
import { tableRelation } from './table-engine'
import { activeApps } from './app-lifecycle'

const name = z.string().min(1)
const column = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const distinct = (values: string[]) => new Set(values).size === values.length

const target = z.object({
  /** The row's own column naming its store. */
  column: column.optional(),
  /** Or the row's person, directly or through one Reference: `employee.person`. */
  person: z.string().regex(/^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63})?$/).optional(),
  /** Rows holding one of these values are never written through reach. */
  protect: z.object({ column, values: z.array(name).min(1).refine(distinct) }).strict().optional(),
}).strict().refine(t => !!t.column !== !!t.person, 'A target names its store column or its person, not both')

export const administrationDeclaration = z.object({
  /** The server module's export under `reachProviders`. */
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  /** The Tables the provider reads, each marked decides_scope. */
  tables: z.array(name).min(1).refine(distinct),
  /** The roles the provider may answer: held only through a job. */
  jobRoles: z.array(name).min(1).refine(distinct),
  targets: z.record(name, target).refine(t => Object.keys(t).length > 0),
  /** Who works where: a current row of this Table at a store. */
  memberships: z.object({ table: name, person: column, column, startsOn: column.optional(), endsOn: column.optional() }).strict(),
  /** Per job role, the roles its holder may give. */
  delegation: z.array(z.object({ authority: name, grants: z.array(name).min(1).refine(distinct) }).strict()).default([]),
}).strict()
export type AdministrationDeclaration = z.infer<typeof administrationDeclaration>
export type Target = z.infer<typeof target>

/** Every store, or these. */
export type Stores = '*' | ReadonlySet<string>

export interface ReachAnswer { role: string; stores: '*' | string[] }
export type ReachProvider = (context: {
  readonly person: { readonly id: string; readonly email: string | null }
  readonly documents: { list(table: string, args?: Record<string, unknown>): Promise<Record<string, unknown>[]>; get(table: string, rowId: string): Promise<Record<string, unknown>> }
}) => ReachAnswer[] | Promise<ReachAnswer[]>

export interface AdministrationBinding {
  app: string
  version: string
  declaration: AdministrationDeclaration
  provide: ReachProvider
}

const bindings = new Map<string, AdministrationBinding>()

export function registerAdministration(app: string, binding: AdministrationBinding | undefined) {
  if (binding) bindings.set(app, binding)
  else bindings.delete(app)
}

export function forgetAdministrations() { bindings.clear() }

/** The app's administration, only while the app is active. */
export function administrationFor(app: string | null | undefined): AdministrationBinding | undefined {
  return app && activeApps.has(app) ? bindings.get(app) : undefined
}

/** Checked when the app's files load: everything the declaration names is
 *  the app's own and has the shape the enforcement reads. */
export function validateAdministration(manifest: {
  name: string; roles?: string[]; tables: { name: string; decides_scope?: boolean; columns: { column_name: string; column_type: string; reference_table?: string | null }[] }[]
  permissions: { table: string; role: string; scope_mode?: string }[]
}, declaration: AdministrationDeclaration | undefined) {
  const reach = manifest.permissions.filter(p => p.scope_mode === 'reach')
  if (!declaration) {
    if (reach.length) throw new Error('A permission limited to reach needs the app\'s administration declaration')
    return
  }
  const roles = new Set(manifest.roles ?? [])
  const tables = new Map(manifest.tables.map(t => [t.name, t]))
  const col = (table: string, name: string) => tables.get(table)?.columns.find(c => c.column_name === name)
  for (const role of declaration.jobRoles) if (!roles.has(role)) throw new Error(`Job role ${role} is not one of the app's roles`)
  for (const rule of declaration.delegation) {
    if (!declaration.jobRoles.includes(rule.authority)) throw new Error(`Only a job role gives roles; ${rule.authority} is not one`)
    for (const role of rule.grants) {
      if (!roles.has(role)) throw new Error(`Given role ${role} is not one of the app's roles`)
      if (declaration.jobRoles.includes(role)) throw new Error(`A job role cannot be given: ${role}`)
    }
  }
  const m = declaration.memberships
  if (!tables.has(m.table)) throw new Error('Memberships must be one of the app\'s Tables')
  if (col(m.table, m.person)?.reference_table !== 'Person') throw new Error('A membership\'s person is a Reference to Person')
  for (const c of [m.column, m.startsOn, m.endsOn]) if (c && !col(m.table, c)) throw new Error(`Memberships have no column ${c}`)
  for (const [table, t] of Object.entries(declaration.targets)) {
    if (!tables.has(table)) throw new Error(`Administration target ${table} is not one of the app's Tables`)
    if (t.column && !col(table, t.column)) throw new Error(`${table} has no column ${t.column}`)
    if (t.protect && !col(table, t.protect.column)) throw new Error(`${table} has no column ${t.protect.column}`)
    if (t.person) {
      const [first, second] = t.person.split('.')
      const link = col(table, first)
      if (!second && link?.reference_table !== 'Person') throw new Error(`${table}.${first} is not a Reference to Person`)
      if (second && (!link?.reference_table || col(link.reference_table, second)?.reference_table !== 'Person'))
        throw new Error(`${table}.${t.person} does not lead to a Person`)
    }
  }
  for (const table of declaration.tables) {
    const owned = tables.get(table)
    if (owned && !owned.decides_scope) throw new Error('The reach provider reads only Tables marked decides_scope')
  }
  const reachRoles = new Set([...declaration.jobRoles, ...declaration.delegation.flatMap(rule => rule.grants)])
  for (const p of reach) {
    if (!declaration.targets[p.table]) throw new Error(`A permission limited to reach on ${p.table} needs it among the administration targets`)
    if (!reachRoles.has(p.role)) throw new Error(`A permission limited to reach goes to a job role or a given role; ${p.role} is neither`)
  }
}

/** Today as the leaver check counts it: India's day. */
const today = () => sql`(now() at time zone 'Asia/Kolkata')::date`

type Fragment = ReturnType<typeof sql>

function currentMember(binding: AdministrationBinding, alias: string): Fragment {
  const m = binding.declaration.memberships
  const at = (c: string) => sql`${sql(alias)}.${sql(c)}` as Fragment
  let current: Fragment = sql`true`
  if (m.startsOn) current = sql`${current} and (${at(m.startsOn)} is null or ${at(m.startsOn)} <= ${today()})`
  if (m.endsOn) current = sql`${current} and (${at(m.endsOn)} is null or ${at(m.endsOn)} > ${today()})`
  return current
}

/** The stores among `stores` that `person` currently works in. */
export async function memberStores(binding: AdministrationBinding, person: string, stores: Iterable<string>): Promise<Set<string>> {
  const wanted = [...stores]
  if (!wanted.length) return new Set()
  const m = binding.declaration.memberships
  const rows = await sql`select distinct ${sql(m.column)}::text as store from ${sql(await tableRelation(m.table))} as member
    where member.${sql(m.person)} = ${person} and member.${sql(m.column)}::text in ${sql(wanted)} and ${currentMember(binding, 'member')}`
  return new Set(rows.map(row => String(row.store)))
}

const answerSchema = z.array(z.object({ role: name, stores: z.union([z.literal('*'), z.array(name)]) }).strict())

/** What the provider says the person holds through a job. Anything wrong
 *  with the answer, or a failure, is no reach at all. */
export async function jobReach(binding: AdministrationBinding, user: string): Promise<Map<string, Stores>> {
  const reach = new Map<string, Stores>()
  const [person] = await sql`select row_id, email from person where row_id = ${user} and enabled`
  if (!person) return reach
  let answer: unknown
  try {
    const { provideWithDeclaredReads } = await import('./person-scope')
    answer = await provideWithDeclaredReads({ app: binding.app, version: binding.version, tables: binding.declaration.tables },
      async documents => binding.provide(Object.freeze({ person: Object.freeze({ id: user, email: (person.email as string | null) ?? null }), documents })))
  } catch (error) {
    console.warn(`[administration] ${binding.app}'s reach provider failed for ${user}:`, error instanceof Error ? error.message : error)
    return reach
  }
  const parsed = answerSchema.safeParse(answer)
  if (!parsed.success || parsed.data.some(a => !binding.declaration.jobRoles.includes(a.role))) {
    console.warn(`[administration] ${binding.app}'s reach provider answered outside its declaration for ${user}`)
    return reach
  }
  for (const { role, stores } of parsed.data) reach.set(role, union(reach.get(role), stores === '*' ? '*' : new Set(stores)))
  return reach
}

function union(a: Stores | undefined, b: Stores): Stores {
  if (a === '*' || b === '*') return '*'
  return new Set([...(a ?? []), ...b])
}

/** The roles given to the person that reach anything today: each over the
 *  stores it names that its holder still works in. */
export async function givenReach(binding: AdministrationBinding, user: string): Promise<Map<string, Stores>> {
  const reach = new Map<string, Stores>()
  const allowed = new Set(binding.declaration.delegation.flatMap(rule => rule.grants))
  if (!allowed.size) return reach
  const rows = await sql`select role, stores from role_assignment
    where app = ${binding.app} and person = ${user} and revoked_at is null
      and (starts_on is null or starts_on <= ${today()}) and (ends_on is null or ends_on > ${today()})`
  for (const row of rows) {
    if (!allowed.has(String(row.role)) || !Array.isArray(row.stores)) continue
    const held = await memberStores(binding, user, (row.stores as unknown[]).map(String))
    if (held.size) reach.set(String(row.role), union(reach.get(String(row.role)), held))
  }
  return reach
}

/** Every role the person holds through reach, and its stores. */
export async function reachOf(app: string, user: string): Promise<Map<string, Stores>> {
  const binding = administrationFor(app)
  if (!binding) return new Map()
  const reach = await jobReach(binding, user)
  for (const [role, stores] of await givenReach(binding, user)) reach.set(role, union(reach.get(role), stores))
  return reach
}

/** The SQL test that the row under `alias` is within `stores`: for writing,
 *  also not a protected row. */
export async function reachCondition(binding: AdministrationBinding, meta: TableMeta, stores: Stores, alias: string, write: boolean): Promise<{ frag: Fragment }> {
  const t = binding.declaration.targets[meta.name]
  if (!t || meta.owner_app !== binding.app) return { frag: sql`false` }
  if (stores !== '*' && !stores.size) return { frag: sql`false` }
  const at = (c: string) => sql`${sql(alias)}.${sql(c)}` as Fragment
  let inReach: Fragment
  if (t.column) inReach = stores === '*' ? sql`true` : sql`${at(t.column)}::text in ${sql([...stores])}`
  else {
    const [first, second] = t.person!.split('.')
    let person: Fragment = at(first)
    if (second) {
      const link = meta.columns.find(c => c.column_name === first)
      const linked = await getMeta(link!.reference_table!)
      person = sql`(select reach_link.${sql(second)} from ${sql(await tableRelation(linked.name))} as reach_link
        where reach_link.${sql(linked.row_key)} = ${at(first)})`
    }
    const m = binding.declaration.memberships
    const member = sql`reach_member`
    inReach = sql`exists (select 1 from ${sql(await tableRelation(m.table))} as ${member}
      where ${member}.${sql(m.person)} = ${person} and ${currentMember(binding, 'reach_member')}
        ${stores === '*' ? sql`` : sql`and ${member}.${sql(m.column)}::text in ${sql([...stores])}`})`
  }
  if (write && t.protect)
    inReach = sql`${inReach} and (${at(t.protect.column)} is null or ${at(t.protect.column)}::text not in ${sql(t.protect.values)})`
  return { frag: inReach }
}

/** Whether one row, as given, is within `stores`. */
export async function rowWithin(binding: AdministrationBinding, meta: TableMeta, stores: Stores, row: Record<string, unknown>, write: boolean): Promise<boolean> {
  const relation = await tableRelation(meta.name)
  const values = Object.fromEntries(Object.entries(row).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof Date))
  const { frag } = await reachCondition(binding, meta, stores, 'reach_row', write)
  const [result] = await sql`select (${frag}) as ok from jsonb_populate_record(null::${sql(relation)}, ${sql.json(values as never)}) as reach_row`
  return result?.ok === true
}

const giveSchema = z.object({
  person: name,
  role: name,
  stores: z.array(name).min(1).refine(distinct),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
}).strict()

/** The job roles of `user` allowed to give `role`, with their stores. */
async function givingReach(binding: AdministrationBinding, user: string, role: string): Promise<{ through: string; stores: Stores }[]> {
  const jobs = await jobReach(binding, user)
  return binding.declaration.delegation.filter(rule => rule.grants.includes(role) && jobs.has(rule.authority))
    .map(rule => ({ through: rule.authority, stores: jobs.get(rule.authority)! }))
}

const covers = (stores: Stores, wanted: string[]) => stores === '*' || wanted.every(store => stores.has(store))

/** Give `role` to a person over `stores`. Refused unless the giver's own job
 *  role may give it, every store is in that job role's reach, the person is
 *  someone else who works in every one of them today, and the dates hold. */
export async function giveRole(app: string, giver: string, input: unknown): Promise<Record<string, unknown>> {
  const binding = administrationFor(app)
  if (!binding) throw new AppError('NotFoundError', `App ${app} gives no roles`)
  const parsed = giveSchema.safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', 'Expected { person, role, stores, starts_on?, ends_on? }')
  const { person, role, stores, starts_on, ends_on } = parsed.data
  if (starts_on && ends_on && starts_on >= ends_on) throw new AppError('ValidationError', 'A given role ends after it starts')
  return withTransaction(async () => {
    // One give at a time per person, so two gives cannot both pass the check.
    await sql`select pg_advisory_xact_lock(hashtext(${`role_assignment:${app}:${person}`}))`
    if (person === giver) throw new AppError('PermissionError', 'Nobody gives a role to themselves')
    const through = (await givingReach(binding, giver, role)).find(option => covers(option.stores, stores))
    if (!through) throw new AppError('PermissionError', `You may not give ${role} over these stores`)
    const [holder] = await sql`select 1 from person where row_id = ${person} and enabled`
    const works = holder ? await memberStores(binding, person, stores) : new Set<string>()
    if (stores.some(store => !works.has(store)))
      throw new AppError('PermissionError', 'The person must work in every store the role is given over')
    const [saved] = await sql`insert into role_assignment ${sql({
      row_id: `ra_${randomUUID()}`, created_by: giver, updated_by: giver, submission_status: 'draft', position: 0,
      app, person, role, stores: sql.json(stores) as never, starts_on: starts_on ?? null, ends_on: ends_on ?? null,
      given_by: giver, given_through: through.through,
    } as never)} returning *`
    return saved as Record<string, unknown>
  })
}

/** Take a given role back: whoever could give it over all its stores today,
 *  or a System Manager. The row stays, marked taken back. */
export async function takeBackRole(app: string, user: string, id: string): Promise<Record<string, unknown>> {
  const binding = administrationFor(app)
  if (!binding) throw new AppError('NotFoundError', `App ${app} gives no roles`)
  const { isPrivileged } = await import('./permissions')
  return withTransaction(async () => {
    const [row] = await sql`select * from role_assignment where row_id = ${id} and app = ${app} for update`
    if (!row) throw new AppError('NotFoundError', 'No such given role')
    const stores = Array.isArray(row.stores) ? (row.stores as unknown[]).map(String) : []
    const allowed = await isPrivileged(user)
      || (await givingReach(binding, user, String(row.role))).some(option => covers(option.stores, stores))
    if (!allowed) throw new AppError('PermissionError', 'You may not take this role back')
    if (row.revoked_at) return row as Record<string, unknown>
    const [saved] = await sql`update role_assignment set revoked_at = now(), revoked_by = ${user}, updated_at = now(), updated_by = ${user}
      where row_id = ${id} returning *`
    return saved as Record<string, unknown>
  })
}

/** The given roles `user` holds, gave, or could take back today. */
export async function givenRolesFor(app: string, user: string): Promise<Record<string, unknown>[]> {
  const binding = administrationFor(app)
  if (!binding) return []
  const { isPrivileged } = await import('./permissions')
  const rows = await sql`select * from role_assignment where app = ${app} order by created_at, row_id`
  if (await isPrivileged(user)) return rows as Record<string, unknown>[]
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const stores = Array.isArray(row.stores) ? (row.stores as unknown[]).map(String) : []
    if (row.person === user || row.given_by === user
      || (await givingReach(binding, user, String(row.role))).some(option => covers(option.stores, stores))) out.push(row as Record<string, unknown>)
  }
  return out
}
