// The card at any level of RB's Forecast (prototype rb_review, 657a70c4d and b93dacc16: "at every level I want to see
// what the card says", RB 28-Nov). It sums the subcategories under where you stand: the one explanation table (#1420's
// BuildUp), the checks, the other models and the plan, and what drives the gaps to last year and to AOP, each driver
// a link one level down. A subcategory's card is the Team Leader's (BuildUp, Checks, OtherModels with the plan).
import { BuildUp, Checks, OtherModels } from '../shared/ExplainPanel'
import { combine, count, inr, storeStepOf, times, type Group, type HelpTopic, type Line } from '../shared/model'
import type { Header } from '../shared/review'
import { multiCategory } from '../shared/levels'

/** A child one level down: a node (a store, a division …) or a subcategory. */
export interface Kid { key: string; label: string; item: Line | Group; isNode: boolean }

function NodeChecks({ T, month, vo }: { T: Group; month: Header['month']; vo: boolean }) {
  const lyRise = T.ly28 > 0 && T.ly > 0 ? (T.ly / month.days) / (T.ly28 / 28) : null, fcRise = T.r31 > 0 ? T.fc / T.r31 : null
  return <>
    <h4>Checks</h4>
    <ul className="fr-checks">
      <li><b>Selling now:</b> last 28 days {inr(T.l28)} against {inr(T.ly28)} in the same days last year (<b>{times(T.l28, T.ly28)}</b>){vo ? '' : `; pieces ${count(T.ly28q)} → ${count(T.l28q)}`}.</li>
      {fcRise && lyRise && <li><b>{month.name} rise:</b> Feather Forecast is ×{fcRise.toFixed(2)} the last 28 days' rate. Last year {month.name} was ×{lyRise.toFixed(2)} its 28 days before.
        {fcRise > lyRise * 1.15 ? ' Feather Forecast expects a bigger rise than last year.' : fcRise < lyRise / 1.15 ? ' Feather Forecast expects a smaller rise than last year.' : ''}</li>}
    </ul>
  </>
}

/** The five children that move a gap most, either way, largest first; a share of the gap only where it is part of it. */
function Drivers({ T, kids, onKid }: { T: Group; kids: Kid[]; onKid: (k: Kid) => void }) {
  if (kids.length < 2) return null
  const list = (f: (o: Line | Group) => number, what: string) => {
    const total = f(T)
    const top = [...kids].sort((a, b) => Math.abs(f(b.item)) - Math.abs(f(a.item))).slice(0, 5).filter(k => Math.abs(f(k.item)) >= 1)
    return (
      <div className="rb-drv">
        <div className="rb-drvh">{what} <span className="fr-dim">{total >= 0 ? '+' : ''}{inr(total)} in all</span></div>
        <ol>{top.map(k => {
          const v = f(k.item), part = total && Math.sign(v) === Math.sign(total) && Math.abs(v) <= Math.abs(total)
          return (
            <li key={k.key}>
              <button type="button" className="fr-link" onClick={() => onKid(k)}>{k.label}</button>
              <span className={v < 0 ? "rb-down" : "rb-up"}>{v >= 0 ? '+' : ''}{inr(v)}</span>
              <span className="fr-dim">{part ? `${Math.round(v / total * 100)}% of it` : ''}</span>
            </li>)
        })}</ol>
      </div>)
  }
  return <>
    <h4>What drives this</h4>
    {list(o => o.fc - o.ly, 'Against last year')}
    {T.aop ? list(o => o.fc - o.aop, 'Against AOP') : null}
  </>
}

/** The card for where you stand (or for a child, in the side pane): the subcategories under it, summed. */
export function NodeCard({ lines, kids, header, onHelp, onKid, inPane = false, narrow = false }: {
  lines: Line[]; kids: Kid[]; header: Header; onHelp: (t: HelpTopic) => void; onKid: (k: Kid) => void; inPane?: boolean
  /** One column: the side pane is open beside it. */
  narrow?: boolean
}) {
  const T = combine(lines, -1)
  return (
    <div className={inPane ? 'rb-card rb-card-pane' : narrow ? 'rb-card rb-card-narrow' : 'rb-card'} data-testid="rb-card">
      <div className="fr-cols">
        <div className="fr-col"><BuildUp l={T} month={header.month} storeStep={storeStepOf(lines)} onHelp={onHelp} /><NodeChecks T={T} month={header.month} vo={multiCategory(lines)} /></div>
        <div className="fr-col"><OtherModels l={T} aop month={header.month} /><Drivers T={T} kids={kids} onKid={onKid} /></div>
      </div>
    </div>)
}

/** A subcategory's card in the side pane, one column: how it was built, the checks, the other models and the plan. */
export function LineCard({ l, storeStep, header, onHelp }: { l: Line; storeStep: number; header: Header; onHelp: (t: HelpTopic) => void }) {
  return (
    <div className="rb-card rb-card-pane" data-testid="rb-line-card">
      <BuildUp l={l} month={header.month} storeStep={storeStep} onHelp={onHelp} />
      <Checks l={l} month={header.month} storeStep={storeStep} />
      <OtherModels l={l} aop month={header.month} />
    </div>)
}
