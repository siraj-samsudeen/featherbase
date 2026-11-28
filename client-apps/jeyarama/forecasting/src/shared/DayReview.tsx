// The day review (#1425; the agreed 26-Nov mockup and Siraj's feedback that day): a section's month day by day against
// Feather Forecast. Days: 01–31 down the page, The Day and Month to Date side by side, a day more than 10% off with a
// coloured edge and Explain. One Day: the day and month-to-date tiles, then the subcategories that day (only those
// more than 10% off, by default). Explain: one or more of five causes, each opening its own tags and the evidence it
// needs, and a note. Shared, so a Store Manager's or RB's page can show a store's or area's days the same way.
import { Fragment, useState, type ReactNode } from 'react'
import { Button, ChipButton, ChoiceChip, RecordLink, Segmented, Select, StatusPill, cx } from '@featherbase/shop-floor'
import { causeOf, causesFor, directionOf, tagOf, TAG_JOIN, type Direction } from '../causes'
import { inr } from './model'
import { OFF_POINTS, dayIsOff, daysOf, edgeOf, explanationFor, lineIsOff, type DayExplanation, type DayFigures, type SubDays } from './days'

export interface DayMonth { name: string; days: number; year: number; index: number }
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

export function DayReview({ section, subs, month, explanations, rowIdOf, onSave, monthLink, initialScope = '', onScope }: {
  section: string; subs: SubDays[]; month: DayMonth; explanations: DayExplanation[]
  /** A subcategory's row in the Run, for its RecordLink. */
  rowIdOf: (sub: string) => string | undefined
  onSave: (d: ExplainDraft, replacing?: DayExplanation) => Promise<void>
  /** The month's review, first in the breadcrumb above the days ("December › Kurti"); none: the scope alone. */
  monthLink?: { label: string; href: string }
  /** Whose days open first: the section ('') or one subcategory; a change is reported to `onScope`. */
  initialScope?: string; onScope?: (scope: string) => void
}) {
  const loaded = subs.length ? subs[0].sold.findIndex(s => s == null) : 0, lastLoaded = loaded === -1 ? month.days : loaded
  const [scope, setScopeState] = useState<string>(subs.some(s => s.name === initialScope) ? initialScope : '')
  const setScope = (s: string) => { setScopeState(s); onScope?.(s) }
  const [mode, setMode] = useState<'all' | 'one'>('all')
  const [day, setDay] = useState(Math.max(1, lastLoaded))
  const [only, setOnly] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const inScope = scope ? subs.filter(s => s.name === scope) : subs
  const scopeName = scope || section
  const days = daysOf(inScope, month.days)
  const key = (sub: string | null, d: number) => `${sub ?? ''}|${d}`
  const save = (sub: string | null, d: number, direction: Direction) => async (x: Pick<ExplainDraft, 'causes' | 'tags' | 'note'>) => {
    await onSave({ subcategory: sub, day: d, direction, ...x }, explanationFor(explanations, d, sub)); setEditing(null)
  }
  // a day above the forecast is explained with its own causes; an edit keeps the direction it was saved with
  const editor = (sub: string | null, d: number, off: number, title: string, cols: number) => {
    if (editing !== key(sub, d)) return null
    const was = explanationFor(explanations, d, sub), direction = was?.direction ?? directionOf(off)
    return <tr className="fr-day-editor"><td colSpan={cols}><ExplainForm title={title} direction={direction} initial={was?.direction === direction ? was : undefined}
      onSave={save(sub, d, direction)} onCancel={() => setEditing(null)} /></td></tr>
  }
  const scopeSub = scope || null

  const allDays = (
    <table className="fr-days" data-testid="days-table">
      <Head first="Day" />
      <tbody>{days.map(f => {
        const off = dayIsOff(f), e = explanationFor(explanations, f.day, scopeSub), wd = weekday(month, f.day)
        return (
          <Fragment key={f.day}>
            <tr className={cx('fr-day-row', f.sold == null && 'fr-day-future')} data-day={f.day} onClick={() => { setDay(f.day); setMode('one'); setEditing(null) }}>
              <td className={cx(off && `fr-edge fr-edge-${edgeOf(f.off)}`)}><b className={cx((wd === 'Sat' || wd === 'Sun') && 'fr-weekend')}>{d2(f.day)}</b> <span className="fr-dim">{wd}</span></td>
              <Figures f={f} />
              <td className="fr-day-why">{f.sold != null && <ExplainCell e={e} wants={off} onEdit={() => setEditing(key(scopeSub, f.day))} />}</td>
            </tr>
            {editor(scopeSub, f.day, f.off ?? 0, `Why was ${scopeName} ${signed(f.off ?? 0)} on ${dayLabel(month, f.day)}?`, 8)}
          </Fragment>)
      })}</tbody>
    </table>)

  const f = days[day - 1], monthFc = inScope.reduce((t, s) => t + s.fc.reduce((a, b) => a + b, 0), 0)
  const lines = inScope.map(s => ({ s, f: daysOf([s], month.days)[day - 1] })).sort((a, b) => Math.abs(b.f.off ?? 0) - Math.abs(a.f.off ?? 0))
  const shown = lines.filter(l => !only || inScope.length === 1 || lineIsOff(l.f))
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
        <h3>Subcategories on {dayLabel(month, day)}</h3>
        <div className="fr-day-step">
          <Button disabled={day <= 1} onClick={() => { setDay(day - 1); setEditing(null) }}>‹ {day > 1 ? d2(day - 1) : ''}</Button>
          <Button disabled={day >= month.days} onClick={() => { setDay(day + 1); setEditing(null) }}>{day < month.days ? d2(day + 1) : ''} ›</Button>
        </div>
      </div>
      {inScope.length > 1 && <label className="fr-day-only"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Only subcategories more than {OFF_POINTS}% off ({lines.filter(l => lineIsOff(l.f)).length} of {lines.length})</label>}
      <table className="fr-days" data-testid="one-day-table">
        <Head first="Subcategory" />
        <tbody>{shown.map(({ s, f: lf }) => {
          const off = lineIsOff(lf), e = explanationFor(explanations, day, s.name), id = rowIdOf(s.name)
          return (
            <Fragment key={s.name}>
              <tr>
                <td className={cx(off && `fr-edge fr-edge-${edgeOf(Math.abs(lf.off ?? 0) >= Math.abs(lf.mtdOff ?? 0) ? lf.off : lf.mtdOff)}`)}>
                  {id ? <RecordLink table="forecasting.forecast_line_month" rowId={id} name={s.name} onNavigate={() => {}} /> : s.name}
                  <div className="fr-dim fr-day-small">{s.category}</div></td>
                <Figures f={lf} />
                <td className="fr-day-why">{lf.sold != null && <ExplainCell e={e} wants={off} onEdit={() => setEditing(key(s.name, day))} />}</td>
              </tr>
              {editor(s.name, day, Math.abs(lf.off ?? 0) >= Math.abs(lf.mtdOff ?? 0) ? lf.off ?? 0 : lf.mtdOff ?? 0, `Why was ${s.name} ${signed(lf.off ?? 0)} on ${dayLabel(month, day)}?`, 8)}
            </Fragment>)
        })}</tbody>
      </table>
      {!shown.length && <p className="fr-dim fr-day-small">No subcategory was more than {OFF_POINTS}% off on {dayLabel(month, day)}.</p>}
    </section>
  </>

  const bar: ReactNode = (
    <div className="fr-day-bar">
      <nav aria-label="Where you are" className="fr-day-crumb" data-testid="crumbs">
        {monthLink && <><a className="fr-link" href={monthLink.href}>{monthLink.label}</a> <span className="fr-dim">›</span> </>}
        <b>{scope && rowIdOf(scope) ? <RecordLink table="forecasting.forecast_line_month" rowId={rowIdOf(scope)!} name={scope} onNavigate={() => {}} /> : scopeName}</b>
        {' '}<span className="fr-dim">· {inScope.length} {inScope.length === 1 ? 'subcategory' : 'subcategories'}</span></nav>
      <div className="fr-day-controls">
        <Select aria-label="Whose days" value={scope} onChange={e => { setScope(e.target.value); setEditing(null) }}>
          <option value="">{section} (section)</option>
          {subs.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </Select>
        <Segmented label="Days shown" value={mode} onChange={v => { setMode(v); setEditing(null) }}
          options={[{ value: 'all', label: 'All days' }, { value: 'one', label: `One day · ${d2(day)} ${weekday(month, day)}` }]} />
      </div>
    </div>)
  return (
    <div className="fr fr-day" data-testid="day-review">
      {bar}
      {mode === 'all' ? <section className="fr-day-card">{allDays}
        <p className="fr-dim fr-day-small">A day more than {OFF_POINTS}% off has a coloured edge and asks for an explanation. Click a day to open it, subcategory by subcategory.</p></section> : oneDay}
    </div>
  )
}
