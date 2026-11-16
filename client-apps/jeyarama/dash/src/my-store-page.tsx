// #1223: Your store, Your floor, Your categories, and the area cards that Your department and Your
// sections show for Department Managers and Team Leaders. What a manager looks after, on a page that
// works on a phone, every record a link to it; the one change made here is Move. The rules are the
// server's (my-store.ts, areas.ts); this page only draws its answer.
import { useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, Field, Notice, SearchInput, Select, StatusPill, TextInput, fmtCount } from '@featherbase/shop-floor'
import { act, read } from './api'
import { LoadFailed, Loading, Shell, useAnswer } from './sections-page'
import { RECORD, RecordLink } from './record-link'

interface PersonRef { code: string; name: string }
interface Section { id: string; name: string; active: boolean; team_leaders: PersonRef[]; subcategories: number }
interface Staff extends PersonRef { job_id: string; job: string; section: string | null; section_id: string | null; reports_to: PersonRef | null; movable: boolean; waiting_for?: string | null }
export interface Place { kind: 'store' | 'floor' | 'department' | 'section'; page: string; store: string; store_id: string; floor: string | null; floor_id: string | null
  department: { id: string; name: string } | null; managers: { store: Ref[]; cluster: Ref[] }; floors: { floor_id: string | null; floor: string; sections: Section[] }[]; staff: Staff[]; sections: { id: string; name: string }[] }
interface Ref { code: string; name: string }
interface Category { category: string; region: string | null; responsibility: string; buyers: { name: string; code: string; assignment: string; buys: string; subcategory: string | null }[]; no_buyer: Ref[] }
interface Buys { assignment: string; level: string | null; named: string; region: string | null; subcategories: Ref[] }
type Answer = { state: 'unknown_person' | 'nothing' } | { state: 'ok'; name: string; code: string; places: Place[]; categories: Category[]; buys: Buys[] }

const SUBCATEGORIES = (n: number) => `${n} ${n === 1 ? 'subcategory' : 'subcategories'}`

/** A person: their staff record, and what they cover. */
function PersonLink({ person }: { person: PersonRef }) {
  return (
    <span className="whitespace-nowrap">
      <RecordLink table={RECORD.employee} id={person.code} className="font-medium">{person.name}</RecordLink>
    </span>
  )
}

/** People in a sentence: "A, B and C". */
function People({ people }: { people: PersonRef[] }) {
  return <>{people.map((p, i) => <span key={p.code}>{i > 0 ? (i === people.length - 1 ? ' and ' : ', ') : ''}<RecordLink table={RECORD.employee} id={p.code}>{p.name}</RecordLink></span>)}</>
}

/** One person in an area: their jobs there (a person with several is one row), first job's manager. */
interface Person extends PersonRef { jobs: Staff[]; reports_to: PersonRef | null }
export function peopleOf(staff: Staff[]): Person[] {
  const byCode = new Map<string, Person>()
  for (const s of staff) {
    const had = byCode.get(s.code)
    if (had) had.jobs.push(s)
    else byCode.set(s.code, { code: s.code, name: s.name, jobs: [s], reports_to: s.reports_to })
  }
  return [...byCode.values()]
}

function MoveStaff({ person, sections, onMoved }: { person: Person; sections: Place['sections']; onMoved: (message: string) => void }) {
  const movable = person.jobs.filter(j => j.movable)
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(movable[0]?.job_id ?? '')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const job = movable.find(j => j.job_id === from) ?? movable[0]
  const choices = sections.filter(s => s.id !== job?.section_id)
  if (!job || !choices.length) return null
  if (!open) return <Button variant="quiet" onClick={() => setOpen(true)} data-testid="move-staff">Move</Button>
  return (
    <div className="flex w-full min-w-64 flex-col gap-2 rounded-control border border-border bg-surface p-3" data-testid="move-form">
      {movable.length > 1 && (
        <Field label="Which job">
          <Select value={from} onChange={e => setFrom(e.target.value)} data-testid="move-from">
            {movable.map(j => <option key={j.job_id} value={j.job_id}>{j.job}{j.section ? ` · ${j.section}` : ''}</option>)}
          </Select>
        </Field>
      )}
      <Field label={`Move ${person.name} to`}>
        <Select value={to} onChange={e => setTo(e.target.value)} data-testid="move-to">
          <option value="">Pick a section</option>
          {choices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!to || busy} onClick={() => {
          setBusy(true); setError(null)
          const name = choices.find(s => s.id === to)?.name ?? ''
          act<{ state: string; reviewer: string | null }>('move_staff', { job: job.job_id, to_section: to })
            .then(r => { onMoved(movedLine(person.name, name, r.state, r.reviewer)); setOpen(false) }, (e: Error) => setError(e.message))
            .finally(() => setBusy(false))
        }} data-testid="move-send">Move</Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

/** What happened, as the instance's approval mode made it happen. */
export function movedLine(person: string, to: string, state: string, reviewer: string | null): string {
  const named = reviewer || 'the master data team'
  const who = named[0].toUpperCase() + named.slice(1)
  return state === 'Pending' ? `Asked to move ${person} to ${to}. ${who} decides.` : `Moved ${person} to ${to}. ${who} reviews it.`
}

/** What a manager's add or removal did, as the approval mode made it happen. */
export function changedLine(kind: 'add' | 'removal', what: string, section: string, state: string, reviewer: string | null): string {
  const named = reviewer || 'the master data team'
  const who = named[0].toUpperCase() + named.slice(1)
  const done = kind === 'add' ? `Added ${what} to ${section}` : `Took ${what} out of ${section}`
  const asked = kind === 'add' ? `Asked to add ${what} to ${section}` : `Asked to take ${what} out of ${section}`
  return state === 'Pending' ? `${asked}. ${who} decides.` : `${done}. ${who} reviews it.`
}

type Placed = { state: 'ok'; section: { id: string; name: string }; placed: { placement: string; code: string; name: string }[] } | { state: 'not_allowed' }

/** #1223: a section's subcategories, each removable, and a search to add one. A manager's change is reviewed by their manager. */
function SectionEditor({ section, onChanged }: { section: { id: string; name: string }; onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState<Placed | undefined>()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ code: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => read<Placed>('section_subcategories', { section: section.id }).then(setPlaced, () => setError('These subcategories could not load. Try again.'))
  useEffect(() => { if (open && !placed) void load() }, [open])
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return }
    const timer = setTimeout(() => { read<{ code: string; name: string }[]>('find_subcategories', { q }).then(setFound, () => setFound([])) }, 250)
    return () => clearTimeout(timer)
  }, [q])
  const change = (name: 'manage_add' | 'manage_remove', payload: Record<string, unknown>, what: string) => {
    setBusy(true); setError(null)
    act<{ state: string; waiting_for: string | null }>(name, payload)
      .then(r => { onChanged(changedLine(name === 'manage_add' ? 'add' : 'removal', what, section.name, r.state, r.waiting_for)); setQ(''); void load() }, (e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  if (!open) return <Button variant="quiet" onClick={() => setOpen(true)} data-testid="edit-subcategories">Edit subcategories</Button>
  const here = new Set(placed?.state === 'ok' ? placed.placed.map(p => p.code) : [])
  return (
    <div className="mt-2 flex w-full flex-col gap-3 rounded-md border border-border p-3" data-testid="section-editor">
      {placed?.state === 'not_allowed' && <Notice tone="negative">This section isn't in your area.</Notice>}
      {placed?.state === 'ok' && (
        <ul className="flex flex-col divide-y divide-border">
          {placed.placed.length === 0 && <li className="py-1 fd-muted text-sm">No subcategories in this section yet.</li>}
          {placed.placed.map(p => (
            <li key={p.placement} className="flex items-center justify-between gap-2 py-1" data-testid="placed-row">
              <RecordLink table={RECORD.subcategory} id={p.code} className="text-sm">{p.name}</RecordLink>
              <Button variant="quiet" disabled={busy} onClick={() => change('manage_remove', { placement: p.placement }, p.name)} data-testid="remove-subcategory">Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <Field label={`Add a subcategory to ${section.name}`}>
        <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Name or code" data-testid="find-subcategory" />
      </Field>
      {found.filter(f => !here.has(f.code)).length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {found.filter(f => !here.has(f.code)).map(f => (
            <li key={f.code} className="flex items-center justify-between gap-2 py-1" data-testid="found-row">
              <span className="text-sm"><RecordLink table={RECORD.subcategory} id={f.code}>{f.name}</RecordLink> <span className="text-ink-muted">({f.code})</span></span>
              <Button variant="secondary" disabled={busy} onClick={() => change('manage_add', { section: section.id, subcategory: f.code }, f.name)} data-testid="add-subcategory">Add</Button>
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="negative">{error}</Notice>}
      <div><Button variant="secondary" onClick={() => setOpen(false)}>Done</Button></div>
    </div>
  )
}

const TH = 'px-3 py-2 text-left text-[13px] font-medium text-ink-muted'
// Cells wrap only where words allow (a space, a hyphen), never mid-word: the shared link breaks anywhere by default.
const TD = 'px-3 py-2 align-top text-sm [&_*]:wrap-normal [&_[data-table=Employee]]:whitespace-nowrap'

/** A <details> list that closes as a menu does: on Escape (focus back on its summary) and on a press outside it. */
function useClosesLikeAMenu() {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = ref.current
      if (e.key !== 'Escape' || !list?.open) return
      list.open = false
      list.querySelector('summary')?.focus()
    }
    const onPress = (e: MouseEvent) => {
      const list = ref.current
      if (list?.open && !list.contains(e.target as Node)) list.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onPress) }
  }, [])
  return ref
}

/** "Kavya, Meena +2 more": the first two as links, the rest in a popover, all links. */
export function FewPeople({ people }: { people: PersonRef[] }) {
  const more = useClosesLikeAMenu()
  if (!people.length) return <span className="text-ink-muted">—</span>
  const rest = people.slice(2)
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      {/* Each name keeps its comma and never breaks inside itself, so no line starts with ", ". */}
      {people.slice(0, 2).map((p, i, shown) => <span key={p.code} className="whitespace-nowrap"><RecordLink table={RECORD.employee} id={p.code}>{p.name}</RecordLink>{i < shown.length - 1 || rest.length ? ',' : ''}</span>)}
      {rest.length > 0 && (
        // One list open at a time (an exclusive group), so two never cover each other.
        <details ref={more} name="more-people" className="relative inline-block" data-testid="more-people">
          <summary className="cursor-pointer list-none text-ink-muted hover:underline">+{rest.length} more</summary>
          <div className="absolute z-10 mt-1 flex min-w-48 flex-col gap-1 rounded-control border border-border bg-surface p-2 shadow-lg">
            {rest.map(p => <RecordLink key={p.code} table={RECORD.employee} id={p.code}>{p.name}</RecordLink>)}
          </div>
        </details>
      )}
    </span>
  )
}

/** A section's gaps: closed, no Team Leader, or holding no subcategory. */
const gapsOf = (s: Section) => [...(!s.active ? ['Closed'] : []), ...(s.active && !s.team_leaders.length ? ['No Team Leader'] : []), ...(s.active && !s.subcategories ? ['No subcategories'] : [])]

/** Spec item 3: Sections · Staff · Subcategories · Gaps, the gaps a link to the first gap row. */
function SummaryStrip({ place }: { place: Place }) {
  const sections = place.floors.flatMap(f => f.sections)
  const gaps = sections.filter(s => gapsOf(s).length)
  const tiles: [string, number, string | null][] = [
    ['Sections', sections.length, null], ['Staff', peopleOf(place.staff).length, null],
    ['Subcategories', sections.reduce((n, s) => n + s.subcategories, 0), null], ['Gaps', gaps.length, gaps[0] ? `#gap-${gaps[0].id}` : null],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="summary-strip">
      {tiles.map(([label, n, href]) => {
        const warn = label === 'Gaps' && n > 0
        const body = <><span className="text-[13px] text-ink-muted">{label}</span><span className={`text-2xl font-semibold tabular-nums ${warn ? 'text-caution' : 'text-ink'}`}>{fmtCount(n)}</span></>
        const cls = `flex flex-col rounded-card border p-3 ${warn ? 'border-caution bg-caution-tint text-caution' : 'border-border bg-surface'}`
        return href ? <a key={label} href={href} className={`${cls} hover:underline`} data-testid="summary-gaps">{body}</a> : <div key={label} className={cls}>{body}</div>
      })}
    </div>
  )
}

/** Spec item 4: one table, grouped by floor; each section a link, its Team Leaders, count, and a status pill only when there's a gap. */
function SectionsTable({ place, onChanged }: { place: Place; onChanged: (message: string) => void }) {
  return (
    <Card title="Sections" data-testid="area-sections">
      {place.floors.length === 0 ? <p className="fd-muted p-4">No sections are set up here yet. The master data team adds them.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-subtle"><tr><th className={TH}>Section</th><th className={TH}>Team Leaders</th><th className={`${TH} text-right`}>Subcategories</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {place.floors.map(group => [
                place.kind !== 'floor' && (
                  <tr key={`f-${group.floor}`} className="border-t border-border bg-canvas" data-testid="area-floor">
                    <td colSpan={5} className="px-3 py-1.5 text-[13px] font-semibold"><RecordLink table={RECORD.floor} id={group.floor_id}>{group.floor}</RecordLink> <span className="font-normal text-ink-muted">· {group.sections.length}</span></td>
                  </tr>
                ),
                ...group.sections.map(s => (
                  <tr key={s.id} id={gapsOf(s).length ? `gap-${s.id}` : undefined} className="group scroll-mt-24 border-t border-border hover:bg-subtle target:bg-caution-tint" data-testid="area-section">
                    <td className={`${TD} min-w-36 [&_*]:break-normal`}><RecordLink table={RECORD.section} id={s.id}>{s.name}</RecordLink></td>
                    <td className={TD}><FewPeople people={s.team_leaders} /></td>
                    <td className={`${TD} text-right tabular-nums`}><RecordLink table={RECORD.section} id={s.id}>{fmtCount(s.subcategories)}</RecordLink></td>
                    <td className={TD}>{gapsOf(s).map(g => <StatusPill key={g} tone="caution" className="mr-1">{g}</StatusPill>)}</td>
                    <td className={`${TD} whitespace-nowrap text-right`}>{s.active && place.kind !== 'section' && (
                      <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [&:has([data-testid=section-editor])]:opacity-100"><SectionEditor section={s} onChanged={onChanged} /></span>
                    )}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** Remembered per person in this browser (standard rule 4); never required. */
function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial } catch { return initial } })
  return [value, (next: T) => { setValue(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* not remembered */ } }]
}

/** Spec items 5–10: staff in one table grouped by section, one row per person, a quiet Move, and a toolbar. */
function StaffTable({ place, onMoved, title }: { place: Place; onMoved: (message: string) => void; title: string }) {
  const [filters, setFilters] = useRemembered(`dash.staff-filters.${place.kind}`, { q: '', job: '', section: '' })
  const people = peopleOf(place.staff)
  const jobs = [...new Set(place.staff.map(s => s.job))].sort()
  const q = filters.q.trim().toLowerCase()
  const shown = people.filter(p => (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    && (!filters.job || p.jobs.some(j => j.job === filters.job)) && (!filters.section || p.jobs.some(j => j.section_id === filters.section)))
  const groupOf = (p: Person) => p.jobs.find(j => j.section_id) ?? null
  const groups = [...new Map(shown.map(p => { const j = groupOf(p); return [j?.section_id ?? '', { id: j?.section_id ?? null, name: j?.section ?? 'No section' }] })).values()]
    .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name))
  const on = Boolean(filters.q || filters.job || filters.section)
  return (
    <Card title={title} data-testid="area-staff">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[13px] text-ink-muted">Their manager, or the master data team, reviews each move. Joining, leaving and job changes come from HR.</p>
        <div className="flex flex-wrap items-end gap-2" data-testid="staff-toolbar">
          <div className="w-64"><SearchInput aria-label="Search staff by name or code" placeholder="Search by name or code" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} data-testid="staff-search" /></div>
          <Select aria-label="Job" value={filters.job} onChange={e => setFilters({ ...filters, job: e.target.value })} data-testid="staff-job">
            <option value="">Every job</option>{jobs.map(j => <option key={j} value={j}>{j}</option>)}
          </Select>
          <Select aria-label="Section" value={filters.section} onChange={e => setFilters({ ...filters, section: e.target.value })} data-testid="staff-section">
            <option value="">Every section</option>{place.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {on && <Button variant="quiet" onClick={() => setFilters({ q: '', job: '', section: '' })} data-testid="clear-filters">Clear filters</Button>}
        </div>
      </div>
      {shown.length === 0 ? <p className="fd-muted px-4 pb-4">{people.length ? 'No one matches these filters.' : 'No one else works here yet.'}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-subtle"><tr><th className={TH}>Person</th><th className={TH}>Job</th><th className={TH}>Reports to</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {groups.map(g => [
                <tr key={`g-${g.id}`} className="border-t border-border bg-canvas" data-testid="staff-group">
                  <td colSpan={4} className="px-3 py-1.5 text-[13px] font-semibold"><RecordLink table={RECORD.section} id={g.id}>{g.name}</RecordLink> <span className="font-normal text-ink-muted">· {shown.filter(p => (groupOf(p)?.section_id ?? null) === g.id).length}</span></td>
                </tr>,
                ...shown.filter(p => (groupOf(p)?.section_id ?? null) === g.id).map(p => {
                  const waiting = p.jobs.find(j => j.waiting_for)?.waiting_for
                  return (
                    <tr key={p.code} className="group border-t border-border hover:bg-subtle" data-testid="area-person">
                      <td className={TD}>
                        <RecordLink table={RECORD.employee} id={p.code}>{p.name}</RecordLink>
                        <span className="block text-[13px] text-ink-muted">{p.code} · {p.jobs[0].job}</span>
                        {waiting && <StatusPill tone="caution" className="mt-1" data-testid="waiting-pill">Waiting for {waiting}</StatusPill>}
                      </td>
                      <td className={TD}>
                        {[...new Set(p.jobs.map(j => j.job))].join(', ')}
                        {p.jobs.filter(j => j.section_id).length > 1 && (
                          <span className="mt-1 flex flex-wrap gap-1" data-testid="section-chips">
                            {p.jobs.filter(j => j.section_id).map(j => <span key={j.job_id} className="rounded-full border border-border px-2 text-xs"><RecordLink table={RECORD.section} id={j.section_id}>{j.section}</RecordLink></span>)}
                          </span>
                        )}
                      </td>
                      <td className={TD}>{p.reports_to ? <RecordLink table={RECORD.employee} id={p.reports_to.code}>{p.reports_to.name}</RecordLink> : <span className="text-ink-muted">—</span>}</td>
                      <td className={`${TD} text-right`}>
                        <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [&:has([data-testid=move-form])]:opacity-100"><MoveStaff person={p} sections={place.sections} onMoved={onMoved} /></span>
                      </td>
                    </tr>
                  )
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** The area's name as a line of links under the page title (spec item 2): "First floor · Lakeside". */
function AreaTitle({ place }: { place: Place }) {
  return (
    <span className="inline-flex flex-wrap gap-x-1" data-testid="area-title">
      {place.department && <><RecordLink table={RECORD.department} id={place.department.id}>{place.department.name}</RecordLink><span aria-hidden="true">·</span></>}
      {place.floor && <><RecordLink table={RECORD.floor} id={place.floor_id}>{place.floor}</RecordLink><span aria-hidden="true">·</span></>}
      <RecordLink table={RECORD.site} id={place.store_id}>{place.store}</RecordLink>
    </span>
  )
}

/** #1245: who runs the store, under the area's title: "Store Manager: Selvi · Cluster Manager: Kiran, Lata". */
export function StoreRunBy({ managers, store }: { managers: Place['managers']; store?: { id: string; name: string } }) {
  // Each label stays on one line with its first name, so a row never ends on "Cluster Manager:".
  const names = (label: string, people: Ref[], lead = '') => people.map((p, i) => (
    <span key={p.code} className="whitespace-nowrap">{i === 0 && <span className="text-ink-muted">{lead}{label}: </span>}<RecordLink table={RECORD.employee} id={p.code}>{p.name}</RecordLink>{i < people.length - 1 ? ', ' : ''}</span>))
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1" data-testid="store-run-by">
      {store && <><RecordLink table={RECORD.site} id={store.id}>{store.name}</RecordLink><span aria-hidden="true" className="text-ink-muted"> · </span></>}
      {managers.store.length ? names('Store Manager', managers.store) : <span className="text-ink-muted">No store manager</span>}
      {managers.cluster.length > 0 && names('Cluster Manager', managers.cluster, '· ')}
    </span>
  )
}

function PlaceCard({ place, onMoved, staffOnly = false }: { place: Place; onMoved: (message: string) => void; staffOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-4" data-testid="area-place">
      <div className="flex flex-col gap-1 text-sm">{!staffOnly && <AreaTitle place={place} />}<StoreRunBy managers={place.managers} store={staffOnly ? { id: place.store_id, name: place.store } : undefined} /></div>
      {!staffOnly && <SummaryStrip place={place} />}
      {!staffOnly && <SectionsTable place={place} onChanged={onMoved} />}
      <StaffTable place={place} onMoved={onMoved} title={staffOnly ? 'Your team' : 'Staff'} />
    </div>
  )
}

function Categories({ categories, buys }: { categories: Category[]; buys: Buys[] }) {
  return (
    <>
      {categories.map(c => (
        <Card key={`${c.category}|${c.region}`} data-testid="area-category"
          title={<span className="inline-flex flex-wrap gap-x-1">Buyers · <RecordLink table={RECORD.category} id={c.category}>{c.category}</RecordLink>{c.region && <> · <RecordLink table={RECORD.region} id={c.region}>{c.region}</RecordLink></>}</span>}>
          <div className="flex flex-col gap-3 p-4">
            <ul className="flex flex-col divide-y divide-border">
              {c.buyers.map(b => (
                <li key={b.assignment} className="flex flex-wrap justify-between gap-2 py-2" data-testid="area-buyer">
                  <span><PersonLink person={b} /> <span className="text-sm text-ink-muted">({b.code})</span></span>
                  <RecordLink table={b.subcategory ? RECORD.subcategory : RECORD.merchandise} id={b.subcategory ?? b.assignment} className="text-sm">{b.buys}</RecordLink>
                </li>
              ))}
              {c.buyers.length === 0 && <li className="py-2 fd-muted">No buyer is named for {c.category} yet.</li>}
            </ul>
            {c.no_buyer.length > 0 && (
              <Notice tone="caution" data-testid="no-buyer">No buyer for {SUBCATEGORIES(c.no_buyer.length)}: {c.no_buyer.map((s, i) => <span key={s.code}>{i ? ', ' : ''}<RecordLink table={RECORD.subcategory} id={s.code}>{s.name}</RecordLink></span>)}</Notice>
            )}
            <p className="fd-muted text-sm">Changing who buys what goes to the master data team until Buyer Sections arrives.</p>
          </div>
        </Card>
      ))}
      {buys.map(b => (
        <Card key={b.assignment} data-testid="area-buys"
          title={<span className="inline-flex flex-wrap gap-x-1">You buy · <RecordLink table={RECORD.merchandise} id={b.assignment}>{b.named || 'nothing named'}</RecordLink>{b.region && <> · <RecordLink table={RECORD.region} id={b.region}>{b.region}</RecordLink></>}</span>}>
          <div className="p-4 text-sm">
            {b.subcategories.length
              ? <p>{b.subcategories.map((s, i) => <span key={s.code}>{i ? ', ' : ''}<RecordLink table={RECORD.subcategory} id={s.code}>{s.name}</RecordLink></span>)}</p>
              : <p className="fd-muted">No subcategories.</p>}
          </div>
        </Card>
      ))}
    </>
  )
}

/** One notice for what a Move did, scrolled into view and clear of the sticky top bar on a phone. */
function useMoved(reload: () => void) {
  const [notice, setNotice] = useState<string | null>(null)
  const at = useRef<HTMLDivElement>(null)
  useEffect(() => { if (notice) at.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [notice])
  const view = <div ref={at} className="scroll-mt-20">{notice && <Notice tone="positive" data-testid="moved-note">{notice}</Notice>}</div>
  return { view, moved: (message: string) => { setNotice(message); reload() } }
}

/** The area cards inside another page: a Department Manager's department, a Team Leader's team. */
export function AreaCards({ kinds, staffOnly = false }: { kinds: Place['kind'][]; staffOnly?: boolean }) {
  const [answer, setAnswer] = useState<Answer | undefined>()
  const load = () => { read<Answer>('my_store', { kinds }).then(setAnswer, () => {}) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])
  const { view, moved } = useMoved(load)
  if (answer?.state !== 'ok' || !answer.places?.length) return null
  return <div className="flex flex-col gap-4" data-testid="area-cards">{view}{answer.places.map(place => <PlaceCard key={`${place.kind}-${place.store_id}-${place.department?.id ?? place.floor_id ?? ''}`} place={place} onMoved={moved} staffOnly={staffOnly} />)}</div>
}

export function YourStore() {
  const { answer, failed, load } = useAnswer<Answer>('my_store')
  const { view, moved } = useMoved(() => void load())
  const shown = answer?.state === 'ok' ? answer.places.filter(p => p.kind === 'store' || p.kind === 'floor') : []
  const title = answer?.state === 'ok' ? (shown[0]?.page ?? 'Your categories') : 'Your store'
  return (
    <Shell current="store" title={title} testid="your-store">
      {!answer && !failed && <Loading />}
      {failed && <LoadFailed onRetry={load} />}
      {answer?.state === 'unknown_person' && <Card><EmptyState title="We can't find you on the staff list yet" body="Ask your manager to check that HR has you on the list." /></Card>}
      {(answer?.state === 'nothing' || (answer?.state === 'ok' && !shown.length && !answer.categories.length && !answer.buys.length)) &&
        <Card data-testid="nothing"><EmptyState title="You don't manage a store, floor or category" body="Department Managers see their department on Your department; Team Leaders see their team on Your sections." /></Card>}
      {answer?.state === 'ok' && (
        <>
          {view}
          {shown.map(place => <PlaceCard key={`${place.kind}-${place.store_id}-${place.floor_id ?? ''}`} place={place} onMoved={moved} />)}
          <Categories categories={answer.categories} buys={answer.buys} />
        </>
      )}
    </Shell>
  )
}
