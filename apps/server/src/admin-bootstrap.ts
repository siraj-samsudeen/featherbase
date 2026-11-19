import { environment } from './config'
import { sql } from './db'
import { hashPassword } from './auth'
import { readVariable } from './env'

// The first Administrator's password (migration 0002; #130). Only a
// developer's own machine or a test run has a knowable default; `dev` (a
// hosted trial instance) is production here. Provisioning never rotates a hash.
export function administratorBootstrapPassword(env: string = environment): string | null {
  const configured = readVariable('ADMIN_PASSWORD')
  return configured?.trim() ? configured
    : ['development', 'test'].includes(env) ? 'admin' : null
}

export async function bootstrapAdministrator(env: string = environment) {
  const password = administratorBootstrapPassword(env)
  if (password === null) return
  await sql`insert into person_credential (person_id, password_hash)
    select row_id, ${hashPassword(password)} from person where row_id = 'Administrator'
    on conflict (person_id) do nothing`
}

// The default-password warning is now the "Administrator default password"
// health check (instance-health.ts, #465 D8), printed by the release step.
export async function diagnoseAdminBootstrap(env: string = environment) {
  if (['development', 'test'].includes(env)) return
  const [ready] = await sql`select 1 from person u
    where u.enabled and exists (select 1 from person_credential c where c.person_id = u.row_id)
      and (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role = 'System Manager')) limit 1`
  if (!ready)
    console.warn('First admin bootstrap pending: no password-enabled System Manager. Administrator password login is locked when its hash is null. Run cli create-person <email> <password> --roles "System Manager", or set ADMIN_PASSWORD and deliberately run cli seed for a null Administrator hash. See docs/DEPLOY.md: First admin.')
}
