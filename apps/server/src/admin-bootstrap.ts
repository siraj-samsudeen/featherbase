import { environment } from './config'
import { sql, withTransaction } from './db'
import { hashPassword, verifyPassword } from './auth'

// Security supersession of migration 0006 (#130). Only explicit local
// environments have a knowable default. Provisioning never rotates a hash.
export async function bootstrapAdministrator() {
  const configured = process.env.ADMIN_PASSWORD
  const password = configured?.trim() ? configured
    : ['development', 'test'].includes(environment) ? 'admin' : null
  if (password === null) return
  await withTransaction(async () => {
    // Migration 0083 invokes this before user_type and native eligibility exist.
    const [policy] = await sql`select 1 from information_schema.columns
      where table_schema = 'featherbase' and table_name = 'user' and column_name = 'native_login_enabled'`
    const [provisioned] = await sql`update "user" set password_hash = ${hashPassword(password)}
      where row_id = 'Administrator' and password_hash is null
        ${policy ? sql`and user_type <> 'service'` : sql``} returning row_id`
    if (!provisioned) return
    // @spec native_login_requires_an_enabled_native_method
    if (policy) await sql`update "user" set native_login_enabled = true where row_id = 'Administrator'`
  })
}

export async function diagnoseAdminBootstrap() {
  if (['development', 'test'].includes(environment)) return
  const [admin] = await sql`select password_hash from "user" where row_id = 'Administrator'`
  if (admin?.password_hash && verifyPassword('admin', admin.password_hash))
    console.warn('SECURITY: Administrator known default password remains active. Rotate it explicitly through the password UI before exposing this deployment. ADMIN_PASSWORD and cli seed never overwrite an existing hash. See docs/DEPLOY.md: First admin.')
  const [ready] = await sql`select 1 from "user" u
    where u.enabled and u.user_type <> 'service' and u.password_hash is not null
      and (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role = 'System Manager')) limit 1`
  if (!ready)
    console.warn('First admin bootstrap pending: no password-enabled System Manager. Administrator password login is locked when its hash is null. Run cli create-user <email> <password> --roles "System Manager", or set ADMIN_PASSWORD and deliberately run cli seed for a null Administrator hash. See docs/DEPLOY.md: First admin.')
}
