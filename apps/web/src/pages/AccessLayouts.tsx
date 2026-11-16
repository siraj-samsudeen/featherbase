import { useState, type ReactNode } from 'react'
import { Card, Segmented, StatusPill, fmtDate } from '@featherbase/shop-floor'
import { ActorName } from '../lib/people'

// #1224: "What you can see", three ways, for a reader who is not technical.
// Summary says it in sentences first; By role shows each role as a card; By
// area groups the Tables by the part of the business they belong to. Each is
// the same answer, built from the same explanation.

export interface TableReach { table: string; own_rows: boolean; roles: string[]; label?: string; module?: string; app?: string | null }
export interface RoleRow { role: string; app: string | null; through: string | null; everyone?: boolean; given_by: string | null; given_by_name?: string | null; given_at: string | null }

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
      <span className="text-sm text-ink-muted">Show as</span>
      <Segmented label="Show as" options={ACCESS_LAYOUTS} value={value} onChange={onChange} />
    </div>
  )
}

/** One Table, with what the person may do to it and through which roles. */
export interface Reached {
  table: string
  label: string
  area: string
  read: boolean
  change: boolean
  own_rows: boolean
  readRoles: string[]
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
    if (!r) by.set(t.table, r = { table: t.table, label: t.label ?? t.table, area: areaOf(t), read: false, change: false, own_rows: false, readRoles: [], changeRoles: [] })
    return r
  }
  for (const t of read) Object.assign(entry(t), { read: true, readRoles: t.roles, own_rows: entry(t).own_rows || t.own_rows })
  for (const t of change) Object.assign(entry(t), { change: true, changeRoles: t.roles, own_rows: entry(t).own_rows || t.own_rows })
  return [...by.values()].sort((a, b) => a.area.localeCompare(b.area) || a.label.localeCompare(b.label))
}

export function byArea(tables: Reached[]): [string, Reached[]][] {
  const groups = new Map<string, Reached[]>()
  for (const t of tables) groups.set(t.area, [...(groups.get(t.area) ?? []), t])
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const roleName = (role: string) => (role === 'All' ? 'every account' : role)

/** "Merchandising, Organisation and 2 more areas". */
function areaList(areas: string[]): string {
  if (areas.length <= 3) return areas.length > 1 ? `${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}` : (areas[0] ?? '')
  return `${areas.slice(0, 3).join(', ')} and ${areas.length - 3} more areas`
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dayOf = (iso: string) => fmtDate(new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10))

export function GivenBy({ r }: { r: RoleRow }) {
  if (r.app) return <span className="text-ink-muted">{` — from app ${r.app}, through ${r.through}`}</span>
  if (r.everyone) return <span className="text-ink-muted"> — everyone who signs in holds it (System Settings)</span>
  if (!r.given_by || !r.given_at) return null
  return <span className="text-ink-muted">{' — given by '}<ActorName id={r.given_by} name={r.given_by_name} />{`, ${dayOf(r.given_at)}`}</span>
}

function Chips({ t }: { t: Reached }) {
  return (
    <span className="flex shrink-0 gap-1">
      {t.read && <StatusPill tone="neutral">Read</StatusPill>}
      {t.change && <StatusPill tone="positive">Change</StatusPill>}
      {t.own_rows && <StatusPill tone="caution">Own rows</StatusPill>}
    </span>
  )
}

/** A collapsed group of Tables, opened by its heading. */
function Group({ title, count, testid, children, open }: { title: ReactNode; count: string; testid: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-control border border-border" data-testid={testid} open={open}>
      <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="font-medium text-ink">{title}</span>
        <span className="flex items-center gap-2 text-ink-muted">{count}<span aria-hidden className="transition-transform group-open:rotate-90">›</span></span>
      </summary>
      <div className="border-t border-border px-3 py-2">{children}</div>
    </details>
  )
}

function TableRows({ tables, showRoles }: { tables: Reached[]; showRoles: boolean }) {
  return (
    <ul className="divide-y divide-border text-sm">
      {tables.map((t) => {
        const roles = [...new Set([...t.readRoles, ...t.changeRoles])].map(roleName)
        return (
          <li key={t.table} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5" data-testid="access-table-row">
            <span className="min-w-0">
              <span className="text-ink">{t.label}</span>
              {showRoles && <span className="block text-xs text-ink-muted">through {roles.join(', ')}</span>}
            </span>
            <Chips t={t} />
          </li>
        )
      })}
    </ul>
  )
}

function doesWhat(tables: Reached[], you: string): string {
  const changes = tables.filter((t) => t.change).length
  const readsOnly = tables.filter((t) => t.read && !t.change).length
  if (changes && readsOnly) return `${you} can change ${plural(changes, 'table')} and read ${readsOnly} more`
  if (changes) return `${you} can read and change ${plural(changes, 'table')}`
  return `${you} can read ${plural(readsOnly, 'table')}`
}

/** What a role reaches: by name when it is a handful, else by count and areas. */
function roleSentence(tables: Reached[], you: string): string {
  const areas = [...new Set(tables.map((t) => t.area))]
  if (tables.length <= 4) {
    const verb = tables.every((t) => t.change) ? 'read and change' : tables.some((t) => t.change) ? 'see' : 'read'
    const names = tables.map((t) => t.label)
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
    return `${you} can ${verb} ${list}${areas.length === 1 && areas[0] !== 'General' ? ` in ${areas[0]}` : ''}`
  }
  return `${doesWhat(tables, you)}, in ${areaList(areas)}`
}

const tablesOf = (role: string, tables: Reached[]) => tables.filter((t) => t.readRoles.includes(role) || t.changeRoles.includes(role))

// ── (c) Summary: sentences first, the detail behind one button ──────────────

export function SummaryLayout({ roles, tables, everyTable, limits, shares, self }: {
  roles: RoleRow[]; tables: Reached[]; everyTable: boolean; limits: number; shares: number; self: boolean
}) {
  const [all, setAll] = useState(false)
  const you = self ? 'You' : 'They'
  const lines = roles.map((r) => ({ r, reach: tablesOf(r.role, tables) }))
  const reaching = lines.filter(({ reach }) => reach.length > 0)
  const others = lines.filter(({ reach }) => reach.length === 0)
  return (
    <Card className="p-4" data-testid="access-summary">
      <h2 className="mb-2 text-sm font-semibold text-ink">What {self ? 'you' : 'they'} can do, in short</h2>
      <ul className="space-y-3 text-sm">
        {everyTable && (
          <li className="text-ink" data-testid="access-summary-line">{you} can read and change every Table — through System Manager.</li>
        )}
        {reaching.map(({ r, reach }) => (
          <li key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} data-testid="access-summary-line">
            <span className="text-ink">{roleSentence(reach, you)}.</span>
            <span className="block text-xs text-ink-muted" data-testid="access-role">
              Through <span className="font-medium text-ink">{r.role}</span>
              <GivenBy r={r} />
            </span>
          </li>
        ))}
        {others.length > 0 && (
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
          {limits ? `${self ? 'Your' : 'Their'} access is limited to ${plural(limits, 'set of rows', 'sets of rows')} — see “Limited to” below.`
            : `${self ? 'Your' : 'Their'} access covers every row: no limits are set.`}
          {shares > 0 && ` ${plural(shares, 'row is', 'rows are')} also shared with ${self ? 'you' : 'them'} directly.`}
        </li>
      </ul>
      {!everyTable && tables.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-sm font-medium text-action hover:underline" aria-expanded={all}
            onClick={() => setAll(!all)} data-testid="access-show-all">
            {all ? 'Hide the tables' : `Show all ${plural(tables.length, 'table')}`}
          </button>
          {all && <div className="mt-2"><AreaGroups tables={tables} showRoles={roles.length > 1} /></div>}
        </div>
      )}
    </Card>
  )
}

// ── (a) By role: one card per role, its Tables grouped by area ───────────────

export function RolesLayout({ roles, tables, everyTable, self }: { roles: RoleRow[]; tables: Reached[]; everyTable: boolean; self: boolean }) {
  const you = self ? 'You' : 'They'
  if (everyTable) return <Card className="p-4"><p className="text-sm text-ink" data-testid="access-every-table">Every Table, to read and to change — through System Manager.</p></Card>
  return (
    <div className="space-y-3" data-testid="access-by-role">
      {roles.map((r) => {
        const reach = tablesOf(r.role, tables)
        return (
          <Card key={`${r.app ?? ''}/${r.role}/${r.through ?? ''}`} className="p-4" data-testid="access-role-card">
            <h2 className="text-base font-semibold text-ink">{r.role}</h2>
            <p className="text-sm"><GivenBy r={r} /></p>
            <p className="mt-1 text-sm text-ink">{reach.length ? `${roleSentence(reach, you)}.` : 'Reaches no tables of its own.'}</p>
            {reach.length > 0 && (
              <div className="mt-2 space-y-2">
                {byArea(reach).map(([area, ts]) => (
                  <Group key={area} title={area} count={plural(ts.length, 'table')} testid="access-area-group">
                    <TableRows tables={ts} showRoles={false} />
                  </Group>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ── (b) By area: each area lists its Tables with chips ──────────────────────

function AreaGroups({ tables, showRoles }: { tables: Reached[]; showRoles: boolean }) {
  return (
    <div className="space-y-2">
      {byArea(tables).map(([area, ts]) => {
        const changes = ts.filter((t) => t.change).length
        return (
          <Group key={area} title={area} testid="access-area-group"
            count={changes === ts.length ? `${ts.length} · change all` : changes ? `${ts.length} · change ${changes}` : `${ts.length} · read only`}>
            <TableRows tables={ts} showRoles={showRoles} />
          </Group>
        )
      })}
    </div>
  )
}

export function AreasLayout({ tables, everyTable, roles }: { tables: Reached[]; everyTable: boolean; roles: number }) {
  return (
    <Card className="p-4" data-testid="access-by-area">
      {everyTable
        ? <p className="text-sm text-ink" data-testid="access-every-table">Every Table, to read and to change — through System Manager.</p>
        : tables.length === 0 ? <p className="text-sm text-ink-muted">No Tables.</p>
        : <AreaGroups tables={tables} showRoles={roles > 1} />}
    </Card>
  )
}
