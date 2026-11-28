// An answer on a subcategory (TL-30, TL-31): accept the forecast, or change it with reasons and an explanation;
// once answered, the answer with Change to reopen it. The Team Leader changes the month in ₹ (the default). A
// manager's page passes `modes` for the rest of forecast_change: the month moved by ± %, or some days (one day or
// a range, stored as day rows sharing a change_batch) moved by ± % or each set to ₹.
import { useState } from 'react'
import { Button, ChipButton, ChoiceChip, Notice, Segmented, TextInput, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { count, day, inr, pc, type Line } from './model'
import { REASONS, changeWords, daysBetween, monthAfter, type Answer, type ChangeSpec, type Header, type Proposal } from './review'

export type ChangeMode = 'month_value' | 'month_percent' | 'days'
const MODE_LABEL: Record<ChangeMode, string> = { month_value: 'Month ₹', month_percent: 'Month ± %', days: 'Some days' }

export function ChangeForm({ l, answer, month, onAccept, onPropose, modes = ['month_value'], canAccept = true, aop = false,
  title = 'Your answer', sendLabel = 'Send to Store Manager', doneWords = 'You proposed', doneTail = ' to your Store Manager' }: {
  l: Line; answer?: Answer; month: Header['month']; onAccept?: () => void; onPropose: (p: Proposal) => void
  /** The kinds of change offered, the first open by default; one kind draws no picker. */
  modes?: ChangeMode[]
  /** A Team Leader accepts or changes; a manager only changes (their own number). */
  canAccept?: boolean
  /** "= AOP" among the quick numbers. */
  aop?: boolean
  title?: string; sendLabel?: string
  /** How a sent change reads: "You proposed ₹X (N pcs) to your Store Manager." */
  doneWords?: string; doneTail?: string
}) {
  const [redo, setRedo] = useState(false)
  const [changing, setChanging] = useState(false)
  const [mode, setMode] = useState<ChangeMode>(modes[0])
  const [value, setValue] = useState('')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [dayBy, setDayBy] = useState<'percent' | 'set_value'>('percent')
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const unitPrice = l.fc / l.fq
  const first = `${month.year}-${String(new Date(`${month.name} 1, ${month.year}`).getMonth() + 1).padStart(2, '0')}-01`
  const last = `${first.slice(0, 8)}${String(month.days).padStart(2, '0')}`

  if (answer && !redo) {
    const labels = answer.reasons.map(c => REASONS.find(r => r.code === c)?.label ?? c)
    return <>
      <h4>{title}</h4>
      <Notice tone={answer.status === 'accepted' ? 'positive' : 'info'}>
        {answer.status === 'accepted' ? `You accepted the forecast of ${inr(l.fc)}.` : `${doneWords} ${inr(answer.value)} (${count((answer.value ?? 0) / unitPrice)} pcs)${doneTail}.`}
        {answer.change && answer.change.scope === 'day' ? ` ${changeWords(answer.change, inr, day)}.` : ''}
        {labels.length ? ` ${labels.join(', ')}.` : ''}{answer.note ? ` “${answer.note}”` : ''}{' '}
        <button type="button" className="fr-link" onClick={e => { e.stopPropagation(); setRedo(true); setChanging(!canAccept) }}>Change</button>
      </Notice>
    </>
  }

  // what is being entered, as a change; null until it is complete
  const amount = parseFloat(value)
  const days = mode === 'days' && from ? daysBetween(from, to && to >= from ? to : from) : []
  const entered: ChangeSpec | null = Number.isNaN(amount) ? null
    : mode === 'month_value' ? { scope: 'month', method: 'set_value', value: Math.round(amount * 1e5) }
      : mode === 'month_percent' ? { scope: 'month', method: 'percent', percent: amount }
        : !days.length ? null
          : dayBy === 'percent' ? { scope: 'day', method: 'percent', percent: amount, days, ...(days.length > 1 ? { batch: `${l.rowId}:${from}:${to}` } : {}) }
            : { scope: 'day', method: 'set_value', value: Math.round(amount), days, ...(days.length > 1 ? { batch: `${l.rowId}:${from}:${to}` } : {}) }
  // a month can't go below nothing: a negative ₹ or a cut past −100% is not a change (−100% closes it)
  const possible = entered && !('percent' in entered && entered.percent! < -100) && monthAfter(l.fc, month.days, entered) >= 0
  const spec = possible ? entered : null
  const after = spec ? monthAfter(l.fc, month.days, spec) : null

  const reset = () => { setChanging(false); setValue(''); setFrom(''); setTo(''); setReasons([]); setNote(''); setMissing(false) }
  const stop = (f: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); f() }
  const quick = (label: string, set: string) => <ChipButton key={label} onClick={stop(() => setValue(set))}>{label}</ChipButton>
  const scope = mode === 'days' ? 'day' : 'month'
  const percentChips = [-20, -10, 10, 20].map(p => quick(`${p > 0 ? '+' : '−'}${Math.abs(p)}%`, mode === 'month_value' ? (l.fc * (1 + p / 100) / 1e5).toFixed(2) : String(p)))
  return <>
    <h4>{title}</h4>
    <div className="fr-buttons">
      {canAccept && onAccept && <Button variant={changing ? 'secondary' : 'primary'} onClick={stop(() => { reset(); setRedo(false); onAccept() })}>I accept the forecast</Button>}
      {(canAccept || !changing) && <Button variant={changing ? 'primary' : 'secondary'} onClick={stop(() => setChanging(true))}>I want to change the forecast</Button>}
    </div>
    {changing && (
      <div className="fr-form" onClick={e => e.stopPropagation()}>
        {modes.length > 1 && <div><span className={labelClasses()}>What to change</span>
          <Segmented label="What to change" value={mode} onChange={m => { setMode(m); setValue(''); setReasons(r => r.filter(c => !REASONS.find(x => x.code === c)?.only)) }}
            options={modes.map(m => ({ value: m, label: MODE_LABEL[m] }))} /></div>}
        <div><span className={labelClasses()}>What do you know that Feather Forecast doesn't?</span>
          <div className="fr-choices">{REASONS.filter(r => !r.only || r.only === scope).map(r => (
            <ChoiceChip key={r.code} picked={reasons.includes(r.code)} onToggle={() => setReasons(p => p.includes(r.code) ? p.filter(x => x !== r.code) : [...p, r.code])}>{r.label}</ChoiceChip>))}</div></div>
        {mode === 'days' && <div className="fr-numrow">
          <label className={labelClasses()} htmlFor={`fr-from-${l.rowId}`}>From</label>
          <input id={`fr-from-${l.rowId}`} className={inputClasses()} type="date" min={first} max={last} value={from} onChange={e => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value) }} />
          <label className={labelClasses()} htmlFor={`fr-to-${l.rowId}`}>to</label>
          <input id={`fr-to-${l.rowId}`} className={inputClasses()} type="date" min={from || first} max={last} value={to} onChange={e => setTo(e.target.value)} />
          <Segmented label="Change the days by" value={dayBy} onChange={v => { setDayBy(v); setValue('') }}
            options={[{ value: 'percent', label: '± %' }, { value: 'set_value', label: '₹ each day' }]} />
        </div>}
        <div><label className={labelClasses()} htmlFor={`fr-value-${l.rowId}`}>
          {mode === 'month_value' ? `Your ${month.name} number` : mode === 'month_percent' ? `Move ${month.name} by` : dayBy === 'percent' ? 'Move each day by' : 'Each day’s number'}</label>
          <div className="fr-numrow">
            <input id={`fr-value-${l.rowId}`} className={inputClasses()} type="number" step={mode === 'month_value' ? '0.01' : '1'}
              placeholder={mode === 'month_value' ? '₹ lakh' : mode === 'days' && dayBy === 'set_value' ? '₹' : '%'} value={value} onChange={e => setValue(e.target.value)} />
            {mode === 'month_value' && <>{quick('= Last month', (l.r31 / 1e5).toFixed(2))}{quick('= Last year', (l.ly / 1e5).toFixed(2))}{aop && l.aop ? quick('= AOP', (l.aop / 1e5).toFixed(2)) : null}</>}
            {(mode === 'month_value' || mode === 'month_percent' || dayBy === 'percent') && percentChips}
          </div>
          <div className="fr-live">{after != null ? [
            ...(mode === 'days' ? [`${days.length} day${days.length === 1 ? '' : 's'} · ${month.name} becomes ${inr(after)}`] : mode === 'month_percent' ? [`= ${inr(after)}`] : []),
            `${mode === 'month_value' ? '= ' : ''}${count(after / unitPrice)} pcs at ASP ₹${count(unitPrice)}`, `${pc(after, l.fc)} on Feather Forecast`, `${pc(after, l.ly)} on last year`,
            ...(aop && l.aop ? [`${pc(after, l.aop)} on AOP`] : []),
          ].join(' · ') : ''}</div></div>
        <div><label className={labelClasses()} htmlFor={`fr-note-${l.rowId}`}>Explain your proposed change</label>
          <TextInput id={`fr-note-${l.rowId}`} value={note} placeholder="e.g. new stock arrives 05-Dec, 400 pcs" aria-invalid={missing && !note.trim()}
            onChange={e => setNote(e.target.value)} />
          {missing && !note.trim() && <div className="fr-live" style={{ color: 'var(--color-negative)' }}>Say what Feather Forecast doesn't know.</div>}</div>
        <div className="fr-buttons">
          <Button variant="primary" onClick={() => {
            if (!spec || after == null) return
            if (!note.trim()) { setMissing(true); return }
            // a ₹ month change keeps the shape it always had; the other kinds carry their spec
            onPropose({ value: after, reasons, note: note.trim(), ...(mode === 'month_value' && modes.length === 1 ? {} : { change: spec }) }); reset(); setRedo(false)
          }}>{sendLabel}</Button>
          <Button onClick={() => { reset(); if (!canAccept) setChanging(false) }}>Cancel</Button>
        </div>
      </div>)}
  </>
}
