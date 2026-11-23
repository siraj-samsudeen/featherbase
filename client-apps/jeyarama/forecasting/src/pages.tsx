// Ledger (approvals and every number), Runs & Targets, Results (each scope's views against what sold,
// and the scorecard), Review (each month's questions and answers) and the Idea Register (every idea
// for making the forecast better, and what became of it). Each follows the shared top bar's month,
// but the Idea Register, whose ideas span months.
import { useMemo, useState } from 'react'
import { Button, Card, DataList, EmptyState, Field, Headline, SearchInput, Segmented, Select, StatusPill, TextInput, buttonClasses, fmtINR, type DataColumn, type StatusTone } from '@featherbase/shop-floor'
import { ALL_WEEKS, RUNS, SUBS, TARGETS, parseWeeks, type Run, type TargetVersion } from './madeUp'
import { actualFor, engineFor, finalWeeks } from './sales'
import { MONTHS, type Month } from './months'
import { NoRunYet, Page, address, waitingFor, type Ctx, type IdeaRow, type NumberRow, type QuestionRow } from './App'
import { STATUS_TONE, Who, scopeText, when } from './WorkspacePage'

const link = (n: NumberRow) => address('forecasts', { store: n.store, level: n.scope_level, name: n.scope_name, ...(n.weeks ? { weeks: n.weeks } : {}), pane: 'views' })
const engineOf = (n: NumberRow) => engineFor({ store: n.store, level: n.scope_level, name: n.scope_name, weeks: parseWeeks(n.weeks) }, n.month)
const signed = (p: number) => `${p >= 0 ? '+' : ''}${p}%`
/** Runs and targets name their month as "Nov 2026". */
const runMonth = (m: Month) => `${m.mon} ${m.year}`

export function NumbersPage({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState<'All' | NumberRow['status']>('All')
  const mine = waitingFor(ctx.data, ctx.viewer)
  const m = ctx.month
  const rows = ctx.data.numbers.filter(n => n.month === m.key && (status === 'All' || n.status === status)).sort((a, b) => b.entered_on.localeCompare(a.entered_on))
  const columns: DataColumn<NumberRow>[] = [
    { key: 'on', header: 'Entered', phone: 'meta', cell: n => <span className="whitespace-nowrap">{when(n.entered_on)}</span> },
    { key: 'by', header: 'Who', phone: 'meta', cell: n => <div className="w-52"><Who name={n.entered_by} /></div> },
    { key: 'for', header: 'Scope', phone: 'title', cell: n => <a href={link(n)} className="font-medium">{scopeText(n)}</a> },
    { key: 'how', header: 'Change', phone: 'hidden', cell: n => <span className="whitespace-nowrap">{n.kind} · {signed(Math.round((n.value / engineOf(n) - 1) * 100))}</span> },
    { key: 'value', header: 'Figure', align: 'end', phone: 'value', cell: n => <span className="font-semibold">{fmtINR(n.value)}</span> },
    { key: 'status', header: 'Status Now', phone: 'status', cell: n => <StatusPill tone={STATUS_TONE[n.status]}>{n.status === 'Waiting' ? `Waiting for ${n.waiting_on}` : n.status}</StatusPill> },
    { key: 'why', header: 'Reason', phone: 'hidden', cell: n => <span className="text-sm text-ink-muted">{n.reason}</span> },
  ]
  return (
    <Page title="Ledger">
      <p className="-mt-2 text-sm text-ink-muted">Who said what, and what happened to it. Nothing is overwritten or deleted: each row is one person's number for one scope, and every step is kept in its history.</p>
      <Card title={`Waiting For You${mine.length ? ` (${mine.length})` : ''}`}>
        <div className="px-4 pb-4">
          <DataList caption="Numbers waiting for you" rows={mine} columns={columns} rowKey={n => n.row_id} layout="table"
            empty={{ title: 'Nothing waits for you', body: `No number waits for ${ctx.viewer.name}. Switch "Viewing as" to Mani or Kumar to see an approver's queue.` }} />
        </div>
      </Card>
      <Card title={`Every Number, ${m.label}`} actions={<Segmented label="Status" value={status} onChange={setStatus}
        options={(['All', 'Waiting', 'Applied', 'Reference', 'Not approved'] as const).map(v => ({ value: v, label: v }))} />}>
        <div className="px-4 pb-4"><DataList caption="Every number" rows={rows} columns={columns} rowKey={n => n.row_id} layout="table"
          empty={{ title: 'No numbers', body: m.state === 'empty' ? `${m.label} has no Run yet, so no number can be entered.` : status === 'All' ? `No number was entered for ${m.label}.` : 'No number has this status.' }} /></div>
      </Card>
      <Card title="How Numbers Combine">
        <ol className="flex list-decimal flex-col gap-2 px-9 pb-4 text-sm">
          <li><b>Write beside, never over.</b> The engine's figures are read-only. Every number is a new row with a name and a reason.</li>
          <li><b>Any person, any scope, four kinds of change:</b> set a total, change by a percent, a closure or event, or change the weights.</li>
          <li><b>Apply or keep as reference.</b> Applying goes to your manager, who can approve, send it up, or say no with a note; the Chief Executive's applies at once. A reference number changes nothing and is still graded.</li>
          <li><b>One applied number per scope.</b> When several wait, the approver picks one and the others stay as reference.</li>
          <li><b>The most specific applied number wins,</b> and a total set higher up is spread across the cells below by the engine's own shape.</li>
          <li><b>A weight change recomputes that subcategory alone,</b> from each basis's stored value; nothing re-runs.</li>
          <li><b>Every number is graded</b> against what sold, at its own scope, from the day it was entered.</li>
        </ol>
      </Card>
    </Page>
  )
}

export function RunsPage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month
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
  // A target is the official Run; a proposed one adds the numbers applied in its month since.
  const official = SUBS.reduce((n, s) => n + finalWeeks(s, m, ALL_WEEKS), 0)
  const applied = ctx.data.numbers.filter(n => n.month === m.key && n.status === 'Applied').reduce((t, n) => t + n.value - engineOf(n), 0)
  const runs = RUNS.filter(r => r.month === runMonth(m))
  const targets = TARGETS.filter(t => t.month === runMonth(m)).map(t => ({ ...t, total: t.loaded === 'next build' ? official + applied : official }))
  const tCols: DataColumn<TargetVersion & { total: number }>[] = [
    { key: 'month', header: 'Month', phone: 'title', cell: t => <span className="font-medium">{t.month}</span> },
    { key: 'rev', header: 'Version', phone: 'status', cell: t => <StatusPill tone={t.loaded === 'next build' ? 'caution' : t.revision === 5 ? 'positive' : 'neutral'}>{`revision ${t.revision}${t.loaded === 'next build' ? ' · proposed' : t.revision === 5 ? ' · current' : ''}`}</StatusPill> },
    { key: 'run', header: 'From Run', phone: 'meta', cell: t => <code className="text-[13px]">{t.fromRun}</code> },
    { key: 'loaded', header: 'Loaded', phone: 'meta', cell: t => t.loaded },
    { key: 'total', header: 'Total, Both Stores', align: 'end', phone: 'value', cell: t => fmtINR(t.total) },
    { key: 'note', header: 'What Changed', phone: 'hidden', cell: t => <span className="text-sm text-ink-muted">{t.note}</span> },
  ]
  const current = MONTHS.find(x => x.state === 'current')
  if (m.state === 'empty') return <Page title="Runs & Targets"><NoRunYet month={m} what="Its target versions follow from it." /></Page>
  return (
    <Page title="Runs & Targets">
      <Card title={`Engine Runs, ${m.label}`}><div className="px-4 pb-4"><DataList caption="Engine Runs" rows={runs} columns={runCols} rowKey={r => r.id} layout="table" empty={{ title: 'No Runs', body: 'The engine has not written a Run yet.' }} /></div></Card>
      <Card title={`Target Versions, ${m.label}`}>
        <div className="flex flex-col gap-2 px-4 pb-4">
          <p className="text-sm text-ink-muted">The final forecast is the target. Each version is the official Run with the numbers applied when it was built; reports read the highest version.</p>
          {current && m.key !== current.key && <p className="text-sm text-ink-muted">{m.label} is closed: its last version is the target it was measured against.</p>}
          <DataList caption="Target versions" rows={targets} columns={tCols} rowKey={t => `${t.month}-${t.revision}`} layout="table" empty={{ title: 'No targets', body: 'No target has been built yet.' }} />
        </div>
      </Card>
    </Page>
  )
}

interface Graded { n: NumberRow; engine: number; actual: number; off: number; engineOff: number; closer: number }
export function ResultsPage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month
  const graded: Graded[] = ctx.data.numbers.filter(n => n.month === m.key && m.state === 'closed').map(n => {
    const sc = { store: n.store, level: n.scope_level, name: n.scope_name }
    const engine = engineFor({ ...sc, weeks: parseWeeks(n.weeks) }, m.key), actual = actualFor(sc, m.key)
    const off = Math.abs(n.value - actual), engineOff = Math.abs(engine - actual)
    return { n, engine, actual, off, engineOff, closer: engineOff - off }
  }).sort((a, b) => b.closer - a.closer)
  const scopes = [...new Map(graded.map(g => [`${g.n.store}|${g.n.scope_name}`, g])).values()]
  const people = [...new Set(graded.map(g => g.n.entered_by))].map(name => {
    const mine = graded.filter(g => g.n.entered_by === name)
    return { name, count: mine.length, beat: mine.filter(g => g.closer > 0).length, closer: mine.reduce((t, g) => t + g.closer, 0), err: mine.reduce((t, g) => t + g.off, 0) / mine.reduce((t, g) => t + g.actual, 0) }
  }).sort((a, b) => b.closer - a.closer)
  const beat = graded.filter(g => g.closer > 0).length
  const lastClosed = [...MONTHS].reverse().find(x => x.state === 'closed')
  if (m.state === 'empty') return <Page title="Results"><NoRunYet month={m} what="Its numbers are graded once the month is over." /></Page>
  if (m.state === 'current' || !graded.length) return (
    <Page title="Results">
      <Card><EmptyState title={m.state === 'current' ? `${m.label} is still open` : `No numbers were entered for ${m.label}`}
        body={m.state === 'current' ? 'Every number is graded against what sold once its month closes. Sales so far, against the engine, are on Charts.' : 'Its Run was used as the engine wrote it; how the Run did is on Charts.'}
        action={<div className="flex flex-wrap justify-center gap-2">
          <a className={buttonClasses({ variant: 'secondary' })} href={address('charts')}>Open Charts</a>
          {m.state === 'current' && lastClosed && <a className={buttonClasses({ variant: 'secondary' })} href={address('results', { month: lastClosed.key })} data-testid="last-closed">See {lastClosed.label}</a>}
        </div>} /></Card>
    </Page>
  )
  const cols: DataColumn<Graded>[] = [
    { key: 'for', header: 'Scope', phone: 'title', cell: g => <span className="whitespace-nowrap font-medium">{g.n.scope_name} · {g.n.store}</span> },
    { key: 'by', header: 'Number By', phone: 'meta', cell: g => <div className="w-52"><Who name={g.n.entered_by} /></div> },
    { key: 'status', header: 'Was', phone: 'hidden', cell: g => <StatusPill tone={STATUS_TONE[g.n.status]}>{g.n.status}</StatusPill> },
    { key: 'value', header: 'Their Number', align: 'end', phone: 'meta', cell: g => fmtINR(g.n.value) },
    { key: 'engine', header: 'Engine', align: 'end', phone: 'meta', cell: g => fmtINR(g.engine) },
    { key: 'actual', header: 'Sold', align: 'end', phone: 'meta', cell: g => <span className="font-medium">{fmtINR(g.actual)}</span> },
    { key: 'closer', header: 'Closer Than The Engine By', align: 'end', phone: 'value', cell: g => <StatusPill tone={g.closer > 0 ? 'positive' : 'negative'}>{g.closer > 0 ? `+${fmtINR(g.closer)}` : `−${fmtINR(-g.closer)}`}</StatusPill> },
  ]
  return (
    <Page title="Results">
      <Headline label={`${m.label} · every number graded against what sold`} tone={beat * 2 >= graded.length ? 'positive' : 'caution'}
        conclusion={`${beat} of ${graded.length} numbers were closer than the engine`}
        detail="Applied and reference numbers are both graded, at their own scope, from the day each was entered." />
      <Card title="Views Against Actual Sales">
        <div className="flex flex-col gap-5 px-4 pb-4">
          {scopes.map(sg => <ViewsBars key={`${sg.n.store}${sg.n.scope_name}`} g={graded.filter(x => x.n.store === sg.n.store && x.n.scope_name === sg.n.scope_name)} />)}
        </div>
      </Card>
      <Card title="Forecaster Scorecard">
        <div className="px-4 pb-4">
          <DataList caption="Scorecard" rows={people} rowKey={p => p.name} layout="table" empty={{ title: 'No graded numbers', body: 'Numbers are graded once their month is over.' }} columns={[
            { key: 'who', header: 'Person', phone: 'title', cell: p => <div className="w-56"><Who name={p.name} /></div> },
            { key: 'count', header: 'Numbers', align: 'end', phone: 'meta', cell: p => p.count },
            { key: 'err', header: 'Error', align: 'end', phone: 'meta', cell: p => `${(p.err * 100).toFixed(1)}%` },
            { key: 'beat', header: 'Beat The Engine', align: 'end', phone: 'meta', cell: p => `${p.beat} of ${p.count}` },
            { key: 'closer', header: '₹ Closer In Total', align: 'end', phone: 'value', cell: p => <StatusPill tone={p.closer > 0 ? 'positive' : 'negative'}>{p.closer > 0 ? `+${fmtINR(p.closer)}` : `−${fmtINR(-p.closer)}`}</StatusPill> },
          ]} />
        </div>
      </Card>
      <Card title="Every Graded Number"><div className="px-4 pb-4"><DataList caption="Graded numbers" rows={graded} columns={cols} rowKey={g => g.n.row_id} layout="table" empty={{ title: 'Nothing graded', body: `${m.name} has no numbers.` }} /></div></Card>
    </Page>
  )
}

/** One scope's numbers as bars, with a tick at what sold: who was closest is plain to see. */
function ViewsBars({ g }: { g: Graded[] }) {
  const { actual, engine } = g[0]
  const rows = [{ who: 'Engine', kind: 'Model', v: engine }, ...g.map(x => ({ who: x.n.entered_by, kind: x.n.status, v: x.n.value }))]
  const max = Math.max(actual, ...rows.map(r => r.v)) * 1.08
  const best = rows.reduce((a, b) => (Math.abs(b.v - actual) < Math.abs(a.v - actual) ? b : a))
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold">{g[0].n.scope_name} · {g[0].n.store} <span className="text-sm font-normal text-ink-muted">· sold {fmtINR(actual)}</span></h3>
      {rows.map(r => (
        <div key={r.who + r.kind} className="grid grid-cols-[9rem_7rem_minmax(0,1fr)_5rem] items-center gap-3 text-sm">
          <span className="truncate">{r.who}{r === best && <span className="ml-1.5 rounded-full bg-ink px-1.5 text-[11px] text-surface">closest</span>}</span>
          <StatusPill tone={r.kind === 'Model' ? 'neutral' : STATUS_TONE[r.kind]}>{r.kind}</StatusPill>
          <span className="relative h-5 rounded-control bg-fill">
            <span className={`absolute inset-y-0 left-0 rounded-control ${r.kind === 'Applied' ? 'bg-positive' : r.kind === 'Model' ? 'bg-ink-muted' : 'bg-opportunity'}`} style={{ width: `${(r.v / max) * 100}%` }} />
            <span className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${(actual / max) * 100}%` }} aria-label="What sold" />
          </span>
          <span className="text-end tabular-nums">{signed(Math.round((r.v / actual - 1) * 100))}</span>
        </div>
      ))}
    </section>
  )
}

const OUTCOME_TONE: Record<string, StatusTone> = { Open: 'caution', 'Being worked on': 'opportunity', 'Forecast changed': 'positive', 'No change': 'neutral', 'Waiting on the asker': 'caution', Parked: 'missing' }
export function ReviewPage({ ctx }: { ctx: Ctx }) {
  const m = ctx.month
  const all = ctx.data.questions.filter(x => x.month === m.key).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  const [filter, setFilter] = useState('All')
  const [selRef, setSel] = useState(all[0]?.ref)
  const [asking, setAsking] = useState(false)
  const [q, setQ] = useState({ scope: '', question: '', detail: '' })
  const shown = all.filter(x => filter === 'All' || x.outcome === filter)
  const sel = all.find(x => x.ref === selRef) ?? shown[0]
  const counts = Object.keys(OUTCOME_TONE).map(o => [o, all.filter(x => x.outcome === o).length] as const).filter(([, n]) => n)
  const ask = async () => {
    const ref = `Q${ctx.data.questions.length + 1}`
    await ctx.save('forecasting.review_question', { ref, month: m.key, ...q, asked_by: ctx.viewer.name, asked_on: new Date().toISOString().slice(0, 10), outcome: 'Open' })
    setQ({ scope: '', question: '', detail: '' }); setAsking(false); setSel(ref); await ctx.reload()
  }
  return (
    <Page title="Review" actions={<Button variant="primary" onClick={() => setAsking(!asking)}>Ask a question</Button>}>
      <p className="-mt-2 text-sm text-ink-muted">Each question on a month's forecast is one record: who asked, about what, the answer, and what happened to the forecast. {all.length ? `${m.label}, filled from the month's questions, so the next month's do not go back into email.` : `${m.label}: no question has been asked on its forecast yet.`}</p>
      {asking && (
        <Card><div className="grid gap-2 p-4 md:grid-cols-2">
          <Field label="About (store, category, the whole month…)"><TextInput value={q.scope} onChange={e => setQ({ ...q, scope: e.target.value })} /></Field>
          <Field label="Question"><TextInput value={q.question} onChange={e => setQ({ ...q, question: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="What you saw"><textarea rows={2} value={q.detail} onChange={e => setQ({ ...q, detail: e.target.value })} className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" /></Field></div>
          <div><Button variant="primary" disabled={!q.question.trim()} onClick={() => void ask()}>Ask</Button></div>
        </div></Card>
      )}
      {!all.length ? <Card><EmptyState title={`No questions on ${m.label}`} body="Ask one with the button above; it is kept against this month." /></Card> : <Card>
        <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="group" aria-label="Filter by outcome">
          {[['All', all.length] as const, ...counts].map(([o, n]) => (
            <button key={o} type="button" aria-pressed={filter === o} onClick={() => setFilter(o)}
              className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${filter === o ? 'bg-ink text-surface' : 'bg-subtle text-ink-muted'}`}>{o} · {n}</button>))}
        </div>
        <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="flex flex-col" data-testid="questions">
            {shown.map(x => (
              <button key={x.row_id} type="button" onClick={() => setSel(x.ref)} aria-current={sel?.ref === x.ref}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border px-4 py-2.5 text-start hover:bg-subtle ${sel?.ref === x.ref ? 'bg-action-tint' : ''}`}>
                <span className="text-sm font-semibold">{x.question}</span><StatusPill tone={OUTCOME_TONE[x.outcome] ?? 'neutral'}>{x.outcome}</StatusPill>
                <span className="col-span-2 text-[13px] text-ink-muted">{x.ref} · {x.scope} · asked {when(x.asked_on)}</span>
              </button>))}
          </div>
          {sel && <Question key={sel.row_id} ctx={ctx} x={sel} />}
        </div>
      </Card>}
    </Page>
  )
}

function Question({ ctx, x }: { ctx: Ctx; x: QuestionRow }) {
  const [answer, setAnswer] = useState('')
  const [outcome, setOutcome] = useState('No change')
  const save = async () => { await ctx.save('forecasting.review_question', { ...x, answer, answered_by: ctx.viewer.name, answered_on: new Date().toISOString().slice(0, 10), outcome }); await ctx.reload() }
  return (
    <div className="flex min-w-0 flex-col gap-4 bg-canvas p-5" data-testid="question-pane">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{x.question}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted"><span>{x.ref}</span><span>About <b className="text-ink">{x.scope}</b></span><span>Asked {when(x.asked_on)}</span></div>
      </div>
      <div className="flex flex-col gap-1.5 rounded-card bg-surface p-3"><div className="w-64"><Who name={x.asked_by} /></div>{x.detail && <p className="text-sm">{x.detail}</p>}</div>
      {x.answer ? (
        <div className="flex flex-col gap-1.5 rounded-card bg-surface p-3 shadow-[inset_3px_0_0_var(--color-positive)]">
          <div className="flex items-start justify-between gap-2"><div className="w-64"><Who name={x.answered_by ?? ''} /></div>{x.answered_on && <span className="text-[13px] text-ink-muted">{when(x.answered_on)}</span>}</div>
          <p className="text-sm">{x.answer}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-card bg-surface p-3">
          <textarea rows={3} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Answer" className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" />
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56"><Field label="Outcome"><Select value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.keys(OUTCOME_TONE).filter(o => o !== 'Open').map(o => <option key={o}>{o}</option>)}</Select></Field></div>
            <Button variant="primary" disabled={!answer.trim()} onClick={() => void save()}>Answer</Button>
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-card bg-surface p-3"><div className="text-[12px] font-semibold text-ink-muted">Outcome</div><StatusPill tone={OUTCOME_TONE[x.outcome] ?? 'neutral'}>{x.outcome}</StatusPill></div>
        <div className="rounded-card bg-surface p-3"><div className="text-[12px] font-semibold text-ink-muted">Effect on the forecast</div><p className="text-sm">{x.impact || '—'}</p></div>
        <div className="rounded-card bg-surface p-3"><div className="text-[12px] font-semibold text-ink-muted">Follow-up</div><p className="text-sm">{x.follow_up || '—'}</p></div>
        <div className="rounded-card bg-surface p-3"><div className="text-[12px] font-semibold text-ink-muted">Idea</div>
          {x.idea_ref ? <a className="text-sm font-semibold" href={address('ideas', { q: x.idea_ref })}>{x.idea_ref} in the Idea Register</a> : <p className="text-sm">—</p>}</div>
      </div>
    </div>
  )
}

const VERDICT_TONE: Record<string, StatusTone> = { Waiting: 'caution', Kept: 'positive', Rejected: 'negative', 'Already in the model': 'neutral', 'Not tested': 'missing' }
export function IdeasPage({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(new URLSearchParams(window.location.search).get('q') ?? '')
  const [verdict, setVerdict] = useState(''), [kind, setKind] = useState(''), [area, setArea] = useState('')
  const [adding, setAdding] = useState(false)
  const [idea, setIdea] = useState({ title: '', why: '' })
  const ideas = ctx.data.ideas
  const areas = useMemo(() => {
    const c = new Map<string, number>(); ideas.forEach(i => i.areas.split(', ').filter(Boolean).forEach(a => c.set(a, (c.get(a) ?? 0) + 1)))
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
  }, [ideas])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = ideas.filter(i => (!verdict || i.verdict === verdict) && (!kind || i.kind === kind) && (!area || i.areas.split(', ').includes(area))
    && words.every(w => [i.ref, i.label, i.title, i.why, i.tried, i.found, i.status_note, i.areas].join(' ').toLowerCase().includes(w)))
  const add = async () => {
    await ctx.save('forecasting.idea', { ref: `ID-${ideas.length + 1}`, label: '', title: idea.title, why: idea.why, kind: 'Business suggestion', raised_by: ctx.viewer.name, raised_on: new Date().toISOString().slice(0, 10), verdict: 'Not tested', areas: '' })
    setIdea({ title: '', why: '' }); setAdding(false); await ctx.reload()
  }
  return (
    <Page title="Idea Register" actions={<Button variant="primary" onClick={() => setAdding(!adding)}>Add an idea</Button>}>
      <p className="-mt-2 text-sm text-ink-muted">Every idea for improving the forecast, wherever it came from (a business suggestion, an engine trial, a model comparison, a month check), with why it came up, what was tried, what was found, and why it was kept or dropped. Search here before testing anything.</p>
      <div className="flex flex-wrap gap-2">
        {Object.keys(VERDICT_TONE).map(v => (
          <button key={v} type="button" aria-pressed={verdict === v} onClick={() => setVerdict(verdict === v ? '' : v)}
            className={`min-w-32 rounded-card p-3 text-start shadow-raised ${verdict === v ? 'bg-ink text-surface' : 'bg-surface'}`}>
            <b className="block text-2xl tabular-nums">{ideas.filter(i => i.verdict === v).length}</b><span className="text-[13px]">{v}</span>
          </button>))}
      </div>
      {adding && (
        <Card><div className="grid gap-2 p-4 md:grid-cols-2">
          <Field label="Idea"><TextInput value={idea.title} onChange={e => setIdea({ ...idea, title: e.target.value })} /></Field>
          <Field label="Why it came up"><TextInput value={idea.why} onChange={e => setIdea({ ...idea, why: e.target.value })} /></Field>
          <div><Button variant="primary" disabled={!idea.title.trim()} onClick={() => void add()}>Add</Button></div>
        </div></Card>
      )}
      <Card>
        <div className="flex flex-col gap-2.5 bg-subtle p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-72 flex-1"><Field label="Search ideas, reasons and results"><SearchInput value={q} placeholder="Try: weekday, festival, onion, weights, food court" onChange={e => setQ(e.target.value)} data-testid="idea-search" /></Field></div>
            <div className="w-48"><Field label="Verdict"><Select value={verdict} onChange={e => setVerdict(e.target.value)}><option value="">Every verdict</option>{Object.keys(VERDICT_TONE).map(v => <option key={v}>{v}</option>)}</Select></Field></div>
            <div className="w-52"><Field label="Came from"><Select value={kind} onChange={e => setKind(e.target.value)}><option value="">Every source</option>{['Engine trial', 'Business suggestion', 'Model comparison', 'Month check'].map(v => <option key={v}>{v}</option>)}</Select></Field></div>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Areas">
            {areas.map(a => <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(area === a ? '' : a)}
              className={`rounded-full px-2.5 py-1 text-[13px] ${area === a ? 'bg-ink text-surface' : 'bg-surface text-ink-muted'}`}>{a}</button>)}
          </div>
        </div>
        <p className="px-4 py-2.5 text-[13px] text-ink-muted">{shown.length} of {ideas.length} ideas</p>
        <div className="flex flex-col" data-testid="ideas">
          {shown.map(i => <Idea key={i.row_id} i={i} open={words.length > 0 && shown.length <= 3} onArea={setArea} />)}
        </div>
      </Card>
    </Page>
  )
}

function Idea({ i, open, onArea }: { i: IdeaRow; open: boolean; onArea: (a: string) => void }) {
  const F = ({ k, v, wide }: { k: string; v?: string | null; wide?: boolean }) => (v ? <div className={wide ? 'md:col-span-2' : ''}><div className="text-[11.5px] font-semibold tracking-wide text-ink-muted uppercase">{k}</div><p className="text-sm whitespace-pre-line">{v}</p></div> : null)
  return (
    <details className="border-t border-border" open={open}>
      <summary className="grid cursor-pointer list-none gap-x-4 gap-y-1 px-4 py-3 hover:bg-subtle md:grid-cols-[8rem_minmax(0,1fr)_10rem]">
        <span><StatusPill tone={VERDICT_TONE[i.verdict] ?? 'neutral'}>{i.verdict}</StatusPill></span>
        <span><span className="font-semibold">{i.title}</span><span className="block text-[13px] text-ink-muted">{i.outcome}</span></span>
        <span className="text-[13px] text-ink-muted md:text-end">{i.kind}{i.label ? ` · ${i.label}` : ''}<br />{i.raised_on && when(i.raised_on)}</span>
      </summary>
      <div className="grid gap-x-6 gap-y-3.5 px-4 pt-1 pb-4 md:grid-cols-2">
        <F k="Why it came up" v={i.why} /><F k="Raised by" v={i.raised_by} />
        <F k="What we tried" v={i.tried} wide /><F k="What we found" v={i.found} wide />
        <F k="Where it stands" v={i.status_note} /><F k="Look again when" v={i.revisit} />
        <F k="Evidence" v={i.evidence} />
        {i.areas && <div><div className="text-[11.5px] font-semibold tracking-wide text-ink-muted uppercase">Areas</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{i.areas.split(', ').map(a => <button key={a} type="button" onClick={() => onArea(a)} className="rounded-control bg-subtle px-2 py-0.5 text-[13px]">{a}</button>)}</div></div>}
      </div>
    </details>
  )
}
