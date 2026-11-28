// Help (TL-34, TL-35): how Feather Forecast builds the month, why 28 days, groups, the columns. A part's "?"
// opens it at that part's paragraph, with the way back to the subcategory.
import { useEffect, useRef, type ReactNode } from 'react'
import { Notice } from '@featherbase/shop-floor'
import { prevMonth, type HelpTopic, type Line } from './model'
import type { Header } from './review'

export function HelpTab({ header, lines, storeStep, at, from, onBack, intro, managers = false }: {
  header: Header; lines: Line[]; storeStep: number; at: HelpTopic | null; from: string | null; onBack: (line: string) => void
  /** A page's own first section ("Your store, December"), before how Feather Forecast builds the month. */
  intro?: ReactNode
  /** The managers' pages: AOP among the columns and under Value vs, and how changes are approved. */
  managers?: boolean
}) {
  const steps = lines.map(l => l.step || storeStep), { name, days, year } = header.month
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const target = root.current?.querySelector<HTMLElement>(`#help-${at}`)
    if (!target) return
    target.classList.remove('fr-target'); void target.offsetWidth; target.classList.add('fr-target')
    target.scrollIntoView({ block: 'center' })
  }, [at, from])
  return (
    <div className="fr-help" ref={root}>
      {from && <Notice className="mb-4">You came from <b>{from}</b>. <button type="button" className="fr-link" onClick={() => onBack(from)}>Back to the subcategory</button></Notice>}
      {intro}
      <h3 id="help-how">Feather Forecast: how it builds your {name}</h3>
      <p><b>Feather Forecast</b> is an explainable forecast: open any subcategory to see exactly how its number was built. For every subcategory and every {name} day, it blends six simple guesses ("bases"). Read together they say three things:</p>
      <ul>
        <li id="help-recent"><b style={{ color: 'var(--color-part-recent)' }}>From recent selling</b>: what the subcategory sold in the last 28 days, as a rate per day, × {days} {name} days.</li>
        <li id="help-step"><b style={{ color: 'var(--color-part-step)' }}>{name} step on top</b>: {name} usually sells more than late {prevMonth(name)}. Feather Forecast measures each subcategory's own {name} rate against its late-{prevMonth(name)} rate in past years: here it runs from ×{Math.min(...steps).toFixed(2)} to ×{Math.max(...steps).toFixed(2)}, shown on each subcategory. The step adds that extra on part of recent selling.</li>
        <li id="help-lastyear"><b style={{ color: 'var(--color-part-last-year)' }}>From last year × growth</b>: last {name}'s sales × how much faster or slower the subcategory sells now than last year.</li>
        <li id="help-adjust"><b className="fr-dim">Rebalanced within category</b>: after the blend, Feather Forecast takes a category's slower-selling subcategories (under ₹10,000 a day over the last 28 days) at the store, keeps their total, and shares it out again in line with each one's share of those 28 days' sales. One subcategory gains what another loses; the category total does not change. A fixed list of {name}-only lines (Christmas lines such as plum cake and stars) skips this and follows last {name} instead.</li>
        <li id="help-adjust-price"><b className="fr-dim">Price and rounding</b>: in Kerala's Grocery division, the forecast is re-priced at the last 28 days' selling price where that has changed; every day is rounded to whole rupees; and a subcategory whose month comes out below zero is set to zero. Usually a few rupees.</li>
      </ul>
      <h3 id="help-28">Why 28 days</h3>
      <p>Twenty-eight days is exactly four weeks, so every weekday counts four times and no weekday is over-counted. The rate per day is then laid over {name}'s {days} days.</p>
      <h3 id="help-groups">Groups: subcategories that moved in opposite directions</h3>
      <p>Sometimes one subcategory in a category shoots up while a sister subcategory drops. Items may have been re-coded from one subcategory to the other, or customers may have moved between them. Each subcategory's number then looks alarming, but together they are steady.</p>
      <p>The screen puts subcategories in a group when, <b>inside one category of your section</b>, at least one subcategory's Feather Forecast growth is <b>×2 or more</b> and at least one is <b>half or less</b>. All such subcategories in that category join the group. Subcategories that sold under about ₹1 L last year never qualify: Feather Forecast keeps their growth between about ×0.7 and ×1.3.</p>
      <p>Judge the group total first, then each subcategory. Tell us what happened (re-coded, price change, real change in demand, not sure).</p>
      <h3 id="help-columns">The columns</h3>
      <table className="fr-helptable"><tbody>
        <tr><td><b>Feather Forecast</b></td><td>Feather Forecast's {name} for the subcategory.</td></tr>
        <tr><td><b>Last month</b></td><td>What the subcategory sold in the last 28 days before Feather Forecast ran (to {header.cutOff}), as a rate per day × {name}'s {days} days. Hover the column heading to see this.</td></tr>
        <tr><td><b>Last year</b></td><td>What the subcategory sold in {name} {year - 1}.</td></tr>
        {managers && <tr><td><b>AOP</b></td><td>The annual plan for {header.month.label}, before tax. It is also one more opinion beside XGBoost and LightGBM in an opened subcategory.</td></tr>}
        <tr><td><b>Value vs</b></td><td>Feather Forecast's value against last month{managers ? ', last year and AOP' : ' and against last year'}, in %.{managers ? ' Against AOP it is coloured: on or above the plan, within 10% of it, or more than 10% behind. Click AOP (or Feather Forecast, or Last year) to sort by it.' : ''}</td></tr>
        <tr><td><b>Value · Qty · ASP</b></td><td>Rupees before tax, pieces, and average selling price (value ÷ pieces). Use <b>Show</b> for all three, value and quantity, or one at a time. ASP appears only with value and quantity, since it is one divided by the other.</td></tr>
        <tr><td><b>Built from</b></td><td>The share of Feather Forecast's number from each part, as a 100% bar or donut. Hover it for the percentages.</td></tr>
      </tbody></table>
      {managers && <>
        <h3 id="help-approvals">Changes and approvals</h3>
        <p>A Team Leader proposes a change with reasons and an explanation: the month in rupees or by a percentage, or some days (one day, or a range of days approved as one). It goes up the reporting chain. The Store Manager approves it, edits the number and approves, or sends it back with a reason; the Store Manager's decision is final. Questions go to the Forecast Creator and Forecast Reviewer roles.</p>
      </>}
    </div>
  )
}
