// The Team Leader's answer on a subcategory (TL-30, TL-31): accept the forecast, or propose the month's number
// with reasons and an explanation for the Store Manager; once answered, the answer with Change to reopen it.
// A month change in ₹ only, for now: the day changes and their ranges (change_batch) come with the Store
// Manager's screen.
import { useState } from 'react'
import { Button, ChipButton, ChoiceChip, Notice, TextInput, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { count, inr, pc, type Line } from './model'
import { REASONS, type Answer, type Header, type Proposal } from './review'

export function ChangeForm({ l, answer, month, onAccept, onPropose }: { l: Line; answer?: Answer; month: Header['month']; onAccept: () => void; onPropose: (p: Proposal) => void }) {
  const [redo, setRedo] = useState(false)
  const [changing, setChanging] = useState(false)
  const [value, setValue] = useState('')
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const unitPrice = l.fc / l.fq, v = parseFloat(value) * 1e5
  if (answer && !redo) {
    const labels = answer.reasons.map(c => REASONS.find(r => r.code === c)?.label ?? c)
    return <>
      <h4>Your answer</h4>
      <Notice tone={answer.status === 'accepted' ? 'positive' : 'info'}>
        {answer.status === 'accepted' ? `You accepted the forecast of ${inr(l.fc)}.` : `You proposed ${inr(answer.value)} (${count((answer.value ?? 0) / unitPrice)} pcs) to your Store Manager.`}
        {labels.length ? ` ${labels.join(', ')}.` : ''}{answer.note ? ` “${answer.note}”` : ''}{' '}
        <button type="button" className="fr-link" onClick={e => { e.stopPropagation(); setRedo(true); setChanging(false) }}>Change</button>
      </Notice>
    </>
  }
  const reset = () => { setChanging(false); setValue(''); setReasons([]); setNote(''); setMissing(false) }
  const stop = (f: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); f() }
  const quick = (label: string, to: number) => <ChipButton key={label} onClick={stop(() => setValue((to / 1e5).toFixed(2)))}>{label}</ChipButton>
  return <>
    <h4>Your answer</h4>
    <div className="fr-buttons">
      <Button variant={changing ? 'secondary' : 'primary'} onClick={stop(() => { reset(); setRedo(false); onAccept() })}>I accept the forecast</Button>
      <Button variant={changing ? 'primary' : 'secondary'} onClick={stop(() => setChanging(true))}>I want to change the forecast</Button>
    </div>
    {changing && (
      <div className="fr-form" onClick={e => e.stopPropagation()}>
        <div><span className={labelClasses()}>What do you know that Feather Forecast doesn't?</span>
          <div className="fr-choices">{REASONS.map(r => (
            <ChoiceChip key={r.code} picked={reasons.includes(r.code)} onToggle={() => setReasons(p => p.includes(r.code) ? p.filter(x => x !== r.code) : [...p, r.code])}>{r.label}</ChoiceChip>))}</div></div>
        <div><label className={labelClasses()} htmlFor={`fr-value-${l.rowId}`}>Your {month.name} number</label>
          <div className="fr-numrow">
            <input id={`fr-value-${l.rowId}`} className={inputClasses()} type="number" step="0.01" placeholder="₹ lakh" value={value} onChange={e => setValue(e.target.value)} />
            {quick('= Last month', l.r31)}{quick('= Last year', l.ly)}
            {[-20, -10, 10, 20].map(p => quick(`${p > 0 ? '+' : '−'}${Math.abs(p)}%`, l.fc * (1 + p / 100)))}
          </div>
          <div className="fr-live">{value ? `= ${count(v / unitPrice)} pcs at ASP ₹${count(unitPrice)} · ${pc(v, l.fc)} on Feather Forecast · ${pc(v, l.ly)} on last year` : ''}</div></div>
        <div><label className={labelClasses()} htmlFor={`fr-note-${l.rowId}`}>Explain your proposed change</label>
          <TextInput id={`fr-note-${l.rowId}`} value={note} placeholder="e.g. new stock arrives 05-Dec, 400 pcs" aria-invalid={missing && !note.trim()}
            onChange={e => setNote(e.target.value)} />
          {missing && !note.trim() && <div className="fr-live" style={{ color: 'var(--color-negative)' }}>Say what Feather Forecast doesn't know.</div>}</div>
        <div className="fr-buttons">
          <Button variant="primary" onClick={() => {
            if (!value) return
            if (!note.trim()) { setMissing(true); return }
            onPropose({ value: Math.round(v), reasons, note: note.trim() }); reset(); setRedo(false)
          }}>Send to Store Manager</Button>
          <Button onClick={reset}>Cancel</Button>
        </div>
      </div>)}
  </>
}
