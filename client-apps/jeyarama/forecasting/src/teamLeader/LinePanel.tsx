// An opened line or group (TL-24..TL-34): how Feather Forecast got its number, the checks, the other models,
// and, for a line, the Team Leader's answer and questions. Every sentence is the agreed prototype's.
import { useState } from 'react'
import { Button, Chip, ChipButton, ChoiceChip, Notice, TextInput, cx, inputClasses, labelClasses } from '@featherbase/shop-floor'
import { BASE_INFO, PARTS, asp, count, decemberRise, inr, pc, pct0, times, weightOf, type Group, type HelpTopic, type Line } from './model'
import { REASONS, when, type Answer, type Header, type Proposal, type Question } from './review'

type Item = Line | Group
const isGroup = (l: Item): l is Group => 'members' in l

function HelpMark({ topic, onHelp }: { topic: HelpTopic; onHelp: (t: HelpTopic) => void }) {
  return <button type="button" className="tl-qhelp" title="What this part means (opens Help)" aria-label={`Help: ${topic}`}
    onClick={e => { e.stopPropagation(); onHelp(topic) }}>?</button>
}

function BuildUp({ l, month, storeStep, onHelp }: { l: Item; month: Header['month']; storeStep: number; onHelp: (t: HelpTopic) => void }) {
  const [six, setSix] = useState(false)
  const st = l.step ?? storeStep, rate = l.l28 / 28, own = rate * month.days
  const lyOwn = l.bases.find(b => b.code === 'B1')?.own ?? 0
  const wRec = weightOf(l, ['B3', 'B4', 'B5', 'B6']), wStep = weightOf(l, ['B6']), wLy = weightOf(l, ['B1', 'B2'])
  const share = (v: number) => `${Math.round(Math.max(0, v) / l.fc * 100)}%`
  const [recent, step, lastYear, adjust] = PARTS
  const part = (p: typeof recent, from: string, ownText: string, w: number | null, adds: number) => (
    <tr key={p.key}>
      <td><span className="tl-part"><span className="tl-swatch" style={{ background: p.color }} />{p.label}<HelpMark topic={p.topic} onHelp={onHelp} /></span><div className="tl-from">{from}</div></td>
      <td>{ownText}</td><td>{pct0(w)}</td><td className="tl-fc">{inr(adds)}</td><td>{share(adds)}</td>
    </tr>)
  return <>
    <h4>How Feather Forecast got {inr(l.fc)}</h4>
    <table className="tl-mini tl-build">
      <thead><tr><th>Part</th><th>Its own {month.name}</th><th>Weight</th><th>Adds</th><th>Share</th></tr></thead>
      <tbody>
        {part(recent, `Last 28 days ${inr(l.l28)} (${count(l.l28q)} pcs) = ${inr(rate)} a day × ${month.days} ${month.name} days`, `≈ ${inr(own)}`, wRec, l.fromRecent)}
        {part(step, wStep === 0 ? 'Not used for this line.'
          : `${month.name} usually sells ×${st} the late-${prevMonth(month.name)} rate here: ${Math.round((st - 1) * 100)}% more on the part of recent selling that gets the step${wStep == null ? '' : ` (${pct0(wStep)} of the ${pct0(wRec)})`}`,
          wStep === 0 ? '' : `≈ ${inr(own * (st - 1))}`, null, l.lift)}
        {part(lastYear, `Last ${month.name} ${inr(l.ly)} (${count(l.lyq)} pcs)${isGroup(l) ? " × each line's growth" : ` × growth ${l.growth}`}`, `≈ ${inr(lyOwn)}`, wLy, l.lyg)}
        {l.adj !== 0 && (
          <tr>
            <td className="tl-dim"><span className="tl-part" style={{ fontWeight: 500 }}><span className="tl-swatch" style={{ background: adjust.color }} />{adjust.label}<HelpMark topic="adjust" onHelp={onHelp} /></span>
              <div className="tl-from">Tidy-up steps, such as splitting very small lines</div></td>
            <td /><td /><td className="tl-fc tl-dim">{inr(l.adj)}</td><td className="tl-dim">{Math.round(Math.abs(l.adj) / l.fc * 100)}%</td>
          </tr>)}
        {six && (
          <tr><td colSpan={5} style={{ padding: 0, background: 'transparent' }}>
            <table className="tl-mini tl-six">
              <thead><tr><th>Base</th><th>Its own {month.name}</th><th>Weight</th><th>Adds</th></tr></thead>
              <tbody>{l.bases.map(b => (
                <tr key={b.code}><td><b>{b.code}</b> {BASE_INFO[b.code]}</td><td>{b.own == null ? '—' : inr(b.own)}</td><td>{pct0(b.w)}</td><td>{inr(b.adds)}</td></tr>))}</tbody>
            </table>
          </td></tr>)}
      </tbody>
      <tfoot><tr><td>Feather Forecast</td><td /><td /><td>{inr(l.fc)}</td><td>100%</td></tr></tfoot>
    </table>
    <div style={{ marginTop: 8 }}>
      <button type="button" className="tl-link" onClick={e => { e.stopPropagation(); setSix(s => !s) }}>{six ? 'Hide' : 'Show'} the six bases</button>
      <span className="tl-dim" style={{ fontSize: 12 }}> · weights shift a little by day type (Sundays, salary days, Christmas)</span>
    </div>
  </>
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const prevMonth = (name: string) => MONTHS[(MONTHS.indexOf(name) + 11) % 12]

function Checks({ l, month, storeStep }: { l: Item; month: Header['month']; storeStep: number }) {
  const st = l.step ?? storeStep
  const { lyStep, note } = decemberRise(l, st)
  return <>
    <h4>Checks</h4>
    <ul className="tl-checks">
      <li><b>Selling now:</b> last 28 days {inr(l.l28)} against {inr(l.ly28)} in the same days last year (<b>{times(l.l28, l.ly28)}</b>); pieces {count(l.ly28q)} → {count(l.l28q)}.</li>
      <li><b>{month.name} rise:</b> Feather Forecast lifts recent selling ×{st}, the usual {month.name} rise here. Last year this line went from {inr(l.ly28)} in the 28 days before {month.name} to {inr(l.ly)} in {month.name}: <b>×{lyStep.toFixed(1)}</b> per day.{note}</li>
    </ul>
  </>
}

function OtherModels({ l, aop, month }: { l: Item; aop: boolean; month: Header['month'] }) {
  const rows: [string, string, number][] = [['Feather Forecast', 'var(--color-ink)', l.fc], ['XGBoost', '#0f9d8a', l.xgb], ['LightGBM', '#e0821e', l.lgbm], ...(aop ? [['AOP', '#c58b1e', l.aop] as [string, string, number]] : [])]
  return <>
    <h4>Other models</h4>
    <table className="tl-mini">
      <thead><tr><th /><th>{month.name}</th><th>vs Feather Forecast</th></tr></thead>
      <tbody>{rows.map(([name, color, v]) => (
        <tr key={name}><td><span className="tl-swatch round" style={{ background: color }} />{name}</td><td>{inr(v)}</td><td>{name === 'Feather Forecast' ? '' : pc(v, l.fc)}</td></tr>))}</tbody>
    </table>
  </>
}

function YourAnswer({ l, answer, month, onAccept, onPropose }: { l: Line; answer?: Answer; month: Header['month']; onAccept: () => void; onPropose: (p: Proposal) => void }) {
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
        <button type="button" className="tl-link" onClick={e => { e.stopPropagation(); setRedo(true); setChanging(false) }}>Change</button>
      </Notice>
    </>
  }
  const reset = () => { setChanging(false); setValue(''); setReasons([]); setNote(''); setMissing(false) }
  const stop = (f: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); f() }
  const quick = (label: string, to: number) => <ChipButton key={label} onClick={stop(() => setValue((to / 1e5).toFixed(2)))}>{label}</ChipButton>
  return <>
    <h4>Your answer</h4>
    <div className="tl-buttons">
      <Button variant={changing ? 'secondary' : 'primary'} onClick={stop(() => { reset(); setRedo(false); onAccept() })}>I accept the forecast</Button>
      <Button variant={changing ? 'primary' : 'secondary'} onClick={stop(() => setChanging(true))}>I want to change the forecast</Button>
    </div>
    {changing && (
      <div className="tl-form" onClick={e => e.stopPropagation()}>
        <div><span className={labelClasses()}>What do you know that Feather Forecast doesn't?</span>
          <div className="tl-choices">{REASONS.map(r => (
            <ChoiceChip key={r.code} picked={reasons.includes(r.code)} onToggle={() => setReasons(p => p.includes(r.code) ? p.filter(x => x !== r.code) : [...p, r.code])}>{r.label}</ChoiceChip>))}</div></div>
        <div><label className={labelClasses()} htmlFor={`tl-value-${l.rowId}`}>Your {month.name} number</label>
          <div className="tl-numrow">
            <input id={`tl-value-${l.rowId}`} className={inputClasses()} type="number" step="0.01" placeholder="₹ lakh" value={value} onChange={e => setValue(e.target.value)} />
            {quick('= Last month', l.r31)}{quick('= Last year', l.ly)}
            {[-20, -10, 10, 20].map(p => quick(`${p > 0 ? '+' : '−'}${Math.abs(p)}%`, l.fc * (1 + p / 100)))}
          </div>
          <div className="tl-live">{value ? `= ${count(v / unitPrice)} pcs at ASP ₹${count(unitPrice)} · ${pc(v, l.fc)} on Feather Forecast · ${pc(v, l.ly)} on last year` : ''}</div></div>
        <div><label className={labelClasses()} htmlFor={`tl-note-${l.rowId}`}>Explain your proposed change</label>
          <TextInput id={`tl-note-${l.rowId}`} value={note} placeholder="e.g. new stock arrives 05-Dec, 400 pcs" aria-invalid={missing && !note.trim()}
            onChange={e => setNote(e.target.value)} />
          {missing && !note.trim() && <div className="tl-live" style={{ color: 'var(--color-negative)' }}>Say what Feather Forecast doesn't know.</div>}</div>
        <div className="tl-buttons">
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

function Questions({ l, questions, initial, onAsk }: { l: Line; questions: Question[]; initial: string; onAsk: (text: string) => void }) {
  const [asking, setAsking] = useState(false)
  const [draft, setDraft] = useState('')
  return <>
    <h4>Questions</h4>
    <div className="tl-thread">{questions.map(q => (
      <div key={q.id} className="tl-thread">
        <div className="tl-msg"><div className="tl-who"><span className="tl-avatar">{initial}</span>You asked · {when(q.askedAt)}</div>{q.text}</div>
        {q.answer
          ? <div className="tl-msg tl-reply"><div className="tl-who"><span className="tl-avatar" style={{ background: 'var(--color-ink-muted)' }}>FC</span>{q.answer.by} · answered</div>{q.answer.text}</div>
          : <div className="tl-waiting">Waiting for a Forecast Creator or Reviewer. You can still accept or change the forecast meanwhile.</div>}
      </div>))}</div>
    {asking
      ? <div className="tl-form" style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <div><label className={labelClasses()} htmlFor={`tl-q-${l.rowId}`}>Your question about {l.name}</label>
            <textarea id={`tl-q-${l.rowId}`} className={inputClasses('min-h-16 resize-y py-2')} autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="e.g. Why is this so much higher than last December?" />
            <div className="tl-live">Goes to everyone in the Forecast Creator and Forecast Reviewer roles. You are told when it is answered.</div></div>
          <div className="tl-buttons">
            <Button variant="primary" onClick={() => { if (!draft.trim()) return; onAsk(draft.trim()); setDraft(''); setAsking(false) }}>Send question</Button>
            <Button onClick={() => { setDraft(''); setAsking(false) }}>Cancel</Button>
          </div>
        </div>
      : <div style={{ marginTop: questions.length ? 8 : 0 }}>
          <Button variant="quiet" className="-ml-2.5 px-2.5" onClick={e => { e.stopPropagation(); setAsking(true) }}
            icon={<svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}>
            {questions.length ? 'Ask another question' : 'Ask about this line'}</Button>
        </div>}
  </>
}

const HAPPENED = ['Items re-coded between them', 'Price change', 'Real change in demand', 'Not sure']

export function LinePanel({ item, header, storeStep, aop, answer, questions, onHelp, onAccept, onPropose, onAsk, width }: {
  item: Item; header: Header; storeStep: number; aop: boolean; answer?: Answer; questions: Question[]; width?: number
  onHelp: (t: HelpTopic) => void; onAccept: () => void; onPropose: (p: Proposal) => void; onAsk: (text: string) => void
}) {
  const [happened, setHappened] = useState<string | null>(null)
  return (
    <div className="tl-panel" style={width ? { width } : undefined} data-testid="line-panel">
      {isGroup(item) && (
        <div className="tl-gnote">
          <Chip hue="violet" compact className="mr-1.5">Moved in opposite directions</Chip>
          {item.members.map((m, i) => <span key={m.rowId}>{i ? ', ' : ''}{m.name} <span className={m.growth > 1 ? 'tl-up' : 'tl-down'}>growth ×{m.growth}</span></span>)}
          . Together: {inr(item.fc)} against {inr(item.ly)} last year ({pc(item.fc, item.ly)}). Items may have been re-coded between these lines, or demand may have shifted.
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="tl-dim">What happened here?</span>
            {HAPPENED.map(c => <ChoiceChip key={c} picked={happened === c} onToggle={() => setHappened(h => h === c ? null : c)}>{c}</ChoiceChip>)}
          </div>
        </div>)}
      <div className="tl-cols">
        <div className="tl-col"><BuildUp l={item} month={header.month} storeStep={storeStep} onHelp={onHelp} /><Checks l={item} month={header.month} storeStep={storeStep} /></div>
        <div className={cx('tl-col')}>
          <OtherModels l={item} aop={aop} month={header.month} />
          {isGroup(item)
            ? <div className="tl-dim" style={{ fontSize: 13, marginTop: 16 }}>Answer each line below; the group total follows.</div>
            : <>
                <YourAnswer key={`${item.rowId}:${answer?.status ?? ''}`} l={item} answer={answer} month={header.month} onAccept={onAccept} onPropose={onPropose} />
                <Questions l={item} questions={questions} initial={header.person.slice(0, 1)} onAsk={onAsk} />
              </>}
        </div>
      </div>
    </div>
  )
}
