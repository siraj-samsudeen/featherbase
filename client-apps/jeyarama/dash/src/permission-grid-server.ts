// #1282 F1–F6: the Business Roles grid's save. Each change says which role, which permission
// (app · level · verb · thing), its reach as the grid showed it and the reach it should have
// (null: the role cannot do it). All are checked before any is written; then each is written
// through the caller's own documents, so the platform's grants decide, and logged one line each.
// Taking a permission away marks its row removed, as a hand change is (#1218: no delete).
import { PERMISSION, ROLE, every } from './business-access.ts'
import { REACHES } from './business-roles.ts'
import { type AccessContext } from './report-access-server.ts'
import { checked, exact, text } from './values.ts'

export const PERMISSION_CHANGE = 'dash.permission_change'
/** The most changes one save takes: a grid of 40 × 40 is more than anyone reviews at once. */
const MOST_CHANGES = 200
const ONLY_MANAGERS = 'Only a System Manager can change what a business role can do'

type Row = Record<string, unknown>
interface Change { role: string; app: string; level: string; verb: string; thing: string; from: string | null; to: string | null }

/** Whether the caller may change business roles' permissions (Siraj, 19-Nov-2026): a System Manager, as platform rule #437
 *  makes every scope-deciding Table System Manager work. The grid is read-only for anyone else. */
export const mayChangePermissions = (context: AccessContext) => (context.roles ?? []).includes('System Manager')

const reachOrNone = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' && (REACHES as readonly string[]).includes(value) ? value : undefined

/** One change from the payload, or why it cannot be one. */
function changeOf(value: unknown): Change | string {
  const raw = (value ?? {}) as Row
  const [role, app, level, verb, thing] = ['role', 'app', 'level', 'verb', 'thing'].map(k => text(raw[k]).trim())
  if (!role || !app || !level || !verb || !thing) return 'Each change names a role and a permission'
  const [from, to] = [reachOrNone(raw.from), reachOrNone(raw.to)]
  if (from === undefined || to === undefined) return 'A reach is Own, Team, Area or All, or none'
  if (from === to) return 'A change changes the reach'
  return { role, app, level, verb, thing, from, to }
}

const permissionKey = (p: { app: string; level: string; verb: string; thing: string }) => JSON.stringify([p.app, p.level, p.verb, p.thing])
const label = (c: Change) => `${c.app} · ${c.level} · ${c.verb} ${c.thing}`

export async function changePermissions(context: AccessContext) {
  if (!mayChangePermissions(context)) context.reject!(ONLY_MANAGERS)
  const given = (context.payload as { changes?: unknown } | undefined)?.changes
  if (!Array.isArray(given) || given.length === 0) context.reject!('Nothing to save')
  if ((given as unknown[]).length > MOST_CHANGES) context.reject!(`Save at most ${MOST_CHANGES} changes at once`)
  const changes = (given as unknown[]).map(changeOf)
  const bad = changes.find((c): c is string => typeof c === 'string')
  if (bad) context.reject!(bad)
  const wanted = changes as Change[]

  // Read as the app: the roles, and every permission row, so a stale grid or an invented permission is refused whole.
  const base = context.baseTables!
  // Every page of each (Codex standard round 1: one list read stops at the platform's 500 rows), as businessModel reads them.
  const roles = new Map((await every(base as never, ROLE, ['role_name'])).map(r => [exact(r.row_id), text(r.role_name)]))
  const rows = await every(base as never, PERMISSION, ['business_role', 'app', 'level', 'verb', 'thing', 'reach', 'removed', 'updated_at'])
  const known = new Set(rows.filter(r => !checked(r.removed)).map(r => permissionKey({ app: text(r.app), level: text(r.level), verb: text(r.verb), thing: text(r.thing) })))
  const seen = new Set<string>()
  for (const change of wanted) {
    if (!roles.has(change.role)) context.reject!('Choose a business role')
    if (!known.has(permissionKey(change))) context.reject!(`${label(change)} is not a permission any business role has`)
    const pair = `${change.role}|${permissionKey(change)}`
    if (seen.has(pair)) context.reject!(`${roles.get(change.role)} · ${label(change)} is changed twice`)
    seen.add(pair)
  }
  const current = (c: Change) => rows.find(r => exact(r.business_role) === c.role && permissionKey({ app: text(r.app), level: text(r.level), verb: text(r.verb), thing: text(r.thing) }) === permissionKey(c))
  for (const change of wanted) {
    const now = current(change)
    if ((now && !checked(now.removed) ? text(now.reach) : null) !== change.from)
      context.reject!(`${roles.get(change.role)} · ${label(change)} was changed since you loaded the grid; reload it and try again`)
  }

  const docs = context.documents!
  for (const change of wanted) {
    const now = current(change)
    // The row's updated_at as read: a row someone changed meanwhile is refused by the platform, not overwritten.
    if (change.to === null) await docs.update!(PERMISSION, { row_id: exact(now!.row_id), updated_at: exact(now!.updated_at), removed: true })
    else if (now) await docs.update!(PERMISSION, { row_id: exact(now.row_id), updated_at: exact(now.updated_at), reach: change.to, removed: false })
    else await docs.create!(PERMISSION, { business_role: change.role, app: change.app, level: change.level, verb: change.verb, thing: change.thing, reach: change.to })
    await docs.create!(PERMISSION_CHANGE, {
      business_role: change.role, permission: label(change), app: change.app, level: change.level, verb: change.verb, thing: change.thing,
      from_reach: change.from ?? '', to_reach: change.to ?? '', changed_by_name: text(context.userName) || null,
    })
  }
  return { saved: wanted.length }
}
