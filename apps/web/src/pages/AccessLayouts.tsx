import { createContext, useContext, useState, type ReactNode } from 'react'
import { tableHref } from 'shared'
import { Card, RecordLink, Segmented, fmtInstantIST } from '@featherbase/shop-floor'
import { ActorName, isOpaqueId } from '../lib/people'

// #1224 (Siraj: "everything that is a record in FB has to be presented as a
// link"): each role, table, person and service account links to its record
// when the viewer may open it (the server's viewer_opens), else plain text.
// One place, so the shared RecordLink can take over from it.
/** What the viewer may open: Tables (for a Table's list) and, by
 *  "table\u0000row_id", single rows (Codex round 6: row rules can refuse a row
 *  of a Table they otherwise read). */
export const OpensContext = createContext<{ tables: ReadonlySet<string>; rows: ReadonlySet<string> }>({ tables: new Set(), rows: new Set() })
export const opensFrom = (data: { viewer_opens?: string[]; viewer_opens_rows?: { table: string; row_id: string }[] }) => ({
  tables: new Set(data.viewer_opens ?? []),
  rows: new Set((data.viewer_opens_rows ?? []).map((r) => `${r.table}\u0000${r.row_id}`)),
})

/** One record, as the shared RecordLink (#1227): a link when the viewer may
 *  open it, else the same words as plain text. Without `id` it is a Table,
 *  linked to its list. */
export function Rec({ table, id, name }: { table: string; id?: string; name: string }) {
  const opens = useContext(OpensContext)
  if (!id) return <RecordLink table="Table" rowId={table} name={name} href={tableHref(table)} canOpen={opens.tables.has(table)} />
  return <RecordLink table={table} rowId={id} name={name} canOpen={opens.rows.has(`${table}\u0000${id}`)} />
}

/** The Table an actor id is a row of, when it is one. */
const actorTable = (id: string) => (id.startsWith('svc_') ? 'Service Account' : isOpaqueId(id) || id === 'Administrator' ? 'Person' : null)
export function Actor({ id, name }: { id: string; name?: string | null }) {
  const table = actorTable(id)
  // A name the server could not give (no record behind the id) stays the
  // viewer's own lookup, as plain text.
  return table && name ? <Rec table={table} id={id} name={name} /> : <ActorName id={id} name={name} />
}
/** A role, linked to its Role row; the built-in All is not one to open. */
function RoleRef({ role }: { role: string }) {
  return role === 'All' ? <>{roleTitle(role)}</> : <Rec table="Role" id={role} name={roleTitle(role)} />
}

// #1224: "What you can see", three ways, for a reader who is not technical.
// Summary says it in sentences first; By role shows each role as a card; By
// area groups the Tables by the part of the business they belong to. Each is
// the same answer, built from the same explanation.

export interface TableReach { table: string; own_rows: boolean; roles: string[]; own_rows_roles?: string[]; label?: string; module?: string; app?: string | null; keeps_private?: boolean }
export interface RoleRow { role: string; app: string | null; through: string | null; everyone?: boolean; given_by: string | null; given_by_name?: string | null; given_at: string | null
  /** A built-in role every account holds (All): never given, never listed by the server. */
  implicit?: boolean }

/** The roles to explain: the person's own, plus any built-in role (All) that
 *  reaches a table, so every table reached belongs to a role on the page
 *  (Codex adversarial round 4). */
export function withImplicitRoles(roles: RoleRow[], tables: Reached[]): RoleRow[] {
  const listed = new Set(roles.map((r) => r.role))
  const implicit = [...new Set(tables.flatMap((t) => [...t.readRoles, ...t.changeRoles]))].filter((role) => !listed.has(role)).sort()
  return [...roles, ...implicit.map((role) => ({ role, app: null, through: null, implicit: true, given_by: null, given_at: null }))]
}

/** A role's name as a reader says it. */
export const roleTitle = (role: string) => (role === 'All' ? 'Every account' : role)

export type AccessLayout = 'summary' | 'roles' | 'areas'
export const ACCESS_LAYOUTS: { value: AccessLayout; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'roles', label: 'By role' },
  { value: 'areas', label: 'By area' },
]
const STORAGE_KEY = 'featherbase.access-layout'

export function useAccessLayout(): [AccessLayout, (l: AccessLayout) => void] {
  const [layout, setLayout] = useState<AccessLayout>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return ACCESS_LAYOUTS.some((l) => l.value === saved) ? (saved as AccessLayout) : 'summary'
    } catch { return 'summary' }
  })
  return [layout, (l) => { setLayout(l); try { localStorage.setItem(STORAGE_KEY, l) } catch { /* private window */ } }]
}

export function LayoutToggle({ value, onChange }: { value: AccessLayout; onChange: (l: AccessLayout) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="access-layout">
      <span className="text-[13px] text-ink-muted">Show as</span>
      <Segmented label="Show as" options={ACCESS_LAYOUTS} value={value} onChange={onChange} />
    </div>
  )
}

/** One Table, with what the person may do to it and through which roles. */
export interface Reached {
  table: string
  label: string
  area: string
  /** A mandatory privacy policy keeps some rows to the people they belong to. */
  keepsPrivate: boolean
  read: boolean
  change: boolean
  /** Reading, or changing, reaches only rows the person created. */
  readOwn: boolean
  changeOwn: boolean
  readRoles: string[]
  /** Roles that give reading, or changing, only for own rows. */
  readOwnRoles: string[]
  changeOwnRoles: string[]
  changeRoles: string[]
}

/** An app's Tables group under the app's name; the platform's own "Core"
 *  reads as "General". */
const appTitle = (app: string) => app.charAt(0).toUpperCase() + app.slice(1)
const areaOf = (t: TableReach) => (t.app ? appTitle(t.app) : !t.module || t.module === 'Core' ? 'General' : t.module)

export function reachedTables(read: TableReach[], change: TableReach[]): Reached[] {
  const by = new Map<string, Reached>()
  const entry = (t: TableReach) => {
    let r = by.get(t.table)
    if (!r) by.set(t.table, r = { table: t.table, label: t.label ?? t.table, area: areaOf(t), keepsPrivate: Boolean(t.keeps_private), read: false, change: false, readOwn: false, changeOwn: false, readRoles: [], changeRoles: [], readOwnRoles: [], changeOwnRoles: [] })
    return r
  }
  for (const t of read) Object.assign(entry(t), { read: true, readRoles: t.roles, readOwn: t.own_rows, readOwnRoles: t.own_rows_roles ?? [] })
  for (const t of change) Object.assign(entry(t), { change: true, changeRoles: t.roles, changeOwn: t.own_rows, changeOwnRoles: t.own_rows_roles ?? [] })
  return [...by.values()].sort((a, b) => a.area.localeCompare(b.area) || a.label.localeCompare(b.label))
}

export function byArea(tables: Reached[]): [string, Reached[]][] {
  const groups = new Map<string, Reached[]>()
  for (const t of tables) groups.set(t.area, [...(groups.get(t.area) ?? []), t])
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}


/** "8 tables · change all", "10 tables · change 8", "1 table · read only". */
function countLine(ts: Reached[]): string {
  const changes = ts.filter((t) => t.change).length
  const how = changes === ts.length ? 'change all' : changes ? `change ${changes} of ${ts.length}` : 'read only'
  return `${plural(ts.length, 'table')} · ${how}`
}
const rolesOfTable = (t: Reached) => [...new Set([...t.readRoles, ...t.changeRoles])].sort()

/** "Merchandising, Organisation and 2 more areas". */
function areaList(areas: string[]): string {
  if (areas.length <= 3) return areas.length > 1 ? `${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}` : (areas[0] ?? '')
  return `${areas.slice(0, 3).join(', ')} and ${areas.length - 3} more areas`
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Where a role comes from. `lead` starts the line ("Given by …"); otherwise
 *  it follows the role's name (" — given by …"). */
export function GivenBy({ r, lead }: { r: RoleRow; lead?: boolean }) {
  const say = (text: string) => (lead ? text.charAt(0).toUpperCase() + text.slice(1) : ` — ${text}`)
  if (r.app) return <span className="text-ink-muted">{say(`from app ${r.app}, through ${r.through}`)}</span>
  if (r.implicit) return <span className="text-ink-muted">{say('every signed-in account has these')}</span>
  // The words are the permissions-and-roles spec's (#923, #1224).
  if (r.everyone) return <span className="text-ink-muted">{say('everyone who signs in has it')}</span>
  if (!r.given_by || !r.given_at) return null
  return <span className="text-ink-muted">{say('given by ')}<Actor id={r.given_by} name={r.given_by_name} />{`, ${fmtInstantIST(r.given_at)}`}</span>
}

/** What one operation reaches: ✓, "own rows only", or nothing. */
function Can({ on, own }: { on: boolean; own: boolean }) {
  if (!on) return <span className="text-ink-subtle" aria-label="No">—</span>
  return own ? <span className="text-ink">own rows only</span> : <span className="text-positive" aria-label="Yes">✓</span>
}

const onlyEveryAccount = (t: Reached) => rolesOfTable(t).every((role) => role === 'All')

/** Who gives a Table: role links, or "every account". */
function Through({ t }: { t: Reached }) {
  const roles = rolesOfTable(t)
  return <>{roles.map((role, i) => <span key={role}>{i > 0 && ', '}{role === 'All' ? 'every account' : <RoleRef role={role} />}</span>)}</>
}

/** The tables reached, as one table with a header row per area (UI
 *  standard §5). Within an area, the tables every account reaches fold into
 *  one line ("Every account can read 8 tables — Show"), spec item 7. */
export function ReachTable({ tables, through }: { tables: Reached[]; through: boolean }) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const cols = through ? 4 : 3
  const row = (t: Reached) => (
    <tr key={t.table} className="border-t border-border" data-testid="access-table-row">
      <td className="py-1.5 pr-3"><Rec table={t.table} name={t.label} /></td>
      <td className="py-1.5 pr-3"><Can on={t.read} own={t.readOwn} /></td>
      <td className="py-1.5 pr-3"><Can on={t.change} own={t.changeOwn} /></td>
      {through && <td className="py-1.5 text-ink-muted"><Through t={t} /></td>}
    </tr>
  )
  return (
    <table className="w-full text-left text-sm" data-testid="access-reach-table">
      <thead>
        <tr className="text-[13px] font-medium text-ink-muted">
          <th className="pb-2 pr-3 font-medium">Table</th>
          <th className="w-28 pb-2 pr-3 font-medium">Read</th>
          <th className="w-32 pb-2 pr-3 font-medium">Change</th>
          {through && <th className="pb-2 font-medium">Through</th>}
        </tr>
      </thead>
      {byArea(tables).map(([area, ts]) => {
        const shared = ts.filter(onlyEveryAccount)
        const own = ts.filter((t) => !onlyEveryAccount(t))
        const open = opened.has(area)
        return (
          <tbody key={area} data-testid="access-area-group">
            <tr className="bg-subtle">
              <th colSpan={cols} scope="rowgroup" className="px-2 py-1.5 text-[13px] font-semibold text-ink">
                {area} <span className="font-normal text-ink-muted">· {countLine(ts)}</span>
              </th>
            </tr>
            {own.map(row)}
            {shared.length > 0 && (
              <tr className="border-t border-border" data-testid="access-every-account-line">
                <td colSpan={cols} className="py-1.5 text-ink-muted">
                  Every account can {readChangePhrase(shared, ' here')}{' — '}
                  <button type="button" className="font-medium text-action hover:underline" aria-expanded={open}
                    onClick={() => setOpened((o) => { const n = new Set(o); if (open) n.delete(area); else n.add(area); return n })}>
                    {open ? 'Hide' : 'Show'}
                  </button>
                </td>
              </tr>
            )}
            {open && shared.map(row)}
          </tbody>
        )
      })}
    </table>
  )
}

/** What a set of tables allows, counting reading and changing each on its
 *  own (Codex round 8: a change-only grant is not a read): "read 10 tables
 *  and change 8 of them", "read and change 4 tables", "change 5 tables",
 *  "read 3 tables and change 2" (when some changeable ones are not readable). */
export function readChangePhrase(tables: Pick<Reached, 'read' | 'change'>[], where = ''): string {
  const reads = tables.filter((t) => t.read).length
  const changes = tables.filter((t) => t.change).length
  const both = tables.filter((t) => t.read && t.change).length
  if (!changes) return `read ${plural(reads, 'table')}${where}`
  if (!reads) return `change ${plural(changes, 'table')}${where}`
  if (reads === changes && both === reads) return `read and change ${plural(reads, 'table')}${where}`
  if (both === changes) return `read ${plural(reads, 'table')}${where} and change ${changes} of them`
  return `read ${plural(reads, 'table')} and change ${plural(changes, 'table')}${where}`
}

function doesWhat(tables: Reached[], you: string): string {
  return `${you} can ${readChangePhrase(tables)}`
}

/** What a role reaches: by name when it is a handful, else by count and areas. */
function roleSentence(tables: Reached[], you: string): string {
  const areas = [...new Set(tables.map((t) => t.area))]
  if (tables.length <= 4) {
    const verb = tables.every((t) => t.read && t.change) ? 'read and change' : tables.every((t) => t.change && !t.read) ? 'change' : tables.some((t) => t.change) ? 'read or change' : 'read'
    const names = tables.map((t) => t.label)
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
    return `${you} can ${verb} ${list}${areas.length === 1 && areas[0] !== 'General' ? ` in ${areas[0]}` : ''}`
  }
  return `${doesWhat(tables, you)}, in ${areaList(areas)}`
}

/** What ONE role gives, not what the person has from all their roles
 *  together (Codex rounds 3 and 5): Reader's card never says Change because
 *  Writer gives it, nor Read (all rows) because another role does. */
const tablesOf = (role: string, tables: Reached[]) => tables
  .filter((t) => t.readRoles.includes(role) || t.changeRoles.includes(role))
  .map((t) => ({ ...t, read: t.readRoles.includes(role), change: t.changeRoles.includes(role),
    readOwn: t.readOwnRoles.includes(role), changeOwn: t.changeOwnRoles.includes(role) }))

/** Which rows: "every row" only when nothing narrows it (Codex round 3). */
export function rowsLine({ limits, readOwn, changeOwn, places, privateTables = [], self }: { limits: number; readOwn: number; changeOwn: number; places: { title: string; count: number } | null; privateTables?: string[]; self: boolean }): string {
  const whose = self ? 'Your' : 'Their'
  const who = self ? 'you' : 'they'
  // Reading and changing are narrowed on their own (Codex round 9): "read
  // every row, change only your own" must not read as "see only your own".
  const narrows = [
    limits && `limited to ${plural(limits, 'set of rows', 'sets of rows')} (see “Limited to” below)`,
    readOwn && `${plural(readOwn, 'table')} ${readOwn === 1 ? 'shows' : 'show'} only rows ${who} created`,
    changeOwn && `in ${plural(changeOwn, 'table')} ${who} can change only rows ${who} created`,
    places && `${places.title} gives ${self ? 'you' : 'them'} ${plural(places.count, 'place')} (see below)`,
  ].filter(Boolean) as string[]
  // Never "every row" where a table keeps rows private to the people they
  // belong to (a mandatory privacy policy), even from a System Manager (Codex
  // round 7); named only for the tables that have one.
  const privacy = privateTables.length
    ? ` Rows of ${privateTables.length > 1 ? `${privateTables.slice(0, -1).join(', ')} and ${privateTables.at(-1)}` : privateTables[0]} stay private to the people they belong to.` : ''
  if (!narrows.length) return `No limits are set on ${self ? 'your' : 'their'} rows.${privacy}`
  return `${whose} access is narrowed: ${narrows.join('; ')}.${privacy}`
}

// ── (c) Summary: sentences first, the detail behind one button ──────────────

export function SummaryLayout({ roles, tables, everyTable, limits, shares, places, apps, notes, self }: {
  roles: RoleRow[]; tables: Reached[]; everyTable: boolean; limits: number; shares: number
  /** The app that limits the person to places, and how many it gives; null when none does. */
  places: { title: string; count: number } | null
  /** The apps the person can open, and the places an app gives them (spec item 3). */
  apps: { name: string; title: string; href: string }[]
  /** Muted lines for sections that are empty, so they need no card of their own (spec item 8). */
  notes: ReactNode
  self: boolean
}) {
  const [all, setAll] = useState(false)
  const you = self ? 'You' : 'They'
  const lines = roles.map((r) => ({ r, reach: tablesOf(r.role, tables) }))
  const reaching = lines.filter(({ reach }) => reach.length > 0)
  const others = lines.filter(({ reach }) => reach.length === 0)
  return (
    <Card className="p-4" data-testid="access-summary">
      <h2 className="mb-3 text-base font-semibold text-ink">What {self ? 'you' : 'they'} can do, in short</h2>
      <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm" data-testid="access-at-a-glance">
        <dt className="text-ink-muted">{self ? 'You can open' : 'They can open'}</dt>
        <dd className="text-ink" data-testid="access-apps">{apps.length
          ? apps.map((a, i) => <span key={a.name}>{i > 0 && ', '}<a href={a.href} className="font-medium text-action hover:underline">{a.title}</a></span>)
          : 'No apps yet'}</dd>
        {places && places.count > 0 && <>
          {/* The places' own labels are the app's, often codes: they are listed in
              the places card below, not shown bare here (UI standard §1.5). */}
          <dt className="text-ink-muted">{self ? 'Your places' : 'Their places'}</dt>
          <dd className="text-ink" data-testid="access-places-line">{plural(places.count, 'place')}, from {places.title} (listed below)</dd>
        </>}
      </dl>
      <ul className="space-y-3 text-sm">
        {everyTable && (
          <li className="text-ink" data-testid="access-summary-line">{you} can read and change every Table — through System Manager — apart from rows a table keeps private to the people they belong to.
            <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {roles.map((r) => (
                <li key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} data-testid="access-role">
                  <span className="font-medium text-ink"><RoleRef role={r.role} /></span><GivenBy r={r} />
                </li>
              ))}
            </ul>
          </li>
        )}
        {reaching.map(({ r, reach }) => (
          <li key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} data-testid="access-summary-line">
            <span className="text-ink">{roleSentence(reach, you)}.</span>
            <span className="block text-xs text-ink-muted" data-testid="access-role">
              {r.implicit ? 'Open to every signed-in account' : <>Through <span className="font-medium text-ink"><RoleRef role={r.role} /></span><GivenBy r={r} /></>}
            </span>
          </li>
        ))}
        {!everyTable && others.length > 0 && (
          <li data-testid="access-summary-line">
            <span className="text-ink">{self ? 'You also hold' : 'They also hold'} {plural(others.length, 'role')} that {others.length === 1 ? 'reaches' : 'reach'} no tables of {others.length === 1 ? 'its' : 'their'} own:</span>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {others.map(({ r }) => (
                <li key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} data-testid="access-role">
                  <span className="font-medium text-ink">{r.role}</span><GivenBy r={r} />
                </li>
              ))}
            </ul>
          </li>
        )}
        {!everyTable && reaching.length === 0 && (
          <li className="text-ink-muted" data-testid="access-summary-line">{you} only see what every account can see.</li>
        )}
        <li className="text-ink" data-testid="access-summary-line">
          {rowsLine({ limits, readOwn: tables.filter((t) => t.read && t.readOwn).length,
            changeOwn: tables.filter((t) => t.change && t.changeOwn).length, places, self,
            privateTables: tables.filter((t) => t.keepsPrivate).map((t) => t.label) })}
          {shares > 0 && ` ${plural(shares, 'row is', 'rows are')} also shared with ${self ? 'you' : 'them'} directly.`}
        </li>
      </ul>
      {notes}
      {!everyTable && tables.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-sm font-medium text-action hover:underline" aria-expanded={all}
            onClick={() => setAll(!all)} data-testid="access-show-all">
            {all ? 'Hide the tables' : `Show all ${plural(tables.length, 'table')}`}
          </button>
          {all && <div className="mt-2"><ReachTable tables={tables} through /></div>}
        </div>
      )}
    </Card>
  )
}

// ── (a) By role: one card per role, its Tables grouped by area ───────────────

export function RolesLayout({ roles, tables, everyTable, self }: { roles: RoleRow[]; tables: Reached[]; everyTable: boolean; self: boolean }) {
  const you = self ? 'You' : 'They'
  return (
    <div className="space-y-3" data-testid="access-by-role">
      {everyTable && <p className="text-sm text-ink" data-testid="access-every-table">Every Table, to read and to change — through System Manager.</p>}
      {roles.map((r) => {
        const reach = tablesOf(r.role, tables)
        return (
          <Card key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} className="p-4" data-testid="access-role-card">
            <h2 className="text-base font-semibold text-ink"><RoleRef role={r.role} /></h2>
            <p className="text-sm"><GivenBy r={r} lead /></p>
            <p className="mt-1 text-sm text-ink">{
              everyTable ? (r.role === 'System Manager' ? `${you} can read and change every table.` : 'Every table is already open through System Manager.')
                : reach.length ? `${roleSentence(reach, you)}.` : 'Reaches no tables of its own.'}</p>
            {reach.length > 0 && <div className="mt-3"><ReachTable tables={reach} through={false} /></div>}
          </Card>
        )
      })}
    </div>
  )
}

// ── (b) By area: one table, a header row per area ───────────────────────────

export function AreasLayout({ tables, everyTable }: { tables: Reached[]; everyTable: boolean }) {
  return (
    <Card className="p-4" data-testid="access-by-area">
      {everyTable
        ? <p className="text-sm text-ink" data-testid="access-every-table">Every Table, to read and to change — through System Manager.</p>
        : tables.length === 0 ? <p className="text-sm text-ink-muted">No Tables.</p>
        : <ReachTable tables={tables} through />}
    </Card>
  )
}
