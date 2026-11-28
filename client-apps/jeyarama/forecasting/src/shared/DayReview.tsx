// The day review (#1425; the agreed 26-Nov mockup and Siraj's feedback that day): a section's month day by day against
// Feather Forecast. Days: 01–31 down the page, The Day and Month to Date side by side, a day more than 10% off with a
// coloured edge and Explain. One Day: the day and month-to-date tiles, then the subcategories that day (only those
// more than 10% off, by default). Explain: one or more of five causes, each opening its own tags and the evidence it
// needs, and a note. Shared: a Store Manager's or RB's page shows a store's or a region's days the same way, with
// `levels` above the subcategories (store › section, or section with its floor) to go down one at a time.
import { Fragment, useState, type ReactNode } from 'react'
import { Button, ChipButton, ChoiceChip, RecordLink, Segmented, Select, StatusPill, cx } from '@featherbase/shop-floor'
import { causeOf, causesFor, directionOf, tagOf, TAG_JOIN, type Direction } from '../causes'
import { count, inr } from './model'
import { OFF_POINTS, dayIsOff, daysOf, edgeOf, explanationFor, lineIsOff, type DayExplanation, type DayFigures, type SubDays } from './days'

export interface DayMonth { name: string; days: number; year: number; index: number }
/** A level above the subcategories on a store's or a region's page: the store, or the section (its floor beneath). */
export interface DayLevel {
  /** What one is, in words: "Store", "Section". */
  name: string
  key: (s: SubDays) => string
  /** Its words ("LKS Lakeside"); the key otherwise. */
  label?: (s: SubDays) => string
  /** The grey line under its name: the section's floor. */
  sub?: (s: SubDays) => string
  /** Its place in a list: floors in building order; otherwise by name. */
  order?: (s: SubDays) => number
}
/** Where the page stands: the levels gone down (their keys), and one subcategory or none; with its subcategories. */
export interface DayAt { path: string[]; sub: SubDays | null; members: SubDays[] }
const idOf = (s: SubDays) => s.id ?? s.name
/** What Explain saves: for the section's day (subcategory null) or one subcategory's. */
export interface ExplainDraft { subcategory: string | null; day: number; direction: Direction; causes: string[]; tags: string[]; note: string }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const d2 = (d: number) => String(d).padStart(2, '0')
const weekday = (m: DayMonth, d: number) => WD[new Date(Date.UTC(m.year, m.index, d)).getUTCDay()]
const dayLabel = (m: DayMonth, d: number) => `${d2(d)}-${m.name.slice(0, 3)}-${m.year}`
/** A signed % to one decimal: "−15.6%", "+13.5%". */
const signed = (x: number) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x).toFixed(1)}%`
function Off({ x }: { x: number | null }) {
  if (x == null) return null
  return <StatusPill tone={Math.abs(x) > OFF_POINTS ? (x < 0 ? 'negative' : 'caution') : 'positive'} className="fr-day-pill">{signed(x)}</StatusPill>
}

/** An explained day's tags, each marked with its cause's colour; a cause picked with no tag shows by itself. */
function Tags({ e }: { e: DayExplanation }) {
  const shown = [...e.tags, ...e.causes.filter(c => !e.tags.some(t => t.startsWith(c + TAG_JOIN)))]
  return <span className="fr-day-tags">{shown.map(t => (
    <span key={t} className="fr-day-tag" style={{ boxShadow: `inset 3px 0 0 ${causeOf(t)?.color}` }} title={t}>{t.includes(TAG_JOIN) ? t.split(TAG_JOIN)[1] : t}</span>))}</span>
}

/** Explain: the five causes for the day's direction (below or above the forecast), each opening its tags and evidence
 *  when picked; nothing disappears when picked. */
export function ExplainForm({ title, direction, initial, onSave, onCancel }: {
  title: string; direction: Direction; initial?: DayExplanation
  onSave: (d: Pick<ExplainDraft, 'causes' | 'tags' | 'note'>) => Promise<void> | void; onCancel: () => void
}) {
  const [causes, setCauses] = useState<string[]>(initial?.causes ?? [])
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const toggleCause = (c: string) => {
    if (causes.includes(c)) { setCauses(causes.filter(x => x !== c)); setTags(tags.filter(t => !t.startsWith(c + TAG_JOIN))) } else setCauses([...causes, c])
  }
  const toggleTag = (t: string) => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])
  return (
    <div className="fr-explain" data-testid="explain-form" onClick={e => e.stopPropagation()}>
      <p className="fr-explain-title">{title}</p>
      <div className="fr-explain-causes">{causesFor(direction).map(c => {
        const on = causes.includes(c.name)
        return (
          <div key={c.name} className="fr-explain-cause" style={{ boxShadow: `inset 3px 0 0 ${c.color}` }}>
            <ChoiceChip picked={on} onToggle={() => toggleCause(c.name)} className="fr-explain-chip">{c.name}</ChoiceChip>
            {on && <>
              <div className="fr-explain-tags">{c.tags.map(t => <ChoiceChip key={t} picked={tags.includes(tagOf(c.name, t))} onToggle={() => toggleTag(tagOf(c.name, t))}>{t}</ChoiceChip>)}</div>
              <p className="fr-explain-evidence">Evidence: {c.evidence}</p>
            </>}
          </div>)
      })}</div>
      <textarea className="fr-explain-note" rows={3} aria-label="What happened" placeholder="What happened, and whether it carries into the coming days"
        value={note} onChange={e => setNote(e.target.value)} />
      <div className="fr-explain-actions">
        <Button variant="primary" disabled={!causes.length} loading={saving}
          onClick={async () => { setSaving(true); try { await onSave({ causes, tags, note: note.trim() }) } finally { setSaving(false) } }}>Save</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        {!causes.length && <span className="fr-dim fr-explain-hint">Pick at least one cause.</span>}
      </div>
    </div>
  )
}

/** An explanation cell: its tags and Edit, Explain when the day wants a reason, or a dash. */
function ExplainCell({ e, wants, onEdit }: { e?: DayExplanation; wants: boolean; onEdit: () => void }) {
  if (e) return <><Tags e={e} /> <button type="button" className="fr-link" onClick={ev => { ev.stopPropagation(); onEdit() }}>Edit</button></>
  if (wants) return <ChipButton className="fr-day-explain" onClick={ev => { ev.stopPropagation(); onEdit() }}>Explain</ChipButton>
  return <span className="fr-dim">—</span>
}

const Head = ({ first }: { first: string }) => (
  <thead>
    <tr><th /><th colSpan={3} className="fr-day-grp">The day</th><th colSpan={3} className="fr-day-grp fr-mtd">Month to date</th><th /></tr>
    <tr><th>{first}</th><th>Forecast</th><th>Sold</th><th>vs</th><th className="fr-mtd">Forecast</th><th className="fr-mtd">Sold</th><th className="fr-mtd">vs</th><th className="fr-day-why">Explanation</th></tr>
  </thead>)
const Figures = ({ f }: { f: DayFigures }) => <>
  <td>{inr(f.fc)}</td><td>{f.sold == null ? '—' : inr(f.sold)}</td><td><Off x={f.off} /></td>
  <td className="fr-mtd">{inr(f.mtdFc)}</td><td className="fr-mtd">{f.mtdSold == null ? '—' : inr(f.mtdSold)}</td><td className="fr-mtd"><Off x={f.mtdOff} /></td>
</>

export function DayReview({ section, rootKind = 'section', subs, month, explanations, rowIdOf, onSave, monthLink, initialScope = '', onScope,
  levels = [], initialPath = [], onPath, explainedFor, canExplain = () => true, explainedCount, pathHref, note }: {
  /** The name of everything on the page: the section, the store or the region. */
  section: string
  /** What it is, in the scope list: "(section)", "(store)", "(region)". */
  rootKind?: string
  subs: SubDays[]; month: DayMonth; explanations: DayExplanation[]
  /** A subcategory's row in the Run, for its RecordLink (by its id: the name, or "store|name"). */
  rowIdOf: (sub: string) => string | undefined
  onSave: (d: ExplainDraft, replacing: DayExplanation | undefined, at: DayAt) => Promise<void>
  /** The month's review, first in the breadcrumb above the days ("December › Kurti"); none: the scope alone. */
  monthLink?: { label: string; href: string }
  /** Whose days open first: the section ('') or one subcategory (its id); a change is reported to `onScope`. */
  initialScope?: string; onScope?: (scope: string) => void
  /** The levels above the subcategories, top first; none on a section's page. */
  levels?: DayLevel[]
  /** Where the page opens (keys of `levels`), and where it is now, for the address. */
  initialPath?: string[]; onPath?: (path: string[]) => void
  /** A day's explanation where the page stands; by default the section's or the subcategory's from `explanations`. */
  explainedFor?: (day: number, at: DayAt) => DayExplanation | undefined
  /** Whether a day can be explained here (a store or a region is explained section by section). */
  canExplain?: (at: DayAt) => boolean
  /** Above where days are explained: how many explanations that day's sections and subcategories have. */
  explainedCount?: (day: number, members: SubDays[]) => number
  /** A level's own address, so its name is a link that can be opened or copied. */
  pathHref?: (path: string[]) => string
  /** A line under the breadcrumb, such as how many of a region's stores have arrived. */
  note?: ReactNode
}) {
  const loaded = subs.length ? subs[0].sold.findIndex(s => s == null) : 0, lastLoaded = loaded === -1 ? month.days : loaded
  const validPath = (p: string[]) => { const out: string[] = []; for (const k of p.slice(0, levels.length)) { if (!subs.some(s => levels.slice(0, out.length + 1).every((l, i) => l.key(s) === [...out, k][i]))) break; out.push(k) } return out }
  const [path, setPathState] = useState<string[]>(() => validPath(initialPath))
  const within = (p: string[]) => subs.filter(s => p.every((k, i) => levels[i].key(s) === k))
  const [scope, setScopeState] = useState<string>(() => { const s = within(path).find(x => idOf(x) === initialScope || x.name === initialScope); return initialScope && s ? idOf(s) : '' })
  const setScope = (s: string) => { setScopeState(s); onScope?.(s) }
  const setPath = (p: string[]) => { setPathState(p); onPath?.(p); setScope('') }
  const [mode, setMode] = useState<'all' | 'one'>('all')
  const [day, setDay] = useState(Math.max(1, lastLoaded))
  // a section's subcategories open on only those off; a store's sections or a region's stores open on them all
  const [onlyPicked, setOnly] = useState<boolean | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const inPath = within(path)
  const scopeSubDays = scope ? inPath.find(s => idOf(s) === scope) ?? null : null
  const inScope = scopeSubDays ? [scopeSubDays] : inPath
  const labelAt = (depth: number, s: SubDays) => levels[depth].label?.(s) ?? levels[depth].key(s)
  const pathNames = path.map((_, i) => labelAt(i, inPath[0]))
  const scopeName = scopeSubDays?.name ?? pathNames[pathNames.length - 1] ?? section
  const days = daysOf(inScope, month.days)
  const atOf = (p: string[], sub: SubDays | null): DayAt => ({ path: p, sub, members: sub ? [sub] : within(p) })
  const here = atOf(path, scopeSubDays)
  // where a day is explained: by default the section (no levels) and its subcategories
  const explained = explainedFor ?? ((d: number, at: DayAt) => (at.path.length === levels.length ? explanationFor(explanations, d, at.sub?.name ?? null) : undefined))
  const explainable = (at: DayAt) => (explainedFor ? canExplain(at) : at.path.length === levels.length && canExplain(at))
  const key = (at: DayAt, d: number) => `${at.path.join('›')}|${at.sub ? idOf(at.sub) : ''}|${d}`
  const save = (at: DayAt, d: number, direction: Direction) => async (x: Pick<ExplainDraft, 'causes' | 'tags' | 'note'>) => {
    await onSave({ subcategory: at.sub?.name ?? null, day: d, direction, ...x }, explained(d, at), at); setEditing(null)
  }
  // a day above the forecast is explained with its own causes; an edit keeps the direction it was saved with
  const editor = (at: DayAt, d: number, off: number, title: string, cols: number) => {
    if (editing !== key(at, d)) return null
    const was = explained(d, at), direction = was?.direction ?? directionOf(off)
    return <tr className="fr-day-editor"><td colSpan={cols}><ExplainForm title={title} direction={direction} initial={was?.direction === direction ? was : undefined}
      onSave={save(at, d, direction)} onCancel={() => setEditing(null)} /></td></tr>
  }
  /** The explanation cell where the page stands: the day's explanation, Explain, or above that how many there are. */
  const why = (at: DayAt, d: number, wants: boolean) => {
    if (explainable(at)) return <ExplainCell e={explained(d, at)} wants={wants} onEdit={() => setEditing(key(at, d))} />
    const n = explainedCount?.(d, at.members) ?? 0
    return n ? <span className="fr-dim">{n} explained</span> : <span className="fr-dim">—</span>
  }
  /** Go down to a level (its name is a link to its own address). */
  const Down = ({ p, label }: { p: string[]; label: string }) => (
    <a className="fr-link" href={pathHref?.(p) ?? '#'} onClick={e => { e.preventDefault(); e.stopPropagation(); setPath(p); setEditing(null) }}>{label}</a>)

  const allDays = (
    <table className="fr-days" data-testid="days-table">
      <Head first="Day" />
      <tbody>{days.map(f => {
        const off = dayIsOff(f), wd = weekday(month, f.day)
        return (
          <Fragment key={f.day}>
            <tr className={cx('fr-day-row', f.sold == null && 'fr-day-future')} data-day={f.day} onClick={() => { setDay(f.day); setMode('one'); setEditing(null) }}>
              <td className={cx(off && `fr-edge fr-edge-${edgeOf(f.off)}`)}><b className={cx((wd === 'Sat' || wd === 'Sun') && 'fr-weekend')}>{d2(f.day)}</b> <span className="fr-dim">{wd}</span></td>
              <Figures f={f} />
              <td className="fr-day-why">{f.sold != null && why(here, f.day, off)}</td>
            </tr>
            {editor(here, f.day, f.off ?? 0, `Why was ${scopeName} ${signed(f.off ?? 0)} on ${dayLabel(month, f.day)}?`, 8)}
          </Fragment>)
      })}</tbody>
    </table>)

  const f = days[day - 1], monthFc = inScope.reduce((t, s) => t + s.fc.reduce((a, b) => a + b, 0), 0)
  // the rows of one day: the next level down (sections, stores), else the subcategories
  const depth = path.length, next = !scopeSubDays && depth < levels.length ? levels[depth] : null
  const only = onlyPicked ?? !next
  interface DayRow { id: string; label: string; sub: string; order: number; at: DayAt; f: DayFigures; leaf: SubDays | null }
  const rowsOfDay: DayRow[] = next
    ? [...new Map(inPath.map(s => [next.key(s), s])).values()].map(s => {
      const p = [...path, next.key(s)], at = atOf(p, null)
      return { id: p.join('›'), label: labelAt(depth, s), sub: next.sub?.(s) ?? '', order: next.order?.(s) ?? 0, at, f: daysOf(at.members, month.days)[day - 1], leaf: null }
    })
    : inScope.map(s => ({ id: idOf(s), label: s.name, sub: s.category, order: 0, at: atOf(path, s), f: daysOf([s], month.days)[day - 1], leaf: s }))
  const lines = rowsOfDay.sort((a, b) => Math.abs(b.f.off ?? 0) - Math.abs(a.f.off ?? 0))
  const shown = lines.filter(l => !only || rowsOfDay.length === 1 || lineIsOff(l.f))
  const rowWord = next ? next.name.toLowerCase() : 'subcategory'
  const rowWords = next ? (next.name === 'Store' ? 'stores' : `${next.name.toLowerCase()}s`) : 'subcategories'
  const oneDay = <>
    <div className="fr-day-tiles">
      <div className="fr-day-tile">
        <p className="fr-day-lab">The day · {dayLabel(month, day)}, {weekday(month, day)}</p>
        <p className="fr-day-big"><span>{f.sold == null ? '—' : inr(f.sold)}</span><Off x={f.off} /><span className="fr-dim">forecast {inr(f.fc)}</span></p>
      </div>
      <div className="fr-day-tile fr-mtd-tile">
        <p className="fr-day-lab">Month to date · 01–{d2(day)} {month.name.slice(0, 3)}</p>
        <p className="fr-day-big"><span>{f.mtdSold == null ? '—' : inr(f.mtdSold)}</span><Off x={f.mtdOff} /><span>forecast {inr(f.mtdFc)}</span></p>
        <div className="fr-day-prog" aria-hidden><i style={{ width: `${Math.min(100, (f.mtdSold ?? 0) / (monthFc || 1) * 100)}%` }} /></div>
        <p className="fr-day-small">{Math.round((f.mtdSold ?? 0) / (monthFc || 1) * 100)}% of the month's {inr(monthFc)} sold so far</p>
      </div>
    </div>
    <section className="fr-day-card">
      <div className="fr-day-cardhead">
        <h3>{next ? `${next.name === 'Store' ? 'Stores' : `${next.name}s`}` : 'Subcategories'} on {dayLabel(month, day)}</h3>
        <div className="fr-day-step">
          <Button disabled={day <= 1} onClick={() => { setDay(day - 1); setEditing(null) }}>‹ {day > 1 ? d2(day - 1) : ''}</Button>
          <Button disabled={day >= month.days} onClick={() => { setDay(day + 1); setEditing(null) }}>{day < month.days ? d2(day + 1) : ''} ›</Button>
        </div>
      </div>
      {rowsOfDay.length > 1 && <label className="fr-day-only"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Only {rowWords} more than {OFF_POINTS}% off ({count(lines.filter(l => lineIsOff(l.f)).length)} of {count(lines.length)})</label>}
      <table className="fr-days" data-testid="one-day-table">
        <Head first={next ? next.name : 'Subcategory'} />
        <tbody>{shown.map(({ id, label, sub, at, f: lf, leaf }) => {
          const off = lineIsOff(lf), rid = leaf ? rowIdOf(idOf(leaf)) : undefined
          return (
            <Fragment key={id}>
              <tr data-row={id}>
                <td className={cx(off && `fr-edge fr-edge-${edgeOf(Math.abs(lf.off ?? 0) >= Math.abs(lf.mtdOff ?? 0) ? lf.off : lf.mtdOff)}`)}>
                  {leaf ? (rid ? <RecordLink table="forecasting.forecast_line_month" rowId={rid} name={label} onNavigate={() => {}} /> : label) : <Down p={at.path} label={label} />}
                  {sub && <div className="fr-dim fr-day-small">{sub}</div>}</td>
                <Figures f={lf} />
                <td className="fr-day-why">{lf.sold != null && why(at, day, off)}</td>
              </tr>
              {editor(at, day, Math.abs(lf.off ?? 0) >= Math.abs(lf.mtdOff ?? 0) ? lf.off ?? 0 : lf.mtdOff ?? 0, `Why was ${label} ${signed(lf.off ?? 0)} on ${dayLabel(month, day)}?`, 8)}
            </Fragment>)
        })}</tbody>
      </table>
      {!shown.length && <p className="fr-dim fr-day-small">No {rowWord} was more than {OFF_POINTS}% off on {dayLabel(month, day)}.</p>}
    </section>
  </>

  // the scope list: everything, each level gone down and its siblings, then the subcategories once at the bottom level
  const enc = (p: string[], sub = '') => JSON.stringify([p, sub])
  const pick = (v: string) => { const [p, sub] = JSON.parse(v) as [string[], string]; if (p.join('›') !== path.join('›')) setPath(p); setScope(sub); setEditing(null) }
  const groupsAt = (d: number) => {
    const base = within(path.slice(0, d)), seen = new Map<string, SubDays>()
    for (const s of base) if (!seen.has(levels[d].key(s))) seen.set(levels[d].key(s), s)
    const order = levels[d].order
    return [...seen.values()].sort((a, b) => (order ? order(a) - order(b) : 0) || labelAt(d, a).localeCompare(labelAt(d, b)))
  }
  const options: ReactNode[] = [<option key="root" value={enc([])}>{section} ({rootKind})</option>]
  for (let d = 0; d < levels.length && d <= path.length; d++) {
    const gs = groupsAt(d), byFloor = new Map<string, SubDays[]>()
    for (const g of gs) { const k = levels[d].sub?.(g) ?? ''; byFloor.set(k, [...(byFloor.get(k) ?? []), g]) }
    for (const [k, members] of byFloor) options.push(
      <optgroup key={`${d}:${k}`} label={k ? `${levels[d].name}s · ${k}` : `${levels[d].name === 'Store' ? 'Stores' : `${levels[d].name}s`}${d ? ` in ${pathNames[d - 1]}` : ''}`}>
        {members.map(g => { const p = [...path.slice(0, d), levels[d].key(g)]; return <option key={p.join('›')} value={enc(p)}>{labelAt(d, g)}</option> })}
      </optgroup>)
  }
  if (path.length === levels.length && levels.length) options.push(
    <optgroup key="subs" label={`Subcategories in ${scopeName === scopeSubDays?.name ? pathNames[pathNames.length - 1] : scopeName}`}>{inPath.map(s => <option key={idOf(s)} value={enc(path, idOf(s))}>{s.name}</option>)}</optgroup>)
  if (!levels.length) options.push(...subs.map(s => <option key={idOf(s)} value={enc([], idOf(s))}>{s.name}</option>))

  const crumb = (p: string[], label: string, last: boolean) => (last ? <b key={p.join('›')}>{label}</b>
    : <Fragment key={p.join('›')}><Down p={p} label={label} /> <span className="fr-dim">›</span> </Fragment>)
  const bar: ReactNode = (
    <div className="fr-day-bar">
      <nav aria-label="Where you are" className="fr-day-crumb" data-testid="crumbs">
        {monthLink && <><a className="fr-link" href={monthLink.href}>{monthLink.label}</a> <span className="fr-dim">›</span> </>}
        {levels.length > 0 && crumb([], section, !path.length && !scopeSubDays)}
        {path.map((_, i) => crumb(path.slice(0, i + 1), pathNames[i], i === path.length - 1 && !scopeSubDays))}
        {(scopeSubDays || !levels.length) && <b>{scopeSubDays && rowIdOf(idOf(scopeSubDays)) ? <RecordLink table="forecasting.forecast_line_month" rowId={rowIdOf(idOf(scopeSubDays))!} name={scopeSubDays.name} onNavigate={() => {}} /> : scopeName}</b>}
        {' '}<span className="fr-dim">· {count(inScope.length)} {inScope.length === 1 ? 'subcategory' : 'subcategories'}</span>
        {note && <span className="fr-dim"> · {note}</span>}</nav>
      <div className="fr-day-controls">
        <Select aria-label="Whose days" value={enc(path, scope)} onChange={e => pick(e.target.value)}>{options}</Select>
        <Segmented label="Days shown" value={mode} onChange={v => { setMode(v); setEditing(null) }}
          options={[{ value: 'all', label: 'All days' }, { value: 'one', label: `One day · ${d2(day)} ${weekday(month, day)}` }]} />
      </div>
    </div>)
  return (
    <div className="fr fr-day" data-testid="day-review">
      {bar}
      {mode === 'all' ? <section className="fr-day-card">{allDays}
        <p className="fr-dim fr-day-small">A day more than {OFF_POINTS}% off has a coloured edge{explainable(here) ? ' and asks for an explanation' : ''}. Click a day to open it, {next ? `${rowWord} by ${rowWord}` : 'subcategory by subcategory'}.</p></section> : oneDay}
    </div>
  )
}
