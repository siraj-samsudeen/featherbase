// #1282 F1–F6: the Business Roles reports grid's save. Each change says which role, which report or bundle,
// whether the grid showed it given, and whether it should be. All are checked before any is written; then
// each is written through the caller's own documents, as Give a report does: a grant to the business role,
// or that grant marked removed (its row says who gave it and who took it away, and when).
import { ROLE, every } from './business-access.ts'
import { ACCESS, managesAccess, type AccessContext } from './report-access-server.ts'
import { checked, exact, text } from './values.ts'

/** The most changes one save takes. */
const MOST_CHANGES = 200
const ONLY_MANAGERS = 'Only a Report Access Manager or a System Manager can give reports to business roles'
const GIVES = { 'dash.report': 'report', 'dash.report_bundle': 'report_bundle' } as const

type Row = Record<string, unknown>
interface Change { role: string; table: keyof typeof GIVES; key: string; from: boolean; to: boolean }

function changeOf(value: unknown): Change | string {
  const raw = (value ?? {}) as Row
  const [role, table, key] = ['role', 'table', 'key'].map(k => text(raw[k]).trim())
  if (!role || !key || !(table! in GIVES)) return 'Each change names a role and a report or a bundle'
  if (typeof raw.from !== 'boolean' || typeof raw.to !== 'boolean' || raw.from === raw.to) return 'A change gives or takes away'
  return { role: role!, table: table as Change['table'], key: key!, from: raw.from, to: raw.to }
}

export async function changeReportGrants(context: AccessContext) {
  if (!managesAccess(context)) context.reject!(ONLY_MANAGERS)
  const given = (context.payload as { changes?: unknown } | undefined)?.changes
  if (!Array.isArray(given) || given.length === 0) context.reject!('Nothing to save')
  if ((given as unknown[]).length > MOST_CHANGES) context.reject!(`Save at most ${MOST_CHANGES} changes at once`)
  const changes = (given as unknown[]).map(changeOf)
  const bad = changes.find((c): c is string => typeof c === 'string')
  if (bad) context.reject!(bad)
  const wanted = changes as Change[]

  const base = context.baseTables!
  const roles = new Map((await every(base as never, ROLE, ['role_name'])).map(r => [exact(r.row_id), text(r.role_name)]))
  // The reports and bundles as the caller may read them: one they may not read is not theirs to give.
  const docs = context.documents!
  const readable = new Set([
    ...(await docs.list('dash.report', { fields: ['report_key'], limit_page_length: 500 })).map(r => `dash.report|${exact(r.report_key)}`),
    ...(await docs.list('dash.report_bundle', { fields: ['row_id'], limit_page_length: 500 })).map(r => `dash.report_bundle|${exact(r.row_id)}`),
  ])
  const grants = (await every(base as never, ACCESS, ['report', 'report_bundle', 'business_role', 'removed', 'updated_at']))
    .filter(r => exact(r.business_role) && !checked(r.removed))
  const live = (c: Change) => grants.find(r => exact(r.business_role) === c.role && exact(r[GIVES[c.table]]) === c.key)
  const seen = new Set<string>()
  for (const change of wanted) {
    if (!roles.has(change.role)) context.reject!('Choose a business role')
    if (!readable.has(`${change.table}|${change.key}`)) context.reject!('Choose a report or a bundle you may give')
    const pair = `${change.role}|${change.table}|${change.key}`
    if (seen.has(pair)) context.reject!(`${roles.get(change.role)} is changed twice for the same report`)
    seen.add(pair)
    if (Boolean(live(change)) !== change.from)
      context.reject!(`${roles.get(change.role)}'s grant was changed since you loaded the grid; reload it and try again`)
  }

  // Written as Give a report writes: a grant's key is unique while it is given, so a second save at once is refused.
  for (const change of wanted) {
    const now = live(change)
    if (change.to) await docs.create!(ACCESS, { [GIVES[change.table]]: change.key, business_role: change.role, given_by_name: text(context.userName) || null })
    else await docs.update!(ACCESS, { row_id: exact(now!.row_id), updated_at: exact(now!.updated_at), removed: true })
  }
  return { saved: wanted.length }
}
