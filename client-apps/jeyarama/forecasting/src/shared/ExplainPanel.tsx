// How Feather Forecast got a number (TL-26..TL-29), for a subcategory or anything summed from them (a group, a
// level of a tree): the parts with their bases, the checks, the other models, and what a group of opposite
// movers says (TL-24). Every sentence is the agreed prototype's.
import { useState } from 'react'
import { Chip, ChoiceChip } from '@featherbase/shop-floor'
import { BASE_INFO, PARTS, count, decemberRise, inr, pc, pct0, prevMonth, times, weightOf, type Group, type HelpTopic, type Line } from './model'
import type { Header } from './review'

export type Item = Line | Group
export const isGroup = (l: Item): l is Group => 'members' in l

export function HelpMark({ topic, onHelp }: { topic: HelpTopic; onHelp: (t: HelpTopic) => void }) {
  return <button type="button" className="fr-qhelp" title="What this part means (opens Help)" aria-label={`Help: ${topic}`}
    onClick={e => { e.stopPropagation(); onHelp(topic) }}>?</button>
}

export function BuildUp({ l, month, storeStep, onHelp }: { l: Item; month: Header['month']; storeStep: number; onHelp: (t: HelpTopic) => void }) {
  const [six, setSix] = useState(false)
  const st = l.step ?? storeStep, rate = l.l28 / 28, own = rate * month.days
  const lyOwn = l.bases.find(b => b.code === 'B1')?.own ?? 0
  const wRec = weightOf(l, ['B3', 'B4', 'B5', 'B6']), wStep = weightOf(l, ['B6']), wLy = weightOf(l, ['B1', 'B2'])
  const share = (v: number) => `${Math.round(Math.max(0, v) / l.fc * 100)}%`
  const [recent, step, lastYear, adjust] = PARTS
  const part = (p: typeof recent, from: string, ownText: string, w: number | null, adds: number) => (
    <tr key={p.key}>
      <td><span className="fr-part"><span className="fr-swatch" style={{ background: p.color }} />{p.label}<HelpMark topic={p.topic} onHelp={onHelp} /></span><div className="fr-from">{from}</div></td>
      <td>{ownText}</td><td>{pct0(w)}</td><td className="fr-fc">{inr(adds)}</td><td>{share(adds)}</td>
    </tr>)
  return <>
    <h4>How Feather Forecast got {inr(l.fc)}</h4>
    <table className="fr-mini fr-build">
      <thead><tr><th>Part</th><th>Its own {month.name}</th><th>Weight</th><th>Adds</th><th>Share</th></tr></thead>
      <tbody>
        {part(recent, `Last 28 days ${inr(l.l28)} (${count(l.l28q)} pcs) = ${inr(rate)} a day × ${month.days} ${month.name} days`, `≈ ${inr(own)}`, wRec, l.fromRecent)}
        {part(step, wStep === 0 ? 'Not used for this subcategory.'
          : `${month.name} usually sells ×${st} the late-${prevMonth(month.name)} rate here: ${Math.round((st - 1) * 100)}% more on the part of recent selling that gets the step${wStep == null ? '' : ` (${pct0(wStep)} of the ${pct0(wRec)})`}`,
          wStep === 0 ? '' : `≈ ${inr(own * (st - 1))}`, null, l.lift)}
        {part(lastYear, `Last ${month.name} ${inr(l.ly)} (${count(l.lyq)} pcs)${isGroup(l) ? " × each subcategory's growth" : ` × growth ${l.growth}`}`, `≈ ${inr(lyOwn)}`, wLy, l.lyg)}
        {l.adj !== 0 && (
          <tr>
            <td className="fr-dim"><span className="fr-part" style={{ fontWeight: 500 }}><span className="fr-swatch" style={{ background: adjust.color }} />{adjust.label}<HelpMark topic="adjust" onHelp={onHelp} /></span>
              <div className="fr-from">Tidy-up steps, such as splitting very small subcategories</div></td>
            <td /><td /><td className="fr-fc fr-dim">{inr(l.adj)}</td><td className="fr-dim">{Math.round(Math.abs(l.adj) / l.fc * 100)}%</td>
          </tr>)}
        {six && (
          <tr><td colSpan={5} style={{ padding: 0, background: 'transparent' }}>
            <table className="fr-mini fr-six">
              <thead><tr><th>Base</th><th>Its own {month.name}</th><th>Weight</th><th>Adds</th></tr></thead>
              <tbody>{l.bases.map(b => (
                <tr key={b.code}><td><b>{b.code}</b> {BASE_INFO[b.code]}</td><td>{b.own == null ? '—' : inr(b.own)}</td><td>{pct0(b.w)}</td><td>{inr(b.adds)}</td></tr>))}</tbody>
            </table>
          </td></tr>)}
      </tbody>
      <tfoot><tr><td>Feather Forecast</td><td /><td /><td>{inr(l.fc)}</td><td>100%</td></tr></tfoot>
    </table>
    <div style={{ marginTop: 8 }}>
      <button type="button" className="fr-link" onClick={e => { e.stopPropagation(); setSix(s => !s) }}>{six ? 'Hide' : 'Show'} the six bases</button>
      <span className="fr-dim" style={{ fontSize: 12 }}> · weights shift a little by day type (Sundays, salary days, Christmas)</span>
    </div>
  </>
}

export function Checks({ l, month, storeStep }: { l: Item; month: Header['month']; storeStep: number }) {
  const st = l.step ?? storeStep
  const { lyStep, note } = decemberRise(l, st)
  return <>
    <h4>Checks</h4>
    <ul className="fr-checks">
      <li><b>Selling now:</b> last 28 days {inr(l.l28)} against {inr(l.ly28)} in the same days last year (<b>{times(l.l28, l.ly28)}</b>); pieces {count(l.ly28q)} → {count(l.l28q)}.</li>
      <li><b>{month.name} rise:</b> Feather Forecast lifts recent selling ×{st}, the usual {month.name} rise here. Last year this subcategory went from {inr(l.ly28)} in the 28 days before {month.name} to {inr(l.ly)} in {month.name}: <b>×{lyStep.toFixed(1)}</b> per day.{note}</li>
    </ul>
  </>
}

export function OtherModels({ l, aop, month }: { l: Item; aop: boolean; month: Header['month'] }) {
  const rows: [string, string, number][] = [['Feather Forecast', 'var(--color-ink)', l.fc], ['XGBoost', '#0f9d8a', l.xgb], ['LightGBM', '#e0821e', l.lgbm], ...(aop ? [['AOP', '#c58b1e', l.aop] as [string, string, number]] : [])]
  return <>
    <h4>Other models</h4>
    <table className="fr-mini">
      <thead><tr><th /><th>{month.name}</th><th>vs Feather Forecast</th></tr></thead>
      <tbody>{rows.map(([name, color, v]) => (
        <tr key={name}><td><span className="fr-swatch round" style={{ background: color }} />{name}</td><td>{inr(v)}</td><td>{name === 'Feather Forecast' ? '' : pc(v, l.fc)}</td></tr>))}</tbody>
    </table>
  </>
}

const HAPPENED = ['Items re-coded between them', 'Price change', 'Real change in demand', 'Not sure']

/** An opened group (TL-24): each member's growth, the combined figure against last year, and "What happened here?". */
export function GroupNote({ group }: { group: Group }) {
  const [happened, setHappened] = useState<string | null>(null)
  return (
    <div className="fr-gnote">
      <Chip hue="violet" compact className="mr-1.5">Moved in opposite directions</Chip>
      {group.members.map((m, i) => <span key={m.rowId}>{i ? ', ' : ''}{m.name} <span className={m.growth > 1 ? 'fr-up' : 'fr-down'}>growth ×{m.growth}</span></span>)}
      . Together: {inr(group.fc)} against {inr(group.ly)} last year ({pc(group.fc, group.ly)}). Items may have been re-coded between these subcategories, or demand may have shifted.
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="fr-dim">What happened here?</span>
        {HAPPENED.map(c => <ChoiceChip key={c} picked={happened === c} onToggle={() => setHappened(h => h === c ? null : c)}>{c}</ChoiceChip>)}
      </div>
    </div>)
}
