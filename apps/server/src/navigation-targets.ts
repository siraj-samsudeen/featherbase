import { sign, verify } from 'hono/jwt'
import { rowDisplayTitle, adminPathTitle } from 'shared'
import { sql, withTransaction } from './db'
import { jwtSecret } from './auth'
import { AppError } from './errors'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { getDoc } from './document'
import { assertPermission } from './permissions'
import { commandDestinations } from './command-destinations'
import { principalNames } from './people-directory'

interface Binding {
  table: string
  row?: string
  originalTable: string
  originalRow?: string
}
export interface NavigationEvent {
  kind: string
  key: string
  label?: string
  sub?: string
  path?: string
  at: number
  destination?: Binding | { unavailable: true } | null
  claim?: string | null
}
export interface Destination {
  state: 'available' | 'deleted_table' | 'unavailable'
  path: string
  label: string
  sub?: string
}
const unavailable: Destination = { state: 'unavailable', path: '', label: 'Unavailable destination' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function expectedRefusal(error: unknown) {
  return error instanceof AppError && ['PermissionError', 'NotFoundError', 'ConflictError', 'NotSetUpError'].includes(error.type)
}

// Capture only while holding the same definition -> native-row lock order as
// rename/delete. Claims attest an authorized read, never grant future access.
export async function captureNavigation(user: string, table: string, rowId?: string): Promise<string | null> {
  // Refused readers must not lock the destination or create navigation state.
  if (rowId !== undefined) await getDoc(table, rowId, user)
  else await assertPermission(user, table, 'read')
  return withTransaction(async () => {
    const [definition] = await sql`select navigation_identity from table_def where name = ${table} for share`
    if (!definition) return null
    const meta = await getMeta(table)
    let row: string | undefined
    if (rowId !== undefined) {
      if (meta.data_source || meta.kind !== 'table') return null
      const [stored] = await sql`select created_at from ${sql(await tableRelation(table))}
        where ${sql(meta.row_key)} = ${rowId} for key share`
      if (!stored?.created_at) return null
      // renameDoc takes FOR UPDATE and changes the primary key; deleteDoc
      // takes FOR UPDATE before deletion. Both conflict with KEY SHARE,
      // whereas ordinary non-key updates and concurrent visits need not wait.
      await getDoc(table, rowId, user)
      await sql`update navigation_row_target set retired = true
        where table_identity = ${definition.navigation_identity} and row_id = ${rowId}
          and not retired and born_at <> ${stored.created_at}`
      const [inserted] = await sql`insert into navigation_row_target (table_identity, row_id, born_at)
        values (${definition.navigation_identity}, ${rowId}, ${stored.created_at})
        on conflict (table_identity, row_id) where not retired do nothing
        returning id`
      const pointer = inserted ?? (await sql`select id from navigation_row_target
        where table_identity = ${definition.navigation_identity} and row_id = ${rowId} and not retired`)[0]
      row = pointer.id as string
    } else await assertPermission(user, table, 'read')
    const binding: Binding = { table: definition.navigation_identity as string, originalTable: table,
      ...(row ? { row, originalRow: rowId } : {}) }
    return sign({ purpose: 'navigation', user, binding }, jwtSecret(), 'HS256')
  })
}

function originalRoute(event: NavigationEvent, binding: Binding): string | null {
  const prefix = `/featherbase/admin/${encodeURIComponent(binding.originalTable)}`
  if (event.kind === 'row') {
    if (!binding.row || event.key !== `row:${binding.originalTable}/${binding.originalRow}`) return null
    return `${prefix}/${encodeURIComponent(binding.originalRow!)}`
  }
  if (event.kind !== 'list' || binding.row || !event.key.startsWith(`list:${binding.originalTable}`)) return null
  const tail = event.key.slice(`list:${binding.originalTable}`.length)
  const match = /^(?:\/(\w+))?\?(.*)$/.exec(tail)
  if (!match) return null
  return `${prefix}${match[1] ? `/view/${match[1]}` : ''}${match[2] ? `?filters=${encodeURIComponent(match[2])}` : ''}`
}

function canonicalPath(path: string | undefined): string | null {
  if (!path?.startsWith('/featherbase/admin/')) return null
  const url = new URL(path, 'https://navigation.invalid')
  return url.pathname + url.search
}

export async function bindNavigation(user: string, event: NavigationEvent): Promise<Binding | { unavailable: true }> {
  if (!event.claim) return { unavailable: true }
  let payload
  try { payload = await verify(event.claim, jwtSecret(), 'HS256') } catch { return { unavailable: true } }
  const binding = payload.binding as Binding | undefined
  if (payload.purpose !== 'navigation' || payload.user !== user || !binding || !uuid.test(binding.table)
    || (binding.row && !uuid.test(binding.row)) || originalRoute(event, binding) !== canonicalPath(event.path)) return { unavailable: true }
  const resolved = await resolveNavigation(user, { ...event, destination: binding })
  return resolved.state === 'unavailable' ? { unavailable: true } : binding
}

// Read-time only. NULL is legacy; a newly refused claim can NEVER become legacy.
export async function resolveNavigation(user: string, event: NavigationEvent): Promise<Destination> {
  if (event.kind === 'search') return { state: 'available', path: '', label: event.label ?? '' }
  if (event.kind === 'page' || adminPathTitle(event.path ?? '')) {
    if (!event.path?.startsWith('/featherbase/admin/')) return unavailable
    const page = (await commandDestinations(user)).pages.find(p => p.href === event.path!.split('?')[0])
    return page ? { state: 'available', path: event.path, label: page.label } : unavailable
  }
  if (!['row', 'list'].includes(event.kind)) return unavailable
  if (event.destination && 'unavailable' in event.destination) return unavailable
  const binding = event.destination as Binding | null | undefined
  let table: string
  let rowId: string | undefined
  let born: unknown
  if (binding) {
    const [definition] = await sql`select name from table_def where navigation_identity = ${binding.table}`
    if (!definition) return { state: 'deleted_table', path: '', label: event.kind === 'list' ? binding.originalTable : event.label ?? '',
      ...(event.kind === 'row' ? { sub: binding.originalTable } : {}) }
    table = definition.name as string
    if (binding.row) {
      const [pointer] = await sql`select row_id, born_at from navigation_row_target
        where id = ${binding.row} and table_identity = ${binding.table} and not retired`
      if (!pointer) return unavailable
      rowId = pointer.row_id as string
      born = pointer.born_at
    }
  } else {
    const parsed = event.kind === 'row' ? /^row:([^/]+)\/(.+)$/.exec(event.key) : /^list:([^/?]+)(?:\/\w+)?\?/.exec(event.key)
    if (!parsed) return unavailable
    table = parsed[1]
    rowId = event.kind === 'row' ? parsed[2] : undefined
    const [definition] = await sql`select created_at from table_def where name = ${table}`
    if (!definition?.created_at || !(new Date(definition.created_at as string).getTime() < event.at)) return unavailable
  }
  try {
    const meta = await getMeta(table)
    let label = table
    if (event.kind === 'row') {
      if (!rowId || meta.data_source || meta.kind !== 'table') return unavailable
      const doc = await getDoc(table, rowId, user)
      const [stored] = await sql`select created_at from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${rowId}`
      if (!stored?.created_at) return unavailable
      const birth = new Date(stored.created_at as string).getTime()
      if (binding ? birth !== new Date(born as string).getTime() : !(birth < event.at)) return unavailable
      const titleColumn = meta.columns.find(c => c.column_name === meta.title_column
        && c.column_type === 'Reference' && ['Person', 'Service Account'].includes(c.reference_table!))
      if (titleColumn && doc[titleColumn.column_name]) {
        const principal = String(doc[titleColumn.column_name])
        const names = await principalNames([principal], user)
        doc[titleColumn.column_name] = names[principal] ?? 'Unnamed person'
      }
      label = rowDisplayTitle(meta, doc, rowId)
    } else await assertPermission(user, table, 'read')
    const original = binding ?? { table: '', originalTable: table, originalRow: rowId, ...(rowId ? { row: 'legacy' } : {}) }
    const oldPath = originalRoute(event, original)
    if (!oldPath || oldPath !== canonicalPath(event.path)) return unavailable
    const path = event.kind === 'row'
      ? `/featherbase/admin/${encodeURIComponent(table)}/${encodeURIComponent(rowId!)}`
      : oldPath.replace(`/featherbase/admin/${encodeURIComponent(original.originalTable)}`, `/featherbase/admin/${encodeURIComponent(table)}`)
    return { state: 'available', path, label, ...(rowId ? { sub: table } : event.sub ? { sub: event.sub } : {}) }
  } catch (error) {
    if (!expectedRefusal(error)) throw error
    return unavailable
  }
}

export async function homeResume(user: string, hints: NavigationEvent[]) {
  const rows = await sql`select kind, ref_key, label, sub_label, path, occurred_at, destination from user_event
    where created_by = ${user} order by occurred_at desc, row_id desc limit 800`
  const events: NavigationEvent[] = rows.map(r => ({ kind: r.kind as string, key: r.ref_key as string,
    label: r.label as string, sub: r.sub_label as string, path: r.path as string,
    at: new Date(r.occurred_at as string).getTime(), destination: r.destination as NavigationEvent['destination'] }))
  for (const hint of hints) {
    // A mirror may be older than a rejected binding; only new signed visits
    // can supplement persisted history. It never re-infers a cached name.
    if (events.some(e => e.key === hint.key && e.at === hint.at)) continue
    if (!hint.claim && !['search', 'page'].includes(hint.kind)) continue
    events.push({ ...hint, at: Math.min(hint.at, Date.now()), destination: await bindNavigation(user, hint) })
  }
  events.sort((a, b) => b.at - a.at)
  const kinds = new Set<string>()
  const entries = []
  for (const event of events) {
    const kind = event.kind === 'page' ? 'list' : event.kind
    if (kinds.has(kind)) continue
    const result = await resolveNavigation(user, event)
    if (result.state !== 'available') continue
    kinds.add(kind)
    entries.push({ kind: event.kind, key: event.key, label: result.label, sub: result.sub,
      path: result.path, visits: [event.at] })
    if (kinds.size === 3) break
  }
  return entries
}
