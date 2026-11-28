// The Team Leader review as a story (#1419): the real screen on the made-up fixture (fixtures/team-leader-
// december.json), its answers and questions in memory, beside a grey block where the Featherbase shell goes, as
// the agreed prototype draws it. Open with the app's Vite dev server at /story.html. No server, no sign-in.
// A question is answered by window.__answerLatest() (the story's stand-in for a Forecast Creator's Comment).
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { paintTheme } from '@featherbase/shop-floor/theme'
import fixture from '../../fixtures/team-leader-december.json'
import { stockAsOf, type StockBandRow } from '../shared/bands'
import { day, inr, linesFrom, monthOfRun, pc, shares, storeStepOf, times, type CopiedRows, type Line } from '../shared/model'
import type { Answer, Header, Question, ReviewActions, ReviewState } from '../shared/review'
import { TeamLeaderReview } from './TeamLeaderReview'
import '../style.css'

paintTheme('light')
const run = fixture.forecast_run[0]
const lines = linesFrom({ lines: fixture.forecast_line_month, sales: fixture.sales_reference, plans: fixture.annual_plan_line, others: fixture.other_model_day,
  bands: { mix: fixture.price_band_mix, stock: fixture.stock_band, items: fixture.price_band_top_item } } as unknown as CopiedRows, '9001')
const header: Header = { store: 'Lakeside', section: 'Girls Bottoms', person: 'Asha', role: 'Team Leader', cutOff: day(run.origin_date), month: monthOfRun(run.horizon_from),
  stockAsOf: stockAsOf(fixture.stock_band as unknown as StockBandRow[]) }

/** What a Forecast Creator might answer, drawn from the line's own figures (the prototype's stand-in). */
function reply(l: Line) {
  const top = shares(l).sort((a, b) => b.share - a.share)[0]
  const trend = l.l28 >= l.ly28 ? `the subcategory is selling ${times(l.l28, l.ly28)} what it sold in the same 28 days last year` : `the subcategory is selling ${times(l.l28, l.ly28)} less than in the same 28 days last year`
  return `Most of the ${inr(l.fc)} comes from “${top.label}” (${Math.round(top.share)}%). It is ${pc(l.fc, l.ly)} on last ${header.month.name} mainly because ${trend}. If you know of stock or range changes that the sales cannot show yet, propose a change and say why.`
}

function Story() {
  const [state, setState] = useState<ReviewState>({ answers: {}, questions: [] })
  const answer = (name: string, a: Answer) => setState(s => ({ ...s, answers: { ...s.answers, [name]: a } }))
  const actions: ReviewActions = {
    accept: async l => answer(l.name, { status: 'accepted', value: null, reasons: [], note: '' }),
    propose: async (l, p) => answer(l.name, { status: 'change_proposed', value: p.value, reasons: p.reasons, note: p.note }),
    ask: async (l, text) => setState(s => ({ ...s, questions: [...s.questions, { id: `q${s.questions.length + 1}`, line: l.name, text, askedAt: new Date().toISOString(), answer: null, seen: false }] })),
    seen: async name => setState(s => ({ ...s, questions: s.questions.map(q => q.line === name && q.answer ? { ...q, seen: true } : q) })),
  }
  ;(window as unknown as { __answerLatest: () => void }).__answerLatest = () => setState(s => {
    const q = [...s.questions].reverse().find(x => !x.answer)
    if (!q) return s
    const l = lines.find(x => x.name === q.line)!
    return { ...s, questions: s.questions.map((x): Question => x === q ? { ...x, answer: { text: reply(l), by: 'Forecast Creator · Head Office' }, seen: false } : x) }
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', minHeight: '100vh' }}>
      <div aria-label="Featherbase shell (platform, not drawn)" style={{ display: 'flex', justifyContent: 'center', paddingTop: '40vh', background: 'var(--color-fill-hover)', color: 'var(--color-ink-subtle)', fontSize: 13, fontWeight: 500 }}>Featherbase shell</div>
      <main style={{ minWidth: 0, margin: 8, background: 'var(--color-surface)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-panel)' }}>
        <TeamLeaderReview header={header} lines={lines} storeStep={storeStepOf(lines)} state={state} actions={actions} hrefFor={l => `?line=${encodeURIComponent(l.name)}`} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Story /></StrictMode>)
