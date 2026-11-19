// #1282 F1–F6 (UI owner, option A): Business Roles as grids. Permissions × roles, each cell stepping
// — · Own · Team · Area · All; and reports and bundles × roles, each cell a tick. Changes wait (the
// dark bar) until Review and save shows one line per change, old → new, and the people it touches;
// Save sends them to Dash, which checks them whole. Read-only for anyone who may not change them.
import { useEffect, useState } from 'react'
import { Button, Grid, Notice, PendingBar, Sentence, gridKey, type GridColumn, type GridRow, type GridStep, type SentencePart } from '@featherbase/shop-floor'
import { act } from './api'
import { REACH_CHIP, rolePlural, type Reach } from './business-roles'
import { RecordLink } from './record-link'

export const ROLE_TABLE = 'dash.business_role'
/** Both sides at most this many: a bigger grid is no longer read at a glance. */
export const GRID_MOST = 40
const REACH_STEPS = (['Own', 'Team', 'Area', 'All'] as const).map(value => ({ value, label: value }))
const TICK_STEPS = [{ value: 'given', label: '✓' }]

interface Permission { app: string; level: string; verb: string; thing: string; reach: string }
export interface GridRole { id: string; name: string; permissions: Permission[]; given: string[]; people: number; holders: { person: string; name: string }[] }
export interface GivenThing { table: string; key: string; name: string }
interface PermissionRow extends GridRow { app: string; level: string; verb: string; thing: string }
interface ReportRow extends GridRow { table: string; key: string }
interface Change<R extends GridRow> { row: R; role: GridRole; from: string | null; to: string | null }

/** A permission's row id, as the grid keys it: "Dash / Manager / Edit / Sections". */
const keyOf = (p: { app: string; level: string; verb: string; thing: string }) => [p.app, p.level, p.verb, p.thing].join(' / ')
const reachWords = (reach: string | null) => (reach ? REACH_CHIP[reach as Reach] : 'not given')
const roleRecord = (role: GridRole): SentencePart => ({ record: { table: ROLE_TABLE, row: role.id, name: rolePlural(role.name) } })
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const sentenceRecord = (record: { table: string; row: string; name: string }) => <RecordLink table={record.table} id={record.row}>{record.name}</RecordLink>
const lower = (words: string) => words.toLowerCase()

/** Every permission any role has, one row each, grouped by app, in the order the apps first appear. */
export function permissionRows(roles: GridRole[]): PermissionRow[] {
  const rows = new Map<string, PermissionRow>()
  for (const role of roles) for (const p of role.permissions) {
    const id = keyOf(p)
    if (!rows.has(id)) rows.set(id, { id, group: p.app, title: `${p.verb} ${p.thing} · ${p.level}`, app: p.app, level: p.level, verb: p.verb, thing: p.thing })
  }
  const apps = [...new Set([...rows.values()].map(r => r.app))]
  return [...rows.values()].sort((a, b) => apps.indexOf(a.app) - apps.indexOf(b.app) || a.thing.localeCompare(b.thing) || a.verb.localeCompare(b.verb) || a.level.localeCompare(b.level))
}

/** Whether the page has changes waiting, so leaving it asks first (#1282 F6). */
export function useLeaveGuard(waiting: boolean) {
  useEffect(() => {
    if (!waiting) return
    const ask = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [waiting])
}

interface Shared { roles: GridRole[]; mayChange: boolean; onSaved: () => Promise<void>; onWaiting: (n: number) => void; personHref: (person: string) => string }

/** Permissions × roles: what each business role can do, and how far. */
export function PermissionsGrid(props: Shared) {
  const rows = permissionRows(props.roles)
  return (
    <ChangesGrid<PermissionRow> {...props} testid="permissions-grid" label="What each business role can do" rows={rows} steps={REACH_STEPS} things="permissions"
      saved={(row, role) => role.permissions.find(p => keyOf(p) === row.id)?.reach ?? null}
      tooltip={(row, role, value) => (value
        ? `${rolePlural(role.name)} can ${lower(row.verb)} ${lower(row.thing)} — ${reachWords(value)}`
        : `${rolePlural(role.name)} can't ${lower(row.verb)} ${lower(row.thing)}`)}
      line={({ row, role, from, to }, changes) => {
        // The same verb and thing changed at two levels ("Edit Tasks · Manager", "· User"): its line names the level.
        const levels = new Set(changes.filter(c => c.row.verb === row.verb && c.row.thing === row.thing).map(c => c.row.level)).size
        return [roleRecord(role), ` · ${row.verb} ${row.thing}${levels > 1 ? ` (${row.level})` : ''}: ${reachWords(from)} → ${reachWords(to)}`]
      }}
      save={changes => act('change_permissions', { changes: changes.map(({ row, role, from, to }) => ({ role: role.id, app: row.app, level: row.level, verb: row.verb, thing: row.thing, from, to })) })} />
  )
}

/** Reports and bundles × roles: which each business role is given, each in its own area. */
export function ReportsGrid(props: Shared & { catalog: GivenThing[] }) {
  // A report or a bundle is a record: its title is its RecordLink.
  const rows: ReportRow[] = props.catalog.map(t => ({ id: `${t.table}|${t.key}`, group: t.table === 'dash.report' ? 'Reports' : 'Bundles', title: t.name,
    titleNode: <RecordLink table={t.table} id={t.key}>{t.name}</RecordLink>, table: t.table, key: t.key }))
    // Reports first, then bundles, each by name.
    .sort((a, b) => Number(a.group === 'Bundles') - Number(b.group === 'Bundles') || a.title.localeCompare(b.title))
  const given = (value: string | null) => (value ? 'given' : 'not given')
  return (
    <ChangesGrid<ReportRow> {...props} testid="reports-grid" label="Which reports each business role is given" rows={rows} steps={TICK_STEPS} things="reports and bundles"
      saved={(row, role) => (role.given.includes(row.id) ? 'given' : null)}
      tooltip={(row, role, value) => `${rolePlural(role.name)} ${value ? 'are given' : "aren't given"} ${row.title}`}
      line={({ row, role, from, to }) => [roleRecord(role), ' · ', { record: { table: row.table, row: row.key, name: row.title } }, `: ${given(from)} → ${given(to)}`]}
      save={changes => act('change_report_grants', { changes: changes.map(({ row, role, from, to }) => ({ role: role.id, table: row.table, key: row.key, from: from !== null, to: to !== null })) })} />
  )
}

/** A grid of changes waiting until reviewed and saved, whatever its cells hold. */
function ChangesGrid<R extends GridRow>({ roles, mayChange, onSaved, onWaiting, personHref, testid, label, rows, steps, things, saved, tooltip, line, save }: Shared & {
  testid: string; label: string; rows: R[]; steps: GridStep[]; things: string
  saved: (row: R, role: GridRole) => string | null
  tooltip: (row: R, role: GridRole, value: string | null) => string
  line: (change: Change<R>, changes: Change<R>[]) => SentencePart[]
  save: (changes: Change<R>[]) => Promise<unknown>
}) {
  const [waiting, setWaiting] = useState(new Map<string, string | null>())
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => onWaiting(waiting.size), [waiting, onWaiting])
  useLeaveGuard(waiting.size > 0)
  if (rows.length > GRID_MOST || roles.length > GRID_MOST)
    return <p className="text-sm text-ink-muted" data-testid="grid-too-big">The grid shows at most {GRID_MOST} roles and {GRID_MOST} {things}; here there are {roles.length} roles and {rows.length} {things}. Each role&apos;s page says what it has.</p>
  const byId = new Map(roles.map(r => [r.id, r]))
  const columns: GridColumn[] = roles.map(role => ({ id: role.id, label: role.name, header: <RecordLink table={ROLE_TABLE} id={role.id}>{role.name}</RecordLink> }))
  const savedValue = (row: GridRow, column: GridColumn) => saved(row as R, byId.get(column.id)!)
  const changes: Change<R>[] = [...waiting].map(([key, to]) => {
    const [rowId, roleId] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)]
    const row = rows.find(r => r.id === rowId)!
    const role = byId.get(roleId)!
    return { row, role, from: saved(row, role), to }
  })
  const touched = [...new Set(changes.map(c => c.role))]
  const people = touched.reduce((sum, role) => sum + role.people, 0)
  const step = (row: GridRow, column: GridColumn, next: string | null) => setWaiting(before => {
    const after = new Map(before)
    if (next === savedValue(row, column)) after.delete(gridKey(row, column))
    else after.set(gridKey(row, column), next)
    return after
  })
  const done = async () => { setWaiting(new Map()); setReviewing(false); await onSaved() }
  if (reviewing)
    return <Review lines={changes.map(c => ({ key: `${c.row.id}|${c.role.id}`, parts: line(c, changes) }))} touched={touched} people={people} personHref={personHref}
      onBack={() => setReviewing(false)} onSave={async () => { await save(changes); await done() }} />
  return (
    // Room under the last row for the dark bar, so it never covers a row (UI owner).
    <div data-testid={testid} className={waiting.size > 0 ? 'pb-16' : undefined}>
      <Grid label={label} rows={rows} columns={columns} steps={steps} readOnly={!mayChange} saved={savedValue} waiting={waiting} onStep={step}
        tooltip={(row, column, value) => tooltip(row as R, byId.get(column.id)!, value)} />
      {mayChange && waiting.size > 0 && <PendingBar count={waiting.size} people={people} onDiscard={() => setWaiting(new Map())} onReview={() => setReviewing(true)} />}
    </div>
  )
}

/** Before anything is saved: one line per change, old → new, and the people they touch. */
function Review({ lines, touched, people, personHref, onBack, onSave }: {
  lines: { key: string; parts: SentencePart[] }[]; touched: GridRole[]; people: number; personHref: (person: string) => string; onBack: () => void; onSave: () => Promise<void>
}) {
  const [names, setNames] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Someone holding two of the changed roles is named once.
  const shown = [...new Map(touched.flatMap(role => role.holders).map(h => [h.person, h])).values()]
  const save = async () => {
    setBusy(true); setError(null)
    try { await onSave() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="grid-review">
      <h2 className="text-base font-semibold">Review {plural(lines.length, 'change', 'changes')}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map(({ key, parts }) => <li key={key} data-testid="review-line"><Sentence parts={parts} renderRecord={sentenceRecord} /></li>)}
      </ul>
      <p className="text-sm text-ink-muted">
        Affects about{' '}
        <button type="button" className="font-medium text-action hover:underline" aria-expanded={names} onClick={() => setNames(!names)} data-testid="review-people">{plural(people, 'person', 'people')}</button>
        {' '}holding {touched.map(r => r.name).join(', ')}.
      </p>
      {names && (
        <p className="text-sm" data-testid="review-names">
          {shown.map((h, i) => <span key={h.person}>{i ? ', ' : ''}<a className="font-medium text-action hover:underline" href={personHref(h.person)}>{h.name}</a></span>)}
          {people > shown.length && ` and ${(people - shown.length).toLocaleString('en-IN')} more`}
        </p>
      )}
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={save} data-testid="review-save">Save {plural(lines.length, 'change', 'changes')}</Button>
        <Button variant="secondary" onClick={onBack} data-testid="review-back">Back to the grid</Button>
      </div>
    </div>
  )
}
