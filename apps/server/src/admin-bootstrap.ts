import { environment } from './config'
import { sql } from './db'
import { hashPassword } from './auth'
import { readVariable } from './env'

// Security supersession of migration 0006 (#130). Only explicit local
// environments have a knowable default. Provisioning never rotates a hash.
// Only a developer's own machine or a test run has a knowable default;
// `staging` (a hosted trial instance) is production here.
export async function bootstrapAdministrator(env: string = environment) {
  const configured = readVariable('ADMIN_PASSWORD')
  const password = configured?.trim() ? configured
    : ['development', 'test'].includes(env) ? 'admin' : null
  if (password === null) return
  // Migration 0006 runs this long before 0101 renamed `user` to `person`.
  const [renamed] = await sql`select to_regclass('featherbase.person') as r`
  if (renamed?.r)
    await sql`update person set password_hash = ${hashPassword(password)}
      where row_id = 'Administrator' and password_hash is null`
  else
    await sql`update "user" set password_hash = ${hashPassword(password)}
      where row_id = 'Administrator' and password_hash is null`
}

// The default-password warning is now the "Administrator default password"
// health check (instance-health.ts, #465 D8), printed by the release step.
export async function diagnoseAdminBootstrap() {
  if (['development', 'test'].includes(environment)) return
  const [ready] = await sql`select 1 from person u
    where u.enabled and u.password_hash is not null
      and (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role = 'System Manager')) limit 1`
  if (!ready)
    console.warn('First admin bootstrap pending: no password-enabled System Manager. Administrator password login is locked when its hash is null. Run cli create-person <email> <password> --roles "System Manager", or set ADMIN_PASSWORD and deliberately run cli seed for a null Administrator hash. See docs/DEPLOY.md: First admin.')
}
