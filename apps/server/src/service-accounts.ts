// #131: service accounts — non-human principals for automation. A service
// account is an ordinary User row (so roles, permissions, RLS, audit and
// owner columns all work unchanged) with user_type = 'service': no password,
// no session login, authenticates only through its access tokens. user_type
// is a raw column settable only here, never through the generic doc API.
import { sql } from './db'
import { AppError } from './errors'
import { saveDoc } from './document'

// A slug, not an email — 'svc-rama-installer'. The synthetic email keeps the
// User row's unique-email invariant without claiming a routable address.
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/

export interface ServiceAccount {
  name: string
  full_name: string | null
  enabled: boolean
  created_at: string
  roles: string[]
  token_count: number
}

export async function createServiceAccount(
  name: string,
  roles: string[],
  actor: string,
): Promise<ServiceAccount> {
  if (!NAME_RE.test(name))
    throw new AppError('ValidationError', 'Service account names are lowercase slugs like "svc-rama-installer"', {
      name: 'lowercase letters, digits, - and _ only (max 64 chars)',
    })
  const [existing] = await sql`select name from "user" where name = ${name}`
  if (existing) throw new AppError('ConflictError', `User ${name} already exists`)
  await saveDoc(
    'User',
    {
      name,
      email: `${name}@service.invalid`,
      full_name: name,
      enabled: true,
      ...(roles.length ? { roles: roles.map((role) => ({ role })) } : {}),
    },
    actor,
  )
  await sql`update "user" set user_type = 'service' where name = ${name}`
  return getServiceAccount(name)
}

export async function listServiceAccounts(): Promise<ServiceAccount[]> {
  return (await serviceAccountQuery()) as unknown as ServiceAccount[]
}

export async function getServiceAccount(name: string): Promise<ServiceAccount> {
  const [row] = await serviceAccountQuery(name)
  if (!row) throw new AppError('NotFoundError', `Service account ${name} not found`)
  return row as unknown as ServiceAccount
}

function serviceAccountQuery(name?: string) {
  return sql`
    select u.name, u.full_name, u.enabled, u.created_at,
      coalesce(r.roles, '{}') as roles,
      coalesce(t.n, 0)::int as token_count
    from "user" u
    left join (
      select parent, array_agg(role order by role) as roles
      from has_role group by parent
    ) r on r.parent = u.name
    left join (
      select owner, count(*) as n from access_token
      where revoked_at is null group by owner
    ) t on t.owner = u.name
    where u.user_type = 'service' ${name ? sql`and u.name = ${name}` : sql``}
    order by u.name`
}

// Disabling dead-ends every token the account owns (resolveAccessToken
// checks the owner's enabled flag) without destroying them.
export async function setServiceAccountEnabled(
  name: string,
  enabled: boolean,
  actor: string,
): Promise<ServiceAccount> {
  const [row] = await sql`
    select name, updated_at from "user" where name = ${name} and user_type = 'service'`
  if (!row) throw new AppError('NotFoundError', `Service account ${name} not found`)
  await saveDoc('User', { name, updated_at: row.updated_at, enabled }, actor)
  return getServiceAccount(name)
}
