// #1282 F1–F6 (UI owner, option A): Business Roles as a grid: permissions × roles, each cell
// stepping — · Own · Team · Area · All. Changes wait (the dark bar) until Review and save shows
// one sentence per change, old → new, and the people it touches; Save sends them to Dash's
// change_permissions, which checks them whole and logs each. Read-only for anyone who may not.
import { useEffect, useState } from 'react'
import { Button, Grid, Notice, PendingBar, Sentence, gridKey, type GridColumn, type GridRow, type SentencePart } from '@featherbase/shop-floor'
import { act } from './api'
import { REACH_CHIP, rolePlural, type Reach } from './business-roles'
import { RecordLink } from './record-link'

export const ROLE_TABLE = 'dash.business_role'
/** Both sides at most this many: a bigger grid is no longer read at a glance. */
export const GRID_MOST = 40
const STEPS = (['Own', 'Team', 'Area', 'All'] as const).map(value => ({ value, label: value }))

interface Permission { app: string; level: string; verb: string; thing: string; reach: string }
export interface GridRole { id: string; name: string; permissions: Permission[]; people: number; holders: { person: string; name: string }[] }
interface PermissionRow extends GridRow { app: string; level: string; verb: string; thing: string }

/** A permission's row id, as the grid keys it: "Dash / Manager / Edit / Sections". */
const keyOf = (p: { app: string; level: string; verb: string; thing: string }) => [p.app, p.level, p.verb, p.thing].join(' / ')
const reachWords = (reach: string | null) => (reach ? REACH_CHIP[reach as Reach] : 'nothing')
const roleRecord = (role: GridRole): SentencePart => ({ record: { table: ROLE_TABLE, row: role.id, name: rolePlural(role.name) } })
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const sentenceRecord = (record: { table: string; row: string; name: string }) => <RecordLink table={record.table} id={record.row}>{record.name}</RecordLink>

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

export function PermissionsGrid({ roles, mayChange, onSaved, onWaiting, personHref }: {
  roles: GridRole[]; mayChange: boolean; onSaved: () => Promise<void>; onWaiting: (n: number) => void; personHref: (person: string) => string
}) {
  const [waiting, setWaiting] = useState(new Map<string, string | null>())
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => onWaiting(waiting.size), [waiting, onWaiting])
  useLeaveGuard(waiting.size > 0)
  const rows = permissionRows(roles)
  if (rows.length > GRID_MOST || roles.length > GRID_MOST)
    return <p className="text-sm text-ink-muted" data-testid="grid-too-big">The grid shows at most {GRID_MOST} roles and {GRID_MOST} permissions; here there are {roles.length} roles and {rows.length} permissions. Each role&apos;s page says what it can do.</p>
  const byId = new Map(roles.map(r => [r.id, r]))
  const columns: GridColumn[] = roles.map(role => ({ id: role.id, label: role.name, header: <RecordLink table={ROLE_TABLE} id={role.id}>{role.name}</RecordLink> }))
  const savedReach = (row: GridRow, column: GridColumn) => byId.get(column.id)!.permissions.find(p => keyOf(p) === row.id)?.reach ?? null
  const changes = [...waiting].map(([key, to]) => {
    const [rowId, roleId] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)]
    const row = rows.find(r => r.id === rowId)!
    const role = byId.get(roleId)!
    return { row, role, from: savedReach(row, { id: roleId, label: '', header: null }), to }
  })
  const touched = [...new Set(changes.map(c => c.role))]
  const people = touched.reduce((sum, role) => sum + role.people, 0)
  const step = (row: GridRow, column: GridColumn, next: string | null) => setWaiting(before => {
    const after = new Map(before)
    if (next === savedReach(row, column)) after.delete(gridKey(row, column))
    else after.set(gridKey(row, column), next)
    return after
  })
  const saved = async () => { setWaiting(new Map()); setReviewing(false); await onSaved() }
  if (reviewing) return <Review changes={changes} touched={touched} people={people} personHref={personHref} onBack={() => setReviewing(false)} onSaved={saved} />
  return (
    <div data-testid="permissions-grid">
      <Grid label="What each business role can do" rows={rows} columns={columns} steps={STEPS} readOnly={!mayChange}
        saved={savedReach} waiting={waiting} onStep={step}
        tooltip={(row, column, value) => {
          const p = row as PermissionRow
          const who = rolePlural(column.label)
          return value ? `${who} can ${p.verb} ${p.thing} ${reachWords(value)}` : `${who} cannot ${p.verb} ${p.thing}`
        }} />
      {mayChange && waiting.size > 0 && <PendingBar count={waiting.size} people={people} onDiscard={() => setWaiting(new Map())} onReview={() => setReviewing(true)} />}
    </div>
  )
}

/** Before anything is saved: one sentence per change, old → new, and the people they touch. */
function Review({ changes, touched, people, personHref, onBack, onSaved }: {
  changes: { row: PermissionRow; role: GridRole; from: string | null; to: string | null }[]; touched: GridRole[]; people: number; personHref: (person: string) => string; onBack: () => void; onSaved: () => Promise<void>
}) {
  const [names, setNames] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Someone holding two of the changed roles is named once.
  const shown = [...new Map(touched.flatMap(role => role.holders).map(h => [h.person, h])).values()]
  // The same verb and thing at two levels ("Edit Tasks · Manager", "· User"): its sentence names the level.
  const things = changes.map(c => `${c.row.verb} ${c.row.thing}`)
  const atLevels = new Set(things.filter(t => new Set(changes.filter(c => `${c.row.verb} ${c.row.thing}` === t).map(c => c.row.level)).size > 1))
  const save = async () => {
    setBusy(true); setError(null)
    try {
      await act('change_permissions', { changes: changes.map(({ row, role, from, to }) => ({ role: role.id, app: row.app, level: row.level, verb: row.verb, thing: row.thing, from, to })) })
      await onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="grid-review">
      <h2 className="text-base font-semibold">Review {plural(changes.length, 'change', 'changes')}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {changes.map(({ row, role, from, to }) => (
          <li key={`${row.id}|${role.id}`} data-testid="review-line">
            <Sentence parts={[roleRecord(role), ` can ${row.verb} ${row.thing}${atLevels.has(`${row.verb} ${row.thing}`) ? ` (${row.level})` : ''}: ${reachWords(from)} → ${reachWords(to)}`]} renderRecord={sentenceRecord} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">
        Affects about{' '}
        <button type="button" className="text-action hover:underline" aria-expanded={names} onClick={() => setNames(!names)} data-testid="review-people">{plural(people, 'person', 'people')}</button>
        {' '}holding {touched.map(r => r.name).join(', ')}.
      </p>
      {names && (
        <p className="text-sm" data-testid="review-names">
          {shown.map((h, i) => <span key={h.person}>{i ? ', ' : ''}<a className="text-action hover:underline" href={personHref(h.person)}>{h.name}</a></span>)}
          {people > shown.length && ` and ${(people - shown.length).toLocaleString('en-IN')} more`}
        </p>
      )}
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} onClick={save} data-testid="review-save">Save {plural(changes.length, 'change', 'changes')}</Button>
        <Button variant="secondary" onClick={onBack} data-testid="review-back">Back to the grid</Button>
      </div>
    </div>
  )
}
