// The five other pages: Numbers (approvals and every number), Runs & Targets, Results (grading and the
// scorecard), Review (questions and answers each month) and Ideas (the register of trials).
import { useState } from 'react'
import { Button, Card, DataList, Field, Headline, Segmented, StatusPill, TextInput, fmtINR, type DataColumn, type StatusTone } from '@featherbase/shop-floor'
import { RUNS, SUBS, TARGETS, type Run, type TargetVersion } from './madeUp'
import { Page, address, waitingFor, type Ctx, type IdeaRow, type NumberRow, type QuestionRow } from './App'
import { STATUS_TONE, Who, when } from './ForecastsPage'

const link = (n: NumberRow) => address('forecasts', { store: n.store, section: n.section, sub: n.scope_name, pane: 'numbers' })
const engineOf = (n: NumberRow) => {
  const s = SUBS.find(x => x.store === n.store && x.name === n.scope_name)
  return s ? (n.month === '2026-10' ? s.octEngine : s.engine) : null
}

export function NumbersPage({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState<'All' | NumberRow['status']>('All')
  const mine = waitingFor(ctx.data, ctx.viewer)
  const rows = ctx.data.numbers.filter(n => n.month === '2026-11' && (status === 'All' || n.status === status))
    .sort((a, b) => b.entered_on.localeCompare(a.entered_on))
  const columns: DataColumn<NumberRow>[] = [
    { key: 'for', header: 'For', phone: 'title', cell: n => <a href={link(n)} className="whitespace-nowrap font-medium">{n.scope_name}</a> },
    { key: 'store', header: 'Store · Section', phone: 'meta', cell: n => `${n.store} · ${n.section}` },
    { key: 'by', header: 'Entered By', phone: 'meta', cell: n => <div className="w-56"><Who name={n.entered_by} /></div> },
    { key: 'how', header: 'How', phone: 'hidden', cell: n => n.kind },
    { key: 'value', header: 'Figure', align: 'end', phone: 'value', cell: n => <span className="font-semibold">{fmtINR(n.value)}</span> },
    { key: 'vs', header: 'On The Engine', align: 'end', phone: 'hidden', cell: n => { const e = engineOf(n); return e ? `${n.value >= e ? '+' : ''}${Math.round((n.value / e - 1) * 100)}%` : '—' } },
    { key: 'status', header: 'Status', phone: 'status', cell: n => <StatusPill tone={STATUS_TONE[n.status]}>{n.status === 'Waiting' ? `Waiting for ${n.waiting_on}` : n.status}</StatusPill> },
    { key: 'on', header: 'Entered', phone: 'hidden', cell: n => <span className="whitespace-nowrap">{when(n.entered_on)}</span> },
  ]
  return (
    <Page title="Numbers">
      <Card title={`Waiting For You${mine.length ? ` (${mine.length})` : ''}`}>
        <div className="px-4 pb-4">
          <DataList caption="Numbers waiting for you" rows={mine} columns={columns} rowKey={n => n.row_id} layout="table"
            empty={{ title: 'Nothing waits for you', body: `No number is waiting for ${ctx.viewer.name}. Switch "Viewing as" to Mani to see a manager's queue.` }} />
        </div>
      </Card>
      <Card title="Every Number This Month" actions={<Segmented label="Status" value={status} onChange={setStatus}
        options={(['All', 'Waiting', 'Applied', 'Reference', 'Not approved'] as const).map(v => ({ value: v, label: v }))} />}>
        <div className="px-4 pb-4"><DataList caption="Every number" rows={rows} columns={columns} rowKey={n => n.row_id} layout="table" empty={{ title: 'No numbers', body: 'No number has this status.' }} /></div>
      </Card>
    </Page>
  )
}

export function RunsPage({ ctx }: { ctx: Ctx }) {
  const tone: Record<Run['purpose'], StatusTone> = { official: 'positive', trial: 'opportunity', baseline: 'neutral' }
  const runCols: DataColumn<Run>[] = [
    { key: 'id', header: 'Run', phone: 'title', cell: r => <code className="text-[13px]">{r.id}</code> },
    { key: 'month', header: 'For', phone: 'meta', cell: r => r.month },
    { key: 'purpose', header: 'Purpose', phone: 'status', cell: r => <StatusPill tone={tone[r.purpose]}>{r.purpose}</StatusPill> },
    { key: 'origin', header: 'Sales Up To', phone: 'meta', cell: r => r.origin },
    { key: 'total', header: 'Total, Both Stores', align: 'end', phone: 'value', cell: r => fmtINR(r.total) },
    { key: 'wape', header: 'Error (WAPE)', align: 'end', phone: 'meta', cell: r => (r.wape == null ? <span className="text-ink-muted">month not over</span> : `${(r.wape * 100).toFixed(1)}%`) },
    { key: 'note', header: 'What It Is', phone: 'hidden', cell: r => <span className="text-sm text-ink-muted">{r.note}</span> },
  ]
  const nov = SUBS.reduce((n, s) => n + s.engine, 0)
  const oct = SUBS.reduce((n, s) => n + s.octEngine, 0)
  // Version 6 is the official Run with every applied number in place of the engine's figure.
  const applied = ctx.data.numbers.filter(n => n.month === '2026-11' && n.status === 'Applied')
    .reduce((t, n) => t + n.value - (SUBS.find(s => s.store === n.store && s.name === n.scope_name)?.engine ?? n.value), 0)
  const targets = TARGETS.map(t => ({ ...t, total: t.month === 'Oct 2026' ? oct : t.revision === 6 ? nov + applied : nov }))
  const tCols: DataColumn<TargetVersion>[] = [
    { key: 'month', header: 'Month', phone: 'title', cell: t => <span className="font-medium">{t.month}</span> },
    { key: 'rev', header: 'Version', phone: 'status', cell: t => <StatusPill tone={t.loaded === 'next build' ? 'caution' : t.revision === 5 && t.month === 'Nov 2026' ? 'positive' : 'neutral'}>{`revision ${t.revision}${t.loaded === 'next build' ? ' · proposed' : t.revision === 5 ? ' · current' : ''}`}</StatusPill> },
    { key: 'run', header: 'From Run', phone: 'meta', cell: t => <code className="text-[13px]">{t.fromRun}</code> },
    { key: 'loaded', header: 'Loaded', phone: 'meta', cell: t => t.loaded },
    { key: 'total', header: 'Total, Both Stores', align: 'end', phone: 'value', cell: t => fmtINR(t.total) },
    { key: 'note', header: 'What Changed', phone: 'hidden', cell: t => <span className="text-sm text-ink-muted">{t.note}</span> },
  ]
  return (
    <Page title="Runs & Targets">
      <Card title="Engine Runs"><div className="px-4 pb-4"><DataList caption="Engine Runs" rows={RUNS} columns={runCols} rowKey={r => r.id} layout="table" empty={{ title: 'No Runs', body: 'The engine has not written a Run yet.' }} /></div></Card>
      <Card title="Target Versions">
        <div className="flex flex-col gap-2 px-4 pb-4">
          <p className="text-sm text-ink-muted">The final forecast is the target. Each version is the official Run plus the numbers applied when it was built; the highest version is the one reports read.</p>
          <DataList caption="Target versions" rows={targets} columns={tCols} rowKey={t => `${t.month}-${t.revision}`} layout="table" empty={{ title: 'No targets', body: 'No target has been built yet.' }} />
        </div>
      </Card>
    </Page>
  )
}

interface Graded { n: NumberRow; engine: number; actual: number; off: number; engineOff: number; closer: number }
export function ResultsPage({ ctx }: { ctx: Ctx }) {
  const graded: Graded[] = ctx.data.numbers.filter(n => n.month === '2026-10').flatMap(n => {
    const s = SUBS.find(x => x.store === n.store && x.name === n.scope_name)
    if (!s) return []
    const off = Math.abs(n.value - s.octActual), engineOff = Math.abs(s.octEngine - s.octActual)
    return [{ n, engine: s.octEngine, actual: s.octActual, off, engineOff, closer: engineOff - off }]
  }).sort((a, b) => b.closer - a.closer)
  const people = [...new Set(graded.map(g => g.n.entered_by))].map(name => {
    const mine = graded.filter(g => g.n.entered_by === name)
    return { name, count: mine.length, beat: mine.filter(g => g.closer > 0).length, closer: mine.reduce((t, g) => t + g.closer, 0) }
  }).sort((a, b) => b.closer - a.closer)
  const beat = graded.filter(g => g.closer > 0).length
  const cols: DataColumn<Graded>[] = [
    { key: 'for', header: 'For', phone: 'title', cell: g => <span className="whitespace-nowrap font-medium">{g.n.scope_name} · {g.n.store}</span> },
    { key: 'by', header: 'Number By', phone: 'meta', cell: g => <div className="w-52"><Who name={g.n.entered_by} /></div> },
    { key: 'status', header: 'Was', phone: 'hidden', cell: g => <StatusPill tone={STATUS_TONE[g.n.status]}>{g.n.status}</StatusPill> },
    { key: 'value', header: 'Their Number', align: 'end', phone: 'meta', cell: g => fmtINR(g.n.value) },
    { key: 'engine', header: 'Engine', align: 'end', phone: 'meta', cell: g => fmtINR(g.engine) },
    { key: 'actual', header: 'Sold', align: 'end', phone: 'meta', cell: g => <span className="font-medium">{fmtINR(g.actual)}</span> },
    { key: 'closer', header: 'Closer Than The Engine By', align: 'end', phone: 'value', cell: g => <StatusPill tone={g.closer > 0 ? 'positive' : 'negative'}>{g.closer > 0 ? `+${fmtINR(g.closer)}` : `−${fmtINR(-g.closer)}`}</StatusPill> },
  ]
  return (
    <Page title="Results">
      <Headline label="October 2026 · every number graded against what sold" tone={beat * 2 >= graded.length ? 'positive' : 'caution'}
        conclusion={`${beat} of ${graded.length} numbers were closer than the engine`}
        detail="Applied and reference numbers are both graded, from the day each was entered. A number beats the engine when it sits closer to what sold." />
      <Card title="Forecaster Scorecard">
        <div className="px-4 pb-4">
          <DataList caption="Scorecard" rows={people} rowKey={p => p.name} layout="table" empty={{ title: 'No graded numbers', body: 'Numbers are graded once their month is over.' }} columns={[
            { key: 'who', header: 'Person', phone: 'title', cell: p => <div className="w-56"><Who name={p.name} /></div> },
            { key: 'count', header: 'Numbers', align: 'end', phone: 'meta', cell: p => p.count },
            { key: 'beat', header: 'Beat The Engine', align: 'end', phone: 'meta', cell: p => `${p.beat} of ${p.count}` },
            { key: 'closer', header: '₹ Closer In Total', align: 'end', phone: 'value', cell: p => <StatusPill tone={p.closer > 0 ? 'positive' : 'negative'}>{p.closer > 0 ? `+${fmtINR(p.closer)}` : `−${fmtINR(-p.closer)}`}</StatusPill> },
          ]} />
        </div>
      </Card>
      <Card title="Every Graded Number"><div className="px-4 pb-4"><DataList caption="Graded numbers" rows={graded} columns={cols} rowKey={g => g.n.row_id} layout="table" empty={{ title: 'Nothing graded', body: 'October has no numbers.' }} /></div></Card>
    </Page>
  )
}

export function ReviewPage({ ctx }: { ctx: Ctx }) {
  const tone: Record<string, StatusTone> = { Open: 'caution', Answered: 'positive', Decided: 'neutral' }
  const [asking, setAsking] = useState(false)
  const [q, setQ] = useState({ topic: '', question: '' })
  const ask = async () => { await ctx.save('forecasting.review_question', { month: '2026-10', ...q, asked_by: ctx.viewer.name, status: 'Open' }); setQ({ topic: '', question: '' }); setAsking(false); await ctx.reload() }
  return (
    <Page title="Review" actions={<Button variant="primary" onClick={() => setAsking(!asking)}>Ask a question</Button>}>
      <p className="-mt-2 text-sm text-ink-muted">Each month the forecast is reviewed here, in questions and answers, instead of across email and GitHub. October 2026, reviewed in November.</p>
      {asking && (
        <Card><div className="flex flex-col gap-2 p-4">
          <Field label="Topic"><TextInput value={q.topic} onChange={e => setQ({ ...q, topic: e.target.value })} placeholder="Accuracy, Method, Master data…" /></Field>
          <Field label="Question"><textarea rows={3} value={q.question} onChange={e => setQ({ ...q, question: e.target.value })} className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" /></Field>
          <div><Button variant="primary" disabled={!q.question.trim()} onClick={() => void ask()}>Ask</Button></div>
        </div></Card>
      )}
      <ol className="flex flex-col gap-3">
        {ctx.data.questions.map(x => <Question key={x.row_id} ctx={ctx} x={x} tone={tone[x.status] ?? 'neutral'} />)}
      </ol>
    </Page>
  )
}

function Question({ ctx, x, tone }: { ctx: Ctx; x: QuestionRow; tone: StatusTone }) {
  const [answer, setAnswer] = useState('')
  const save = async () => { await ctx.save('forecasting.review_question', { ...x, answer, answered_by: ctx.viewer.name, status: 'Answered' }); await ctx.reload() }
  return (
    <li><Card><div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2"><StatusPill tone={tone}>{x.status}</StatusPill><span className="text-[13px] text-ink-muted">{x.topic} · asked by {x.asked_by}</span></div>
      <p className="font-medium">{x.question}</p>
      {x.answer ? <div className="flex flex-col gap-1 rounded-control bg-subtle p-3"><p className="text-sm">{x.answer}</p><span className="text-[13px] text-ink-muted">— {x.answered_by}</span></div>
        : <div className="flex flex-col gap-2"><textarea rows={2} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Answer" className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" />
          <div><Button variant="secondary" disabled={!answer.trim()} onClick={() => void save()}>Answer</Button></div></div>}
    </div></Card></li>
  )
}

export function IdeasPage({ ctx }: { ctx: Ctx }) {
  const tone: Record<string, StatusTone> = { Idea: 'neutral', Planned: 'caution', Running: 'opportunity', Kept: 'positive', Dropped: 'missing' }
  const [status, setStatus] = useState('All')
  const [adding, setAdding] = useState(false)
  const [idea, setIdea] = useState({ title: '', kind: 'Trial', source: '' })
  const rows = ctx.data.ideas.filter(i => status === 'All' || i.status === status)
  const add = async () => { await ctx.save('forecasting.idea', { ...idea, owner: ctx.viewer.name, status: 'Idea' }); setIdea({ title: '', kind: 'Trial', source: '' }); setAdding(false); await ctx.reload() }
  const cols: DataColumn<IdeaRow>[] = [
    { key: 'title', header: 'Idea', phone: 'title', cell: i => <span className="font-medium">{i.title}</span> },
    { key: 'kind', header: 'Kind', phone: 'meta', cell: i => i.kind },
    { key: 'status', header: 'Status', phone: 'status', cell: i => <StatusPill tone={tone[i.status] ?? 'neutral'}>{i.status}</StatusPill> },
    { key: 'owner', header: 'Owner', phone: 'meta', cell: i => i.owner },
    { key: 'source', header: 'Came From', phone: 'hidden', cell: i => <span className="text-sm text-ink-muted">{i.source}</span> },
    { key: 'result', header: 'What It Showed', phone: 'hidden', cell: i => <span className="text-sm">{i.result || <span className="text-ink-muted">—</span>}</span> },
  ]
  return (
    <Page title="Ideas" actions={<Button variant="primary" onClick={() => setAdding(!adding)}>Add an idea</Button>}>
      <p className="-mt-2 text-sm text-ink-muted">Every trial, model and check in one register, with what it showed. An idea kept becomes part of the next official Run.</p>
      {adding && (
        <Card><div className="flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-72 flex-1"><Field label="Idea"><TextInput value={idea.title} onChange={e => setIdea({ ...idea, title: e.target.value })} /></Field></div>
          <Segmented label="Kind" value={idea.kind} onChange={kind => setIdea({ ...idea, kind })} options={['Trial', 'Model', 'Check', 'Question'].map(v => ({ value: v, label: v }))} />
          <div className="w-56"><Field label="Came from"><TextInput value={idea.source} onChange={e => setIdea({ ...idea, source: e.target.value })} /></Field></div>
          <Button variant="primary" disabled={!idea.title.trim()} onClick={() => void add()}>Add</Button>
        </div></Card>
      )}
      <Card title="Idea Register" actions={<Segmented label="Status" value={status} onChange={setStatus} options={['All', 'Idea', 'Planned', 'Running', 'Kept', 'Dropped'].map(v => ({ value: v, label: v }))} />}>
        <div className="px-4 pb-4"><DataList caption="Ideas" rows={rows} columns={cols} rowKey={i => i.row_id} layout="table" empty={{ title: 'No ideas', body: 'No idea has this status.' }} /></div>
      </Card>
    </Page>
  )
}
