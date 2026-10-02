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
import { logAccess } from './audit'
import type { SessionUser } from './auth'
import { platformRelation } from './platform-schema'
import { tableRelation } from './table-engine'

export const ASSIGNMENT_TABLE = 'Sales Target Assignment'
export const VIEWER_ROLE = 'Sales Target Viewer'
export const REPORT_PATH = '/featherbase/sales-target'

export interface Period {
  period_start: string
  period_end: string
}

/**
 * Month to date in India Standard Time: the first of the month through today.
 * Resolved on every request, never cached — the report rolls over at IST
 * midnight on its own. SALES_TARGET_TODAY (an ISO day) pins "today" for tests,
 * demos and reproducing a reader's complaint about a past day.
 */
const isoDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The codes the Dive and the assignment Table accept: a four-digit store, a nine-digit material group. */
export const PLANT_CODE = /^\d{4}$/
export const MATERIAL_GROUP = /^\d{9}$/

export function currentPeriod(now: Date = new Date()): Period {
  const pinned = process.env.SALES_TARGET_TODAY?.trim()
  // A real calendar day or nothing: 2026-02-30 passes a shape check and then fails deep in
  // Postgres or DuckDB. A bad pin is the server's misconfiguration, so it is a 500, not a 4xx.
  if (pinned && !(isoDay(pinned) && new Date(`${pinned}T00:00:00Z`).toISOString().slice(0, 10) === pinned))
    throw new Error(`SALES_TARGET_TODAY must be a real ISO day (YYYY-MM-DD), got ${JSON.stringify(pinned)}`)
  const today = pinned || new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
  return { period_start: `${today.slice(0, 8)}01`, period_end: today }
}
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

  // #3783: the host derives an employee's sections from the Store Sections maps, which key on
  // the StyleHR employee code. A Custom Field is the framework's way to give a platform Table
  // one more attribute an app needs — no migration, no fork of User.
  const field = await f(`/api/table/${enc('Custom Field')}/${enc(EMPLOYEE_CODE_FIELD_ID)}`)
  if (field.status === 404)
    await ok(
      await f('/api/save_row', json({
        table: 'Custom Field',
        row: {
          row_id: EMPLOYEE_CODE_FIELD_ID,
          dt: 'User',
          column_name: EMPLOYEE_CODE_FIELD,
          label: 'Employee code (StyleHR)',
          column_type: 'Data',
          in_list_view: true,
        },
      })),
      'create employee_code custom field',
    )

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

/** Why a reader sees a material group. Several can hold at once; the report shows them all. */
export type ScopeBasis = 'assignment' | 'section_staff' | 'team_leader' | 'department_manager'

export interface Assignment {
  plant_code: string
  store_label: string | null
  material_groups: string[]
  /** The store Sections the reader's material groups sit in, per Section Merchandise Map (#3783); empty when no group is mapped. */
  sections: string[]
  /** Each mapped material group's Section — what the Dive groups its rows by. Unmapped groups are absent. */
  section_by_material_group: Record<string, string>
  /** Every reason this reader has a scope, sorted: an explicit row, their own subcategories, a Section they lead or manage. */
  scope_basis: ScopeBasis[]
}

/** The StyleHR employee code lives on User as a Custom Field the sales-target seed declares. */
export const EMPLOYEE_CODE_FIELD = 'employee_code'
export const EMPLOYEE_CODE_FIELD_ID = `User-${EMPLOYEE_CODE_FIELD}`

async function relationExists(name: string): Promise<boolean> {
  const [row] = await sql`select to_regclass(${platformRelation(name)}) as relation`
  return Boolean(row?.relation)
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.columns
    where table_schema = 'featherbase' and table_name = ${table} and column_name = ${column}`
  return Boolean(row)
}

interface Derived {
  plant_code: string
  material_group: string
  basis: Exclude<ScopeBasis, 'assignment'>
}

/**
 * #3783: what the Store Sections maps say this employee is responsible for, three ways —
 *  - section_staff: their own subcategories (Employee Section Map) resolved to material groups;
 *  - team_leader / department_manager: every material group of every Section that the CURRENT
 *    roster names them the TL or DM of. Section Ownership is versioned per Section: a Section's
 *    current rows are its latest effective_from on or before today (two TLs share a date), so a
 *    handover dated 06-Aug replaces that Section's July row and leaves every other Section alone.
 *    A TL's own Employee Section Map rows are a sliver of the Section they lead
 *    (2 of 90 groups for one ATK TL on 02-Oct-2026), so leadership reads the whole Section.
 * Section Ownership speaks the roster's Section names; Section Name Alias maps them onto the
 * merchandise map's. Every Table is optional: an instance without one derives nothing from it.
 */
async function derivedFromSections(user: string, today: string): Promise<Derived[]> {
  if (!(await columnExists('user', EMPLOYEE_CODE_FIELD))) return []
  if (!(await relationExists('section_merchandise_map'))) return []
  const [u] = await sql`
    select employee_code from ${sql(platformRelation('user'))} where row_id = ${user}`
  const code = u?.employee_code == null ? '' : String(u.employee_code).trim()
  if (!code) return []
  const merch = sql(platformRelation('section_merchandise_map'))
  const out: Derived[] = []

  if (await relationExists('employee_section_map')) {
    const rows = await sql`
      select distinct e.store_code as plant_code, m.material_group
      from ${sql(platformRelation('employee_section_map'))} e
      join ${merch} m
        on  m.store_code = e.store_code
        and lower(trim(m.mch_subcategory)) = lower(trim(e.subcategory))
      where e.employee_code = ${code}
        and m.material_group is not null and m.material_group <> ''`
    for (const r of rows) out.push({ plant_code: String(r.plant_code), material_group: String(r.material_group), basis: 'section_staff' })
  }

  if (await relationExists('section_ownership')) {
    const leads: [Derived['basis'], string][] = [['team_leader', 'tl_employee_code']]
    if (await columnExists('section_ownership', 'dm_employee_code')) leads.push(['department_manager', 'dm_employee_code'])
    const hasAlias = await relationExists('section_name_alias')
    const owners = sql(platformRelation('section_ownership'))
    for (const [basis, column] of leads) {
      const rows = await sql`
        with roster as (
          -- effective_from is a Date in the store-sections manifest. Read through text and
          -- parsed only when it is an ISO day: a Table that declared it Data and holds one bad
          -- cell must lose THAT row, not fail every reader's report (a cast error would), and a
          -- slash date must never be read as month-first. Blank = in force from the start.
          select o.*,
                 case when o.effective_from::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' then left(o.effective_from::text, 10)::date end as roster_from,
                 coalesce(trim(o.effective_from::text), '') = '' as roster_undated,
                 lower(trim(o.section_name)) as section_key
          from ${owners} o
        ), roster_valid as (
          select * from roster where roster_undated or (roster_from is not null and roster_from <= ${today}::date)
        ), current_roster as (
          select r.* from roster_valid r
          where coalesce(r.roster_from, date '1900-01-01') = (
            select max(coalesce(x.roster_from, date '1900-01-01')) from roster_valid x
            where x.store_code = r.store_code and x.section_key = r.section_key)
        ), roster_led as (
          select c.store_code, c.section_key from current_roster c
          where trim(c.${sql(column)}) = ${code}
        ), led as (
          -- A roster Section can span several merchandise Sections (Home Décor & Stationery is
          -- Home Décor + Stationery at ATK): every alias row counts, plus the roster name itself.
          -- Names compare trimmed and case-folded throughout, as the subcategory join does: a
          -- trailing space in one Table must not silently leave a leader with nothing.
          select store_code, section_key from roster_led
          ${hasAlias
            ? sql`union
                  select a.store_code, lower(trim(a.merch_section_name))
                  from roster_led r
                  join ${sql(platformRelation('section_name_alias'))} a
                    on a.store_code = r.store_code and lower(trim(a.roster_section_name)) = r.section_key`
            : sql``}
        )
        select distinct m.store_code as plant_code, m.material_group
        from led
        join ${merch} m on m.store_code = led.store_code and lower(trim(m.section_name)) = led.section_key
        where m.material_group is not null and m.material_group <> ''`
      for (const r of rows) out.push({ plant_code: String(r.plant_code), material_group: String(r.material_group), basis })
    }
  }
  return out
}

/** The merchandise map's Section for each group at this store — one Section per group per store. */
async function sectionsOf(plant: string, groups: string[]): Promise<Record<string, string>> {
  if (!groups.length || !(await relationExists('section_merchandise_map'))) return {}
  const rows = await sql`
    select material_group, min(section_name) as section_name
    from ${sql(platformRelation('section_merchandise_map'))}
    where store_code = ${plant} and material_group = any(${groups}::text[])
      and section_name is not null and section_name <> ''
    group by material_group`
  return Object.fromEntries(rows.map((r) => [String(r.material_group), String(r.section_name)]))
}

/**
 * The caller's CURRENT assignment, read on every call: the explicit Sales Target Assignment rows
 * plus what the Store Sections maps derive for the employee (#3783). An employee whose sections
 * are mapped needs no assignment row; an assignment row still works for a store with no map yet,
 * and adds to the derived set where both exist. One store per employee is still the rule — a
 * conflict between the two sources is refused loudly rather than mixing stores.
 */
export async function currentAssignment(user: string, period: Period = currentPeriod()): Promise<Assignment | null> {
  const explicit = await sql`
    select plant_code, store_label, material_group
    from ${sql(await tableRelation(ASSIGNMENT_TABLE))}
    where employee = ${user}
    order by material_group`
  const derived = await derivedFromSections(user, period.period_end)
  if (!explicit.length && !derived.length) return null
  const plants = new Set([...explicit.map((r) => String(r.plant_code)), ...derived.map((r) => r.plant_code)])
  if (plants.size > 1)
    throw new AppError('ValidationError', `${user} is assigned in more than one store: ${[...plants].sort().join(', ')}`)
  const plant = [...plants][0]
  // The maps are edited by the store, and the live read and the Dive both put these codes into
  // query text. Only the exact shapes the assignment Table itself enforces get through; one bad
  // cell is dropped and logged rather than allowed to break, or rewrite, anyone's report.
  if (!PLANT_CODE.test(plant)) throw new AppError('ValidationError', `${user} maps to a store code that is not four digits: ${JSON.stringify(plant)}`)
  const all = [...new Set([...explicit.map((r) => String(r.material_group)), ...derived.map((r) => r.material_group)])]
  const bad = all.filter((g) => !MATERIAL_GROUP.test(g))
  if (bad.length) console.warn(`sales-target: ${user}: ignoring ${bad.length} material group value(s) that are not nine digits: ${JSON.stringify(bad.slice(0, 5))}`)
  const groups = all.filter((g) => MATERIAL_GROUP.test(g)).sort()
  const sectionByGroup = await sectionsOf(plant, groups)
  const basis = new Set<ScopeBasis>(derived.map((r) => r.basis))
  if (explicit.length) basis.add('assignment')
  return {
    plant_code: plant,
    store_label: (explicit[0]?.store_label as string | null) ?? null,
    material_groups: groups,
    sections: [...new Set(Object.values(sectionByGroup))].sort(),
    section_by_material_group: sectionByGroup,
    scope_basis: [...basis].sort(),
  }
}

/** Exactly the Dive's useDiveState keys — nothing else rides along. */
export function initialStateFor(a: Assignment, period: Period = currentPeriod()) {
  return {
    plant_code: a.plant_code,
    material_groups: [...a.material_groups],
    section_by_material_group: { ...a.section_by_material_group },
    period_start: period.period_start,
    period_end: period.period_end,
  }
}

// ------------------------------------------------------------ embed session

export type EmbedResult =
  | { ok: true; session: string; status: number }
  // 'not_configured': DIVE_ID/DIVE_VERSION/SERVICE_ACCOUNT or the token are
  // simply absent — a deployment choice, not a failure (#3783/#286).
  // 'unreachable': the embed API was configured but the request itself
  // failed (network error, or answered but refused) — an operational
  // failure that must not be reported the same way (#284).
  | { ok: false; status: number; error: string; kind: 'not_configured' | 'unreachable' }

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
  if (!token) return { ok: false, status: 0, error: 'MOTHERDUCK_TOKEN is not set on the server', kind: 'not_configured' }
  if (!cfg.diveId || !cfg.version || !cfg.serviceAccount)
    return {
      ok: false,
      status: 0,
      error: 'DIVE_ID, DIVE_VERSION and SERVICE_ACCOUNT must be configured',
      kind: 'not_configured',
    }
  let res: Response
  try {
    res = await embedFetch(`${cfg.apiBase}/v1/dives/${encodeURIComponent(cfg.diveId)}/embed-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: cfg.serviceAccount, version: cfg.version, initial_state: initialState }),
    })
  } catch (err) {
    // Configured but unreachable — the embed API refused the TCP/TLS
    // connection or the DNS lookup failed. Distinct from missing config:
    // this is an operational failure the reader must be told about (#284).
    return {
      ok: false,
      status: 0,
      error: `embed API unreachable: ${(err as Error)?.constructor?.name ?? 'error'}`,
      kind: 'unreachable',
    }
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
  return { ok: false, status: res.status, error: `embed API answered HTTP ${res.status}: ${message}`, kind: 'unreachable' }
}

// ------------------------------------------------------------------- routes

/** Where a freshly signed-in user lands: report viewers skip the Admin. */
export async function landingFor(user: string): Promise<string | undefined> {
  return (await getRoles(user)).includes(VIEWER_ROLE) ? REPORT_PATH : undefined
}

/**
 * Fail-closed gate shared by every sales-target route (#279): a session
 * token alone is not enough, because the role can be revoked mid-session.
 * Checked fresh on every call, before any assignment is disclosed, any
 * upstream embed session is minted, or any row is read.
 */
async function requireViewerRole(user: string): Promise<void> {
  if (!(await getRoles(user)).includes(VIEWER_ROLE))
    throw new AppError('PermissionError', 'Requires the Sales Target Viewer role')
}

// Mounted under /api/sales_target, behind the session middleware in index.ts.
export const salesTargetRoutes = new Hono<{ Variables: { user: SessionUser } }>()

// Identity chrome for the report page — no amounts, no credentials.
salesTargetRoutes.get('/me', async (c) => {
  const user = c.get('user')
  await requireViewerRole(user.row_id)
  const period = currentPeriod()
  const a = await currentAssignment(user.row_id, period)
  return c.json({
    username: user.row_id,
    display_name: user.full_name ?? user.row_id,
    assignment: a,
    ...period,
    embed_origin: EMBED_ORIGIN,
  })
})

// A fresh session per call; the browser receives only the session string.
salesTargetRoutes.post('/embed_session', async (c) => {
  const user = c.get('user')
  await requireViewerRole(user.row_id)
  const period = currentPeriod()
  const a = await currentAssignment(user.row_id, period)
  if (!a || !a.material_groups.length) return c.json({ no_assignment: true })
  const r = await createEmbedSession(initialStateFor(a, period))
  // A deployment with no Dive configured is not a failure — it is a deployment
  // that serves the pre-generated report and nothing else. `kind` is the
  // server's own discriminator (#284: status 0 alone conflated this with a
  // configured-but-unreachable upstream), so it is the honest place to draw
  // the line: missing configuration answers 200 with a marker, the way
  // no_assignment does, while every other failure — unreachable or a real
  // upstream refusal — still answers 502. Showing a red "Report unavailable"
  // under a working report told the reader something was broken when nothing
  // was; the reverse — hiding a real outage behind that same quiet marker —
  // is just as wrong.
  if (!r.ok && r.kind === 'not_configured') return c.json({ not_configured: true, reason: r.error })
  if (!r.ok)
    return c.json(
      { error: { type: 'EmbedSessionError', message: r.error, upstream_status: r.status } },
      502,
    )
  return c.json({ session: r.session })
})

// The report itself, served from the dataset snapshot when one is active and
// live otherwise (openspec/changes/query-grained-dataset-snapshots). Additive:
// /me and /embed_session above are untouched, so the embedded Dive and the
// pre-generated read are two deliveries of one authorization decision.
salesTargetRoutes.get('/report', async (c) => {
  const user = c.get('user')
  await requireViewerRole(user.row_id)
  const period = currentPeriod()
  const a = await currentAssignment(user.row_id, period)
  if (!a || !a.material_groups.length) return c.json({ no_assignment: true })
  // Lazy, like reportFor: the dataset module imports currentPeriod from this file.
  const { reportFor } = await import('./sales-target-report')
  const { SALES_TARGET_DATASET } = await import('./datasets/sales-target-mtd')
  const report = await reportFor(a, period)
  // Who opened which report, served from what: the same Access Log that
  // records exports and prints (PLAT-007), so "who is looking at the sales
  // target report" is answered from the Admin like any other access question
  // (data-warehouse #3376). `method` says snapshot or live, `reference_name`
  // names the snapshot, so a complaint about a figure can be traced to the
  // exact rows that were served.
  await logAccess(user.row_id, 'view_report', {
    table: SALES_TARGET_DATASET,
    row_id: report.snapshot_id ?? undefined,
    method: report.source,
  })
  return c.json(report)
})
