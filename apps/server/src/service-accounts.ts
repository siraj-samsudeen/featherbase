// #131 / person-rename R2: service accounts — non-human principals for
// automation. A service account is its own kind of principal in its own table
// (`service_account`, the read-only system Table "Service Account"): no
// password, no sign-in method, no email; it authenticates only through its
// access tokens, and keeps roles, data scope and shares exactly as a person
// would through the principal pair (person / service_account). Every write
// goes through this module — the generic row API refuses the Table.
import { randomBytes } from 'node:crypto'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { newServiceAccountId } from './opaque-id'

const SERVICE_ACCOUNT_TABLE = 'Service Account'

// A slug, not an email — 'svc-rama-installer' (#131). It names the account;
// the id is minted (`svc_…`).
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/

interface ServiceAccount {
  row_id: string
  label: string
  enabled: boolean
  created_at: string
  roles: string[]
  token_count: number
}

function cleanLabel(label: unknown): string {
  const value = typeof label === 'string' ? label.trim() : ''
  if (!NAME_RE.test(value))
    throw new AppError('ValidationError', 'Service account names are lowercase slugs like "svc-rama-installer"', {
      label: 'lowercase letters, digits, - and _ only (max 64 chars)',
    })
  return value
}

async function cleanRoles(roles: string[]): Promise<string[]> {
  const unique = [...new Set(roles.map((r) => String(r).trim()).filter(Boolean))]
  if (!unique.length) return []
  const found = await sql`select row_id from role where row_id in ${sql(unique)}`
  const known = new Set(found.map((r) => String(r.row_id)))
  const missing = unique.filter((r) => !known.has(r))
  if (missing.length)
    throw new AppError('ValidationError', `Unknown role(s): ${missing.join(', ')}`, { roles: 'unknown role' })
  return unique
}

async function writeRoles(id: string, roles: string[], actor: string) {
  await sql`delete from has_role where parent = ${id} and parenttype = ${SERVICE_ACCOUNT_TABLE}`
  const now = new Date()
  for (const [i, role] of roles.entries())
    await sql`insert into has_role ${sql({
      row_id: randomBytes(5).toString('hex'),
      created_by: actor,
      updated_by: actor,
      created_at: now,
      updated_at: now,
      status: 'draft',
      position: i + 1,
      parent: id,
      parenttype: SERVICE_ACCOUNT_TABLE,
      parentfield: 'roles',
      role,
    } as unknown as Record<string, never>)}`
}

export async function createServiceAccount(label: string, roles: string[], actor: string): Promise<ServiceAccount> {
  const name = cleanLabel(label)
  const [existing] = await sql`select row_id from service_account where lower(label) = lower(${name})`
  if (existing) throw new AppError('ConflictError', `A service account named "${name}" already exists (${existing.row_id as string})`)
  const wanted = await cleanRoles(roles)
  const id = newServiceAccountId()
  await withTransaction(async () => {
    const now = new Date()
    await sql`insert into service_account ${sql({
      row_id: id,
      label: name,
      enabled: true,
      created_by: actor,
      updated_by: actor,
      created_at: now,
      updated_at: now,
      status: 'draft',
      position: 0,
    } as unknown as Record<string, never>)}`
    await writeRoles(id, wanted, actor)
  }).catch((err) => {
    // Lost a race to the same name: the unique index decides.
    if ((err as { code?: string; constraint_name?: string })?.code === '23505')
      throw new AppError('ConflictError', `A service account named "${name}" already exists`)
    throw err
  })
  await logActivity(actor, `service_account_created ${id}`)
  return getServiceAccount(id)
}

export async function listServiceAccounts(): Promise<ServiceAccount[]> {
  return (await serviceAccountQuery()) as unknown as ServiceAccount[]
}

export async function getServiceAccount(id: string): Promise<ServiceAccount> {
  const [row] = await serviceAccountQuery(id)
  if (!row) throw new AppError('NotFoundError', `Service account ${id} not found`)
  return row as unknown as ServiceAccount
}

function serviceAccountQuery(id?: string) {
  return sql`
    select s.row_id, s.label, s.enabled, s.created_at,
      coalesce(r.roles, '{}') as roles,
      -- #137: "active" must mean exactly what resolveAccessToken accepts: not
      -- revoked, not expired, AND the owner enabled.
      coalesce(case when s.enabled then t.n end, 0)::int as token_count
    from service_account s
    left join (
      select parent, array_agg(role order by role) as roles
      from has_role where parenttype = ${SERVICE_ACCOUNT_TABLE} group by parent
    ) r on r.parent = s.row_id
    left join (
      select service_account, count(*) as n from access_token
      where service_account is not null and revoked_at is null and (expires_at is null or expires_at > now())
      group by service_account
    ) t on t.service_account = s.row_id
    ${id ? sql`where s.row_id = ${id}` : sql``}
    order by lower(s.label), s.row_id`
}

async function lockAccount(id: string) {
  const [row] = await sql`select row_id from service_account where row_id = ${id} for update`
  if (!row) throw new AppError('NotFoundError', `Service account ${id} not found`)
}

// Disabling dead-ends every token the account owns (resolveAccessToken
// checks the owner's enabled flag) without destroying them.
export async function setServiceAccountEnabled(id: string, enabled: boolean, actor: string): Promise<ServiceAccount> {
  await withTransaction(async () => {
    await lockAccount(id)
    await sql`update service_account set enabled = ${enabled}, updated_at = now(), updated_by = ${actor} where row_id = ${id}`
  })
  await logActivity(actor, `service_account_${enabled ? 'enabled' : 'disabled'} ${id}`)
  return getServiceAccount(id)
}

/** The only way a service account's roles change (person-rename R2): the
 *  given list replaces the current one. */
export async function setServiceAccountRoles(id: string, roles: string[], actor: string): Promise<ServiceAccount> {
  const wanted = await cleanRoles(roles)
  await withTransaction(async () => {
    await lockAccount(id)
    await writeRoles(id, wanted, actor)
    await sql`update service_account set updated_at = now(), updated_by = ${actor} where row_id = ${id}`
  })
  await logActivity(actor, `service_account_roles ${id}: ${wanted.join(', ') || '(none)'}`.slice(0, 140))
  return getServiceAccount(id)
}
