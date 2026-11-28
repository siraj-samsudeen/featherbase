// How Feather Forecast got a number (TL-26..TL-29), for a subcategory or anything summed from them (a group, a
// level of a tree): the parts with their bases, the checks, the other models, and what a group of opposite
// movers says (TL-24). Every sentence is the agreed prototype's.
import { useState } from 'react'
import { Chip, ChoiceChip } from '@featherbase/shop-floor'
import { BASE_INFO, count, decemberRise, inr, pc, times, type BasisCode, type Group, type HelpTopic, type Line } from './model'
import { explain, shareText, weightText, weightUsed, weightsOf, type ExplainRow } from './explanation'
import { Hover } from './Hover'
import type { Header } from './review'

export type Item = Line | Group
export const isGroup = (l: Item): l is Group => 'members' in l

export function HelpMark({ topic, onHelp }: { topic: HelpTopic; onHelp: (t: HelpTopic) => void }) {
  return <button type="button" className="fr-qhelp" title="What this part means (opens Help)" aria-label={`Help: ${topic}`}
    onClick={e => { e.stopPropagation(); onHelp(topic) }}>?</button>
}

export function BuildUp({ l, month, storeStep, onHelp }: { l: Item; month: Header['month']; storeStep: number; onHelp: (t: HelpTopic) => void }) {
  // one table that can be checked by hand (Siraj, 28-Nov): its own value × weight used = adds, the adds summing to
  // Feather Forecast exactly and the shares to exactly 100% (explanation.ts)
  const st = l.step ?? storeStep, e = explain(l.bases, l.rebal, l.price, l.fc)
  const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${count(Math.abs(Math.round(v)))}`
  // above one subcategory the steps differ: their range, as the prototype's card ("×0.57 to ×2")
  const steps = isGroup(l) ? l.members.map(m => m.step).filter(Boolean) : []
  const range = steps.length ? (Math.min(...steps) === Math.max(...steps) ? ` (×${steps[0]})` : ` (×${Math.min(...steps)} to ×${Math.max(...steps)})`) : ''
  const name: Record<BasisCode, string> = { ...BASE_INFO, B3: `Last 28 days, per day × ${month.days}`, B6: `Last 28 days × ${month.name} step${isGroup(l) ? range : ` (×${st})`}`,
    B1: `Same date last year × growth${isGroup(l) ? '' : ` (×${l.growth})`}` }
  const weight = (r: ExplainRow) => {
    const w = weightUsed(r)
    if (w == null) return '—'
    return r.fitted == null
      ? <Hover text="Weight used = adds ÷ its own value, summed over the subcategories"><span className="fr-wtip">{weightText(w)}</span></Hover>
      : <Hover text={`Feather Forecast's fitted weight for the month: ${(r.fitted * 100).toFixed(1)}%; day weights differ on Sundays, salary days and Christmas`}><span className="fr-wtip">{weightText(w)}</span></Hover>
  }
  const baseRow = (r: ExplainRow) => (
    <tr key={r.code} className="fr-brow">
      <td><b>{r.code}</b> {name[r.code!]}{r.code === 'B6' && <HelpMark topic="step" onHelp={onHelp} />}</td>
      <td>{r.own == null ? '—' : rupees(r.own)}</td><td>{weight(r)}</td><td className="fr-fc">{rupees(r.adds)}</td><td>{shareText(r.share)}</td>
    </tr>)
  const head = (color: string, label: string, topic: HelpTopic, from: string, rows: ExplainRow[]) => rows.length > 0 && (
    <tr key={label} className="fr-grow">
      <td><span className="fr-part"><span className="fr-swatch" style={{ background: color }} />{label}<HelpMark topic={topic} onHelp={onHelp} /></span><div className="fr-from">{from}</div></td>
      <td /><td className="fr-dim">≈ {weightText(weightsOf(rows))}</td><td className="fr-fc">{rupees(rows.reduce((t, r) => t + r.adds, 0))}</td>
      <td className="fr-fc">{shareText(rows.reduce((t, r) => t + r.share, 0))}</td>
    </tr>)
  const after = (r: ExplainRow) => {
    const rebal = r.kind === 'rebal'
    return (
      <tr key={r.kind} className="fr-grow">
        <td className="fr-dim"><span className="fr-part" style={{ fontWeight: 500 }}><span className="fr-swatch" style={{ background: 'var(--color-part-adjust)' }} />
          {rebal ? 'Rebalanced within category' : 'Price and rounding'}<HelpMark topic={rebal ? 'adjust' : 'adjust-price'} onHelp={onHelp} /></span>
          <div className="fr-from">{rebal ? `Moved ${r.adds < 0 ? 'from' : 'to'} this subcategory so each slower-selling subcategory in ${isGroup(l) ? 'the category' : l.category} gets its share of the last 28 days' sales; the category total is unchanged`
            : 'Recent selling price where it changed, and rounding to whole rupees'}</div></td>
        <td /><td /><td className="fr-fc fr-dim">{rupees(r.adds)}</td><td className="fr-dim">{shareText(r.share)}</td>
      </tr>)
  }
  return <>
    <h4>How Feather Forecast got {rupees(e.total)}</h4>
    <table className="fr-mini fr-build fr-one">
      <thead><tr><th>Part</th><th>Its own value</th><th>Weight used</th><th>Adds</th><th>Share</th></tr></thead>
      <tbody>
        {head('var(--color-part-last-year)', 'From last year', 'lastyear', `Last ${month.name} ${inr(l.ly)} (${count(l.lyq)} pcs)${isGroup(l) ? " × each subcategory's growth" : ` × growth ${l.growth}`}`, e.lastYear)}
        {e.lastYear.map(baseRow)}
        {head('var(--color-part-recent)', 'From last month', 'recent', `Last 28 days ${inr(l.l28)} (${count(l.l28q)} pcs) = ${inr(l.l28 / 28)} a day; carried into ${month.name} at ${month.name}'s day pattern${isGroup(l) ? '' : `; B6 adds the ${month.name} step ×${st}`}`, e.lastMonth)}
        {e.lastMonth.map(baseRow)}
        {e.after.map(after)}
      </tbody>
      <tfoot><tr><td>Feather Forecast</td><td /><td>≈ {weightText(weightsOf([...e.lastYear, ...e.lastMonth]))}</td><td>{rupees(e.total)}</td><td>100%</td></tr></tfoot>
    </table>
    <p className="fr-dim fr-build-note">Each row: its own value × weight used = adds. Weights come to about 100%, not exactly: the blend shifts slightly on Sundays, salary days and Christmas. Adds and Share add up exactly. Hover a weight for Feather Forecast's fitted weight for the month.</p>
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
  // a model with no figure for this subcategory (not run for it yet) is left out, never shown as ₹0 / −100%
  const rows = ([['Feather Forecast', 'var(--color-ink)', l.fc], ['XGBoost', '#0f9d8a', l.xgb], ['LightGBM', '#e0821e', l.lgbm], ...(aop ? [['AOP', '#c58b1e', l.aop]] : [])] as [string, string, number][])
    .filter(([name, , v]) => name === 'Feather Forecast' || v)
  return <>
    <h4>{aop ? 'Other models and the plan' : 'Other models'}</h4>
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
