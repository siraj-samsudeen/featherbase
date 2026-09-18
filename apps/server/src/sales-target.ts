// Personalised sales-target report host — issue JeyaramaGroup/data-warehouse#3755,
// candidate A. One Table (`Sales Target Assignment`) holds who owns which
// store–subcategory pair; on every report opening the server reads the caller's
// rows and mints a fresh MotherDuck embed session with that assignment as the
// Dive's starting state. The creation token (MOTHERDUCK_TOKEN) is read from
// process.env on the server and never returned, logged or stored.
//
// Grain of the assignment Table: one row per (plant_code, material_group);
// `store_subcategory` is that pair as a single unique column, populated by the
// controller in src/controllers/sales-target-assignment.ts, so the database
// itself refuses a second employee on the same pair. Transfers are ordinary
// row edits (change `employee`), read at request time — no cache, no restart.
import { existsSync, readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { getRoles } from './permissions'
import type { SessionUser } from './auth'

export const ASSIGNMENT_TABLE = 'Sales Target Assignment'
export const VIEWER_ROLE = 'Sales Target Viewer'
export const REPORT_PATH = '/sales-target'
// Fixed experiment period (issue #3755): not a production calendar.
export const PERIOD = { period_start: '2026-09-01', period_end: '2026-09-17' } as const
// The sandbox origin the page frames and the CSP allows. Overridable only so
// a browser-level test can point both at a local stub; the page never
// chooses it — the server hands it out with the identity chrome.
export const EMBED_ORIGIN = (process.env.MOTHERDUCK_EMBED_ORIGIN ?? 'https://embed-motherduck.com').replace(/\/+$/, '')

// The shared experiment inputs live in the sibling data-warehouse checkout;
// SALES_TARGET_SHARED_ENV names the gitignored .env.local that holds the
// test passwords, DIVE_ID, DIVE_VERSION and SERVICE_ACCOUNT.
export const DEFAULT_SHARED_ENV =
  '/home/user/data-warehouse/experiments/issue_3755/shared/.env.local'

export function sharedEnvPath(): string {
  return process.env.SALES_TARGET_SHARED_ENV ?? DEFAULT_SHARED_ENV
}

/** KEY=VALUE lines of the shared .env.local; {} when the file is absent. */
export function readSharedEnv(path = sharedEnvPath()): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export interface EmbedConfig {
  apiBase: string
  diveId: string
  version: number
  serviceAccount: string
}

// Process environment first (a deployment sets these outright), the shared
// .env.local second (this experiment). The token is NEVER read from a file.
export function embedConfig(): EmbedConfig {
  const shared = readSharedEnv()
  const pick = (key: string) => process.env[key] ?? shared[key] ?? ''
  return {
    apiBase: (process.env.MOTHERDUCK_API_BASE ?? 'https://api.motherduck.com').replace(/\/+$/, ''),
    diveId: pick('DIVE_ID'),
    version: Number(pick('DIVE_VERSION') || 0),
    serviceAccount: pick('SERVICE_ACCOUNT'),
  }
}

// ---------------------------------------------------------------- accounts

export interface TestAccount {
  username: string
  display_name: string
  /** Synthetic — Featherbase's User requires an email; real staff need not have one. */
  email: string
}

export const TEST_ACCOUNTS: TestAccount[] = [1, 2, 3, 4].map((n) => ({
  username: `test_employee_${n}`,
  display_name: `Employee ${n}`,
  email: `test_employee_${n}@example.invalid`,
}))

export interface AssignmentRecord {
  username: string
  display_name: string
  plant_code: string
  store_label: string
  material_groups: string[]
}

/** Four employee passwords keyed by username, from TEST_EMPLOYEE_N_PASSWORD. */
export function testPasswords(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [i, a] of TEST_ACCOUNTS.entries()) {
    const pw = env[`TEST_EMPLOYEE_${i + 1}_PASSWORD`]
    if (pw) out[a.username] = pw
  }
  return out
}

// ------------------------------------------------------------------ seeding

/** The subset of a client the seed needs: an authenticated fetch. */
export type SeedFetch = (path: string, init?: RequestInit) => Promise<Response>

const ASSIGNMENT_TABLE_DEF = {
  name: ASSIGNMENT_TABLE,
  module: 'Sales Target',
  columns: [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
    { column_name: 'plant_code', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'store_label', column_type: 'Data', in_list_view: true },
    { column_name: 'material_group', column_type: 'Data', reqd: true, in_list_view: true },
    // Set by the controller from plant_code + material_group; unique makes one
    // employee per store–subcategory pair a database fact, not a convention.
    { column_name: 'store_subcategory', column_type: 'Data', unique: true, read_only: true, in_list_view: true },
  ],
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`)
  return res
}

/**
 * Idempotently create the Table, the role, the four accounts (with the given
 * passwords) and the initial assignment rows — through the public API only,
 * so the same code runs over HTTP (scripts/seed-sales-target.ts) and inside
 * a sandboxed test (`admin.fetch`). Rows already present are left alone.
 */
export async function seedSalesTarget(
  f: SeedFetch,
  passwords: Record<string, string>,
  assignments: AssignmentRecord[],
): Promise<{ users: string[]; assignments: string[] }> {
  const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
  const enc = encodeURIComponent
  const meta = await f(`/api/table/${enc(ASSIGNMENT_TABLE)}:meta`)
  if (meta.status === 404) await ok(await f('/api/table_def', json(ASSIGNMENT_TABLE_DEF)), 'create table')
  else await ok(meta, 'read table meta')

  const role = await f(`/api/table/Role/${enc(VIEWER_ROLE)}`)
  if (role.status === 404)
    await ok(await f('/api/save_row', json({ table: 'Role', row: { row_id: VIEWER_ROLE } })), 'create role')

  const users: string[] = []
  for (const a of TEST_ACCOUNTS) {
    const password = passwords[a.username]
    if (!password) throw new Error(`no password configured for ${a.username}`)
    const existing = await f(`/api/table/User/${enc(a.username)}`)
    if (existing.status === 404) {
      await ok(
        await f('/api/save_row', json({
          table: 'User',
          row: { row_id: a.username, email: a.email, full_name: a.display_name, enabled: true, roles: [{ role: VIEWER_ROLE }] },
        })),
        `create ${a.username}`,
      )
      users.push(a.username)
    }
    await ok(await f('/api/set_password', json({ user: a.username, password })), `set password ${a.username}`)
  }

  const created: string[] = []
  for (const r of assignments) {
    for (const code of r.material_groups) {
      const key = `${r.plant_code}/${code}`
      const filters = enc(JSON.stringify([['store_subcategory', '=', key]]))
      const list = (await (await ok(
        await f(`/api/table/${enc(ASSIGNMENT_TABLE)}?filters=${filters}&fields=${enc('["row_id"]')}`),
        'list assignments',
      )).json()) as { data: unknown[] }
      if (list.data.length) continue
      await ok(
        await f('/api/save_row', json({
          table: ASSIGNMENT_TABLE,
          row: { employee: r.username, plant_code: r.plant_code, store_label: r.store_label, material_group: code },
        })),
        `assign ${key} to ${r.username}`,
      )
      created.push(key)
    }
  }
  return { users, assignments: created }
}

// --------------------------------------------------------------- assignment

export interface Assignment {
  plant_code: string
  store_label: string | null
  material_groups: string[]
}

/** The caller's CURRENT assignment, read from the Table on every call. */
export async function currentAssignment(user: string): Promise<Assignment | null> {
  const rows = await sql`
    select plant_code, store_label, material_group
    from sales_target_assignment
    where employee = ${user}
    order by material_group`
  if (!rows.length) return null
  const plants = new Set(rows.map((r) => String(r.plant_code)))
  if (plants.size > 1)
    throw new AppError('ValidationError', `${user} is assigned in more than one store: ${[...plants].join(', ')}`)
  return {
    plant_code: String(rows[0].plant_code),
    store_label: (rows[0].store_label as string | null) ?? null,
    material_groups: rows.map((r) => String(r.material_group)),
  }
}

/** Exactly the Dive's useDiveState keys — nothing else rides along. */
export function initialStateFor(a: Assignment) {
  return {
    plant_code: a.plant_code,
    material_groups: [...a.material_groups],
    period_start: PERIOD.period_start,
    period_end: PERIOD.period_end,
  }
}

// ------------------------------------------------------------ embed session

export type EmbedResult =
  | { ok: true; session: string; status: number }
  | { ok: false; status: number; error: string }

// Injectable for the sandboxed suite (no network); MOTHERDUCK_API_BASE
// redirects the real fetch for browser-level stub runs.
let embedFetch: typeof fetch = (...args) => fetch(...args)
export function _setEmbedFetch(f: typeof fetch | null) {
  embedFetch = f ?? ((...args) => fetch(...args))
}

export async function createEmbedSession(
  initialState: ReturnType<typeof initialStateFor>,
  cfg: EmbedConfig = embedConfig(),
): Promise<EmbedResult> {
  const token = process.env.MOTHERDUCK_TOKEN
  if (!token) return { ok: false, status: 0, error: 'MOTHERDUCK_TOKEN is not set on the server' }
  if (!cfg.diveId || !cfg.version || !cfg.serviceAccount)
    return { ok: false, status: 0, error: 'DIVE_ID, DIVE_VERSION and SERVICE_ACCOUNT must be configured' }
  let res: Response
  try {
    res = await embedFetch(`${cfg.apiBase}/v1/dives/${encodeURIComponent(cfg.diveId)}/embed-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: cfg.serviceAccount, version: cfg.version, initial_state: initialState }),
    })
  } catch (err) {
    return { ok: false, status: 0, error: `embed API unreachable: ${(err as Error)?.constructor?.name ?? 'error'}` }
  }
  const text = await res.text()
  type UpstreamBody = { session?: unknown; message?: unknown; code?: unknown }
  let body: UpstreamBody | null = null
  try {
    body = JSON.parse(text) as UpstreamBody
  } catch {
    /* not JSON */
  }
  if (res.ok && body && typeof body.session === 'string') return { ok: true, session: body.session, status: res.status }
  const message = String(body?.message ?? body?.code ?? text.slice(0, 200))
  return { ok: false, status: res.status, error: `embed API answered HTTP ${res.status}: ${message}` }
}

// ------------------------------------------------------------------- routes

/** Where a freshly signed-in user lands: report viewers skip the Admin. */
export async function landingFor(user: string): Promise<string | undefined> {
  return (await getRoles(user)).includes(VIEWER_ROLE) ? REPORT_PATH : undefined
}

// Mounted under /api/sales_target, behind the session middleware in index.ts.
export const salesTargetRoutes = new Hono<{ Variables: { user: SessionUser } }>()

// Identity chrome for the report page — no amounts, no credentials.
salesTargetRoutes.get('/me', async (c) => {
  const user = c.get('user')
  const a = await currentAssignment(user.row_id)
  return c.json({
    username: user.row_id,
    display_name: user.full_name ?? user.row_id,
    assignment: a,
    ...PERIOD,
    embed_origin: EMBED_ORIGIN,
  })
})

// A fresh session per call; the browser receives only the session string.
salesTargetRoutes.post('/embed_session', async (c) => {
  const user = c.get('user')
  const a = await currentAssignment(user.row_id)
  if (!a || !a.material_groups.length) return c.json({ no_assignment: true })
  const r = await createEmbedSession(initialStateFor(a))
  if (!r.ok)
    return c.json(
      { error: { type: 'EmbedSessionError', message: r.error, upstream_status: r.status } },
      502,
    )
  return c.json({ session: r.session })
})
