// Help (TL-34, TL-35) and My questions (TL-33): the agreed prototype's words.
import { useEffect, useRef, useState } from 'react'
import { Bell, Button, Notice, RecordLink, StatusPill, raisedClasses } from '@featherbase/shop-floor'
import type { HelpTopic, Line } from './model'
import type { Header, Question } from './review'

export function HelpTab({ header, lines, storeStep, at, from, onBack }: {
  header: Header; lines: Line[]; storeStep: number; at: HelpTopic | null; from: string | null; onBack: (line: string) => void
}) {
  const steps = lines.map(l => l.step || storeStep), { name, days, year } = header.month
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const target = root.current?.querySelector<HTMLElement>(`#help-${at}`)
    if (!target) return
    target.classList.remove('tl-target'); void target.offsetWidth; target.classList.add('tl-target')
    target.scrollIntoView({ block: 'center' })
  }, [at, from])
  return (
    <div className="tl-help" ref={root}>
      {from && <Notice className="mb-4">You came from <b>{from}</b>. <button type="button" className="tl-link" onClick={() => onBack(from)}>Back to the line</button></Notice>}
      <h3 id="help-how">Feather Forecast: how it builds your {name}</h3>
      <p><b>Feather Forecast</b> is an explainable forecast: open any line to see exactly how its number was built. For every line and every {name} day, it blends six simple guesses ("bases"). Read together they say three things:</p>
      <ul>
        <li id="help-recent"><b style={{ color: 'var(--color-part-recent)' }}>From recent selling</b>: what the line sold in the last 28 days, as a rate per day, × {days} {name} days.</li>
        <li id="help-step"><b style={{ color: 'var(--color-part-step)' }}>{name} step on top</b>: {name} usually sells more than late {prevMonth(name)}. Feather Forecast measures each line's own {name} rate against its late-{prevMonth(name)} rate in past years: here it runs from ×{Math.min(...steps).toFixed(2)} to ×{Math.max(...steps).toFixed(2)}, shown on each line. The step adds that extra on part of recent selling.</li>
        <li id="help-lastyear"><b style={{ color: 'var(--color-part-last-year)' }}>From last year × growth</b>: last {name}'s sales × how much faster or slower the line sells now than last year.</li>
        <li id="help-adjust"><b className="tl-dim">Adjustments</b>: small tidy-up steps after the blend, such as splitting the number of very small lines. Shown only when they are not zero.</li>
      </ul>
      <h3 id="help-28">Why 28 days</h3>
      <p>Twenty-eight days is exactly four weeks, so every weekday counts four times and no weekday is over-counted. The rate per day is then laid over {name}'s {days} days.</p>
      <h3 id="help-groups">Groups: lines that moved in opposite directions</h3>
      <p>Sometimes one line in a category shoots up while a sister line drops. Items may have been re-coded from one line to the other, or customers may have moved between them. Each line's number then looks alarming, but together they are steady.</p>
      <p>The screen puts lines in a group when, <b>inside one category of your section</b>, at least one line's Feather Forecast growth is <b>×2 or more</b> and at least one is <b>half or less</b>. All such lines in that category join the group. Lines that sold under about ₹1 L last year never qualify: Feather Forecast keeps their growth between about ×0.7 and ×1.3.</p>
      <p>Judge the group total first, then each line. Tell us what happened (re-coded, price change, real change in demand, not sure).</p>
      <h3 id="help-columns">The columns</h3>
      <table className="tl-helptable"><tbody>
        <tr><td><b>Feather Forecast</b></td><td>Feather Forecast's {name} for the line.</td></tr>
        <tr><td><b>Last month</b></td><td>What the line sold in the last 28 days before Feather Forecast ran (to {header.cutOff}), as a rate per day × {name}'s {days} days. Hover the column heading to see this.</td></tr>
        <tr><td><b>Last year</b></td><td>What the line sold in {name} {year - 1}.</td></tr>
        <tr><td><b>Value vs</b></td><td>Feather Forecast's value against last month and against last year, in %.</td></tr>
        <tr><td><b>Value · Qty · ASP</b></td><td>Rupees before tax, pieces, and average selling price (value ÷ pieces). Use <b>Show</b> for all three, value and quantity, or one at a time. ASP appears only with value and quantity, since it is one divided by the other.</td></tr>
        <tr><td><b>Built from</b></td><td>The share of Feather Forecast's number from each part, as a 100% bar or donut. Hover it for the percentages.</td></tr>
      </tbody></table>
    </div>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const prevMonth = (name: string) => MONTHS[(MONTHS.indexOf(name) + 11) % 12]

/** The header's My questions button (TL-33): "N open" while questions wait, a red count of unread answers, and the menu. */
export function MyQuestions({ questions, lines, hrefFor, onJump }: { questions: Question[]; lines: Line[]; hrefFor: (line: Line) => string; onJump: (line: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [open])
  const unread = questions.filter(q => q.answer && !q.seen).length, waiting = questions.filter(q => !q.answer).length
  return (
    <div className="tl-qwrap" ref={box}>
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)} icon={<Bell aria-hidden size={16} />} className="relative">
        My questions{waiting && !unread ? <span className="tl-dim" style={{ fontWeight: 400 }}>{waiting} open</span> : null}
        {unread ? <span className="tl-count" aria-label={`${unread} new ${unread === 1 ? 'answer' : 'answers'}`}>{unread}</span> : null}
      </Button>
      {open && (
        <div className={raisedClasses('tl-qmenu')} role="menu" aria-label="My questions">
          <h5>Questions you asked, newest first</h5>
          {questions.length ? [...questions].reverse().map(q => {
            const line = lines.find(l => l.name === q.line)
            return (
              <a key={q.id} role="menuitem" className="tl-qitem" href={line ? hrefFor(line) : undefined}
                onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setOpen(false); onJump(q.line) }}>
                <span className="tl-qtop">
                  {q.answer && !q.seen && <span className="tl-newdot" title="New answer" />}
                  {line ? <RecordLink table="forecasting.forecast_line_month" rowId={line.rowId} name={q.line} inLink /> : <span>{q.line}</span>}
                  {q.answer ? <StatusPill tone="neutral">Answered</StatusPill> : <StatusPill tone="caution">Open</StatusPill>}
                </span>
                <span className="tl-qtext">{q.text}</span>
              </a>)
          }) : <div className="tl-qempty">No questions yet. Open a line and choose <b>Ask about this line</b>.</div>}
        </div>)}
    </div>
  )
}
