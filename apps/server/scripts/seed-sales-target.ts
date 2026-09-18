/* Seed the issue-#3755 sales-target experiment over the HTTP API of a running
 * server, exactly as an administrator would through the Admin: the
 * `Sales Target Assignment` Table, the `Sales Target Viewer` role, the four
 * local accounts test_employee_1..4 (synthetic @example.invalid emails — the
 * User Table requires one) and the initial assignments.
 *
 *   ./init.sh
 *   pnpm --filter server seed:sales-target
 *
 * Inputs (never committed): passwords from the shared .env.local named by
 * SALES_TARGET_SHARED_ENV, assignments from assignments.json beside it.
 * Idempotent: existing structure, users and rows are adopted; passwords are
 * (re)set every run so a changed .env.local takes effect.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  readSharedEnv,
  seedSalesTarget,
  sharedEnvPath,
  testPasswords,
  type AssignmentRecord,
} from '../src/sales-target'

const BASE = process.env.SERVER_URL ?? 'http://localhost:8000'
const ADMIN = process.env.ADMIN_USER ?? 'Administrator'
const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function main() {
  const envPath = sharedEnvPath()
  const passwords = testPasswords(readSharedEnv(envPath))
  const assignments = JSON.parse(
    readFileSync(process.env.SALES_TARGET_ASSIGNMENTS ?? join(dirname(envPath), 'assignments.json'), 'utf8'),
  ) as AssignmentRecord[]

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: ADMIN, pwd: ADMIN_PWD }),
  })
  if (!login.ok) throw new Error(`admin login: HTTP ${login.status}`)
  const { token } = (await login.json()) as { token: string }
  const f = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })

  const result = await seedSalesTarget(f, passwords, assignments)
  console.log(
    `sales-target seed on ${BASE}: users created ${result.users.length ? result.users.join(', ') : 'none (adopted)'}; ` +
      `assignments created ${result.assignments.length ? result.assignments.join(', ') : 'none (adopted)'}; passwords set for ${Object.keys(passwords).length} accounts`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
