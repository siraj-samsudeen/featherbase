/// <reference types="vite/client" />
import { createElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { Button, DataList, EmptyState, Notice, PageHeader, RecordLink, StatusPill, buttonClasses, cardClasses, fmtINR, fmtInstantIST, fmtPct, inputClasses, labelClasses, panelClasses, tagClasses, type DataColumn } from '@featherbase/shop-floor'
import { act, catalog as appCatalog, read, readApp, type Asked, type Group, type Limit, type Log, type Model, type Reply, type Said, type Session, type Thought } from './api'
import { facts, figures, throughLine, type Figures, type Line } from './answer'
import './style.css'

const params = new URLSearchParams(window.location.search)
/** Opened beside another page (the Ask button on a report, or the top bar): no sidebar, and it knows which report it sits next to. */
const PANEL = params.get('panel') === '1'
const FOCUS = params.get('report') ?? undefined
const FOCUS_STORE = params.get('store') ?? undefined

interface Catalog { reports: { key: string; name: string }[]; stores: { value: string; label: string }[]; areas: { name: string; title: string; href: string; summary?: string }[]; focus?: string }
interface Turn { id: number; question: string; state: 'thinking' | 'done' | 'refused'; reply?: Reply; figures?: Figures; error?: string; model?: string; cost?: number; took?: number; note?: string }

const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
const KIND: Record<string, string> = { data: 'Figures', help: 'How-To', suggest: 'Pointed To A Report', cannot: 'Not Possible', failed: 'AI Failed' }
const Icon = ({ d }: { d: string }) => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const ICONS = { ask: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12', mine: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', usage: 'M4 20V10M10 20V4M16 20v-7M22 20H2', limits: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z', models: 'M12 2v4M12 18v4M2 12h4M18 12h4M7 7l10 10M17 7 7 17' }

/** A report or an area this person may open, as a link. Blue because it opens something. */
function Pointers({ reply, catalog }: { reply: Reply; catalog: Catalog }) {
  const reports = reply.reports.map(key => catalog.reports.find(r => r.key === key)).filter(r => !!r)
  const areas = reply.areas.map(name => catalog.areas.find(a => a.name === name)).filter(a => !!a && a.name !== 'ask')
  if (!reports.length && !areas.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-subtle">Look here:</span>
      {reports.map(r => <RecordLink key={r!.key} table="dash.report" rowId={r!.key} name={r!.name} href={`/dash/?report=${encodeURIComponent(r!.key)}`} onNavigate={go} />)}
      {areas.map(a => <a key={a!.name} href={a!.href} onClick={e => { e.preventDefault(); go(a!.href) }} className="text-action hover:underline">{a!.title}</a>)}
    </div>
  )
}
/** In the side panel, a link opens in the page beside it, not inside the panel. */
const go = (href: string) => { (PANEL ? window.top ?? window : window).location.assign(href) }

const LINE_COLUMNS = (label: string, withStore: boolean): DataColumn<Line>[] => [
  { key: 'name', header: label, cell: l => l.name, phone: 'title' },
  ...(withStore ? [{ key: 'store', header: 'Store', cell: (l: Line) => l.store ?? '', phone: 'meta' as const }] : []),
  { key: 'target', header: 'Target', cell: l => fmtINR(l.target), align: 'end', phone: 'value' },
  { key: 'actual', header: 'Sales', cell: l => fmtINR(l.actual), align: 'end', phone: 'value' },
  { key: 'gap', header: 'Gap', cell: l => <span className={(l.gap ?? 0) < 0 ? 'text-negative' : undefined}>{fmtINR(l.gap, { signed: true })}</span>, align: 'end', phone: 'value' },
  { key: 'achieved', header: 'Achieved', cell: l => fmtPct(l.achieved), align: 'end', phone: 'value' },
]

function Answer({ turn, catalog, admin }: { turn: Turn; catalog: Catalog; admin: boolean }) {
  const f = turn.figures
  return (
    <article className="flex flex-col gap-3" data-testid="ask-turn">
      <h2 className="text-[15px] font-semibold text-ink">{turn.question}</h2>
      {turn.state === 'thinking' && <p className="text-sm text-ink-muted" role="status">Working it out…</p>}
      {turn.state === 'refused' && <Notice tone="caution">{turn.error}</Notice>}
      {turn.state === 'done' && turn.reply && (
        <div className={cardClasses('flex flex-col gap-3 p-4')}>
          {turn.error ? <Notice tone="caution">{turn.error}</Notice> : <p className="text-[15px] leading-relaxed text-ink" data-testid="ask-sentence">{f?.sentence ?? turn.reply.say}</p>}
          {f && f.lines.length > 0 && (
            <div className="rounded-control bg-surface">
              {turn.reply.plan?.group_by === 'none' && f.label === 'Subcategory' && <p className="px-3 pt-2 text-[13px] text-ink-subtle">Furthest Behind</p>}
              <DataList caption="The figures behind the answer" rows={f.lines} rowKey={l => l.key} layout="table" columns={LINE_COLUMNS(f.label, f.lines.some(l => l.store) && new Set(f.lines.map(l => l.store)).size > 1).filter(c => !PANEL || !['target', 'actual', 'store'].includes(c.key))}
                empty={{ title: 'Nothing To Show', body: 'No rows match.' }} />
            </div>
          )}
          {f && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-ink-subtle">
              <span data-testid="ask-covers">{throughLine(f)}{f.more > 0 && ` · ${f.more} more in the report`}</span>
              <a href={f.href} onClick={e => { e.preventDefault(); go(f.href) }} className={buttonClasses({ variant: 'quiet' })}>Open {catalog.reports.find(r => r.key === 'sales')?.name ?? 'The Report'}, Filtered</a>
            </div>
          )}
          {f?.notes.map(note => <p key={note} className="text-[13px] text-ink-subtle">{note}</p>)}
          <Pointers reply={f ? { ...turn.reply, reports: turn.reply.reports.filter(k => k !== 'sales') } : turn.reply} catalog={catalog} />
        </div>
      )}
      {admin && turn.state === 'done' && <p className="text-xs text-ink-subtle">Admin only: {KIND[turn.reply?.kind ?? ''] ?? turn.reply?.kind} · {turn.model} · {usd(turn.cost ?? 0)} · {((turn.took ?? 0) / 1000).toFixed(1)}s{turn.note && ` · ${turn.note}`}</p>}
    </article>
  )
}

const STARTERS = ['Did I meet my target this month?', 'Which subcategories are furthest behind?', 'What does Gap mean?', 'How do I report a wrong figure?', 'What reports can I open?']

/** An earlier chat's rows, oldest first, as turns: the words as they were said, the figures read again now. */
function restore(rows: Asked[], catalog: Catalog): Turn[] {
  return rows.map((row, i) => {
    const named = row.pointed_to.split(',').map(n => n.trim()).filter(Boolean)
    let plan: Reply['plan']
    try { plan = row.plan ? JSON.parse(row.plan) : undefined } catch { plan = undefined }
    const kind = (['data', 'help', 'suggest', 'cannot'] as const).find(k => k === row.kind) ?? 'suggest'
    return { id: i + 1, question: row.question, state: kind === 'data' && plan ? 'thinking' : 'done', model: row.model, cost: 0, took: 0,
      reply: { kind, say: row.reply, plan, reports: named.filter(n => catalog.reports.some(r => r.key === n)), areas: named.filter(n => catalog.areas.some(a => a.name === n)) } }
  })
}

function AskView({ session, catalog, refresh, chat, earlier, fresh }: { session: Session; catalog: Catalog; refresh: () => void; chat: string; earlier: Asked[]; fresh: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => restore(earlier, catalog))
  // A reopened chat reads its figures again, as this person, under what they may see today. No AI call, no cost.
  useEffect(() => {
    for (const turn of restore(earlier, catalog)) {
      if (turn.state !== 'thinking' || !turn.reply?.plan) continue
      figures(turn.reply.plan, catalog.stores).then(shown => ({ figures: shown }), e => ({ error: e instanceof Error ? e.message : 'The figures could not be read.' }))
        .then(change => setTurns(list => list.map(t => (t.id === turn.id ? { ...t, ...change, state: 'done' } : t))))
    }
  }, [])
  const [text, setText] = useState('')
  const [model, setModel] = useState(session.model)
  const busy = turns.some(t => t.state === 'thinking')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [turns])

  const ask = async (question: string) => {
    if (!question.trim() || busy) return
    const id = Date.now()
    const patch = (change: Partial<Turn>) => setTurns(list => list.map(t => (t.id === id ? { ...t, ...change } : t)))
    setTurns(list => [...list, { id, question, state: 'thinking' }]); setText('')
    try {
      const thought = await read<Thought>('think', { question, model, chat, catalog: { reports: catalog.reports, stores: catalog.stores, areas: catalog.areas.map(({ name, title, summary }) => ({ name, title, summary })), focus: catalog.focus } })
      if (thought.refused || !thought.reply) { patch({ state: 'refused', error: thought.refused ?? 'That did not work. Try again.' }); return }
      let shown: Figures | undefined, error: string | undefined, receipt = thought.receipt, cost = thought.cost_usd, took = thought.took_ms
      if (thought.reply.kind === 'data' && thought.reply.plan) {
        const plan = FOCUS_STORE && thought.reply.plan.stores === 'all' && catalog.stores.some(s => s.value === FOCUS_STORE) ? { ...thought.reply.plan, stores: [FOCUS_STORE] } : thought.reply.plan
        try { shown = await figures(plan, catalog.stores) } catch (e) { error = e instanceof Error ? e.message : 'The figures could not be read.' }
        // The AI writes the answer from her own rows, just fetched. If it can't, Featherbase's own sentence stands.
        if (shown?.lines.length && receipt) {
          const said = await read<Said>('think', { mode: 'say', receipt, facts: facts(shown) }).catch(() => null)
          if (said) { receipt = said.receipt; if (said.say) { shown = { ...shown, sentence: said.say }; cost = said.cost_usd ?? cost; took = said.took_ms ?? took } }
        }
      }
      // The log is written from the receipt the server signed: both AI calls of a figures answer count as one question.
      if (receipt) void act('record', receipt).then(refresh, () => {})
      patch({ state: 'done', reply: thought.reply, figures: shown, error, model: thought.model, cost, took, note: thought.admin_note })
    } catch (e) { patch({ state: 'refused', error: e instanceof Error ? e.message : 'That did not work. Try again.' }) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(text) }
  const meter = session.meters.find(m => m.unit === 'questions' && m.period === 'day') ?? session.meters[0]
  const focused = catalog.reports.find(r => r.key === catalog.focus)

  const box = (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input id="ask-box" className={inputClasses('h-12 text-[15px]')} value={text} onChange={e => setText(e.target.value)} autoFocus autoComplete="off"
          placeholder={focused ? `Ask about ${focused.name}, or anything else` : 'Ask about your figures, your reports, or how to do something'} aria-label="Your question" disabled={!!session.refused} />
        <Button type="submit" variant="primary" loading={busy} disabled={!text.trim() || !!session.refused} className="h-12 px-5">Ask</Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-subtle">
        {meter && <span data-testid="ask-meter">{meter.unit === 'usd' ? `${usd(meter.used)} of ${usd(meter.of)}` : `${meter.used} of ${meter.of} questions`} used {meter.period === 'day' ? 'today' : `this ${meter.period}`}</span>}
        {session.models.length > 1 && (
          <label className="flex items-center gap-1.5">Model
            <select id="ask-model" className={inputClasses('h-7 min-h-0 w-auto py-0 text-[13px]')} value={model} onChange={e => setModel(e.target.value)}>{session.models.map(m => <option key={m}>{m}</option>)}</select>
          </label>
        )}
        {session.ai === 'built_in' && <span className={tagClasses()}>Built-In Rules, No AI Key Set</span>}
      </div>
    </form>
  )
  return (
    <div className={PANEL ? 'flex h-full flex-col gap-4 p-4' : 'mx-auto flex h-full w-full max-w-3xl flex-col gap-5'}>
      {!PANEL && <PageHeader title="Ask" status={focused ? <>You came from <RecordLink table="dash.report" rowId={focused.key} name={focused.name} href={`/dash/?report=${focused.key}`} />. Ask about it, or anything else.</> : 'One box for your figures, your reports and how Featherbase works.'} />}
      {PANEL && <h1 className="text-[15px] font-semibold text-ink">Ask{focused ? ` · ${focused.name}` : ''}</h1>}
      {!PANEL && turns.length > 0 && <div className="-mt-2"><Button variant="quiet" onClick={fresh}>Start A New Chat</Button></div>}
      {session.refused && <Notice tone="caution">{session.refused}</Notice>}
      {turns.length === 0 ? (
        <div className="flex flex-col gap-5">
          {box}
          <div className="flex flex-col gap-2">
            <h2 className="text-[13px] text-ink-subtle">Try One Of These</h2>
            <div className="flex flex-wrap gap-2">{STARTERS.map(s => <button key={s} type="button" onClick={() => void ask(s)} disabled={!!session.refused} className={buttonClasses({ className: 'h-auto min-h-8 py-1.5 text-[13px] font-normal' })}>{s}</button>)}</div>
          </div>
          {!PANEL && catalog.reports.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-[13px] text-ink-subtle">Reports You Can Open</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{catalog.reports.map(r => <RecordLink key={r.key} table="dash.report" rowId={r.key} name={r.name} href={`/dash/?report=${encodeURIComponent(r.key)}`} />)}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
            {turns.map(t => <Answer key={t.id} turn={t} catalog={catalog} admin={session.admin} />)}
            <div ref={end} />
          </div>
          <div className="sticky bottom-0 -mb-2 bg-surface pb-2 pt-3">{box}</div>
        </>
      )}
    </div>
  )
}

interface Chat { key: string; rows: Asked[] }
function History({ ask, open }: { ask: () => void; open: (chat: Chat) => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null)
  useEffect(() => {
    read<Asked[]>('history').then(rows => {
      // Newest first from the server; a chat lists its questions oldest first. A question from before chats stands alone.
      const byChat = new Map<string, Asked[]>()
      for (const row of rows) { const key = row.chat || row.row_id; byChat.set(key, [row, ...(byChat.get(key) ?? [])]) }
      setChats([...byChat].map(([key, list]) => ({ key, rows: list })))
    }, () => setChats([]))
  }, [])
  const last = (c: Chat) => c.rows[c.rows.length - 1]
  const columns: DataColumn<Chat>[] = [
    { key: 'q', header: 'Chat', phone: 'title', cell: c => (
      <div className="flex min-w-48 flex-col gap-0.5">
        <button type="button" onClick={() => open(c)} className="text-left font-medium text-action hover:underline" data-testid="open-chat">{c.rows[0].question}</button>
        {c.rows.length > 1 && <span className="text-[13px] text-ink-subtle">Then: {last(c).question}</span>}
      </div>) },
    { key: 'n', header: 'Questions', cell: c => c.rows.length, align: 'end', phone: 'value' },
    { key: 'kind', header: 'Kind', cell: c => <span className="flex flex-wrap gap-1">{[...new Set(c.rows.map(r => r.kind))].map(k => <span key={k} className={tagClasses()}>{KIND[k] ?? k}</span>)}</span>, phone: 'status' },
    { key: 'when', header: 'Last Asked', cell: c => <span className="whitespace-nowrap">{fmtInstantIST(last(c).asked_at)}</span>, phone: 'meta' },
  ]
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My Questions" count={chats ? `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}` : undefined} status="Every chat you had, from any page. Open one to carry on. Figures are never kept: an opened chat reads them fresh, under what you may see today."
        actions={<Button variant="primary" onClick={ask}>Ask A Question</Button>} />
      <DataList caption="My chats" rows={chats ?? []} state={chats ? 'ready' : 'loading'} rowKey={c => c.key} columns={columns} empty={{ title: 'No Questions Yet', body: 'What you ask shows here.' }} />
    </div>
  )
}

const Tile = ({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) => (
  <div className={cardClasses('flex flex-col gap-1 p-4')}>
    <span className="text-[13px] text-ink-subtle">{label}</span>
    <span className="text-xl font-semibold tabular-nums text-ink">{value}</span>
    {note && <span className="text-[13px] text-ink-muted">{note}</span>}
  </div>
)
const groupColumns = (first: string, cell: (g: Group) => ReactNode): DataColumn<Group>[] => [
  { key: 'key', header: first, cell, phone: 'title' },
  { key: 'n', header: 'Questions', cell: g => g.questions, align: 'end', phone: 'value' },
  { key: 'cost', header: 'Cost', cell: g => usd(g.cost_usd), align: 'end', phone: 'value' },
  { key: 'last', header: 'Last Asked', cell: g => <span className="whitespace-nowrap">{fmtInstantIST(g.last)}</span>, phone: 'meta' },
]
const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="flex flex-col gap-2"><h2 className="text-[15px] font-semibold text-ink">{title}</h2>{children}</section>
const Person = ({ id, name }: { id: string; name: string }) => <RecordLink table="Person" rowId={id} name={name} />

function Usage({ log, ai, provider }: { log: Log; ai: string; provider: string | null }) {
  const share = log.cap ? Math.min(100, (log.total.cost_usd / log.cap) * 100) : null
  const questions: DataColumn<Log['questions'][number]>[] = [
    { key: 'when', header: 'Asked', cell: r => <span className="whitespace-nowrap">{fmtInstantIST(r.asked_at)}</span>, phone: 'meta' },
    { key: 'who', header: 'Who', cell: r => <Person id={r.asked_by} name={r.name} />, phone: 'meta' },
    { key: 'q', header: 'Question', cell: r => <span className="font-medium text-ink">{r.question}</span>, phone: 'title' },
    { key: 'kind', header: 'Kind', cell: r => <span className={tagClasses()}>{KIND[r.kind] ?? r.kind}</span>, phone: 'status' },
    { key: 'to', header: 'Pointed To', cell: r => r.pointed_to, phone: 'meta' },
    { key: 'model', header: 'Model', cell: r => r.model, phone: 'meta' },
    { key: 'cost', header: 'Cost', cell: r => usd(Number(r.cost_usd ?? 0)), align: 'end', phone: 'value' },
    { key: 'took', header: 'Took', cell: r => `${(Number(r.took_ms ?? 0) / 1000).toFixed(1)}s`, align: 'end', phone: 'value' },
  ]
  const none = { title: 'Nothing Yet', body: 'It fills in as people ask.' }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usage" count={`This month · ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(log.month.slice(5)) - 1]}'${log.month.slice(2, 4)}`} status={ai === 'built_in' ? 'No AI key is set on this instance, so the built-in rules answer and nothing is spent.' : `Answers come from ${log.model} through ${provider}.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Questions This Month" value={log.total.questions} note={`${log.total.today} today`} />
        <Tile label="Spent This Month" value={usd(log.total.cost_usd)} note={log.cap ? `of ${usd(log.cap)} budget` : 'No budget set'} />
        <Tile label="People Asking" value={log.total.people} />
        <Tile label="Cost Per Question" value={usd(log.total.questions ? log.total.cost_usd / log.total.questions : 0)} note={`${usd(log.total.today_cost_usd)} spent today`} />
      </div>
      {share != null && <div className="h-2 overflow-hidden rounded-full bg-fill" role="img" aria-label={`${share.toFixed(0)}% of the monthly budget used`}><div className={share >= 90 ? 'h-full bg-negative' : 'h-full bg-action'} style={{ width: `${share}%` }} /></div>}
      <Section title="Who Asks"><DataList caption="Who asks" rows={log.by_person} rowKey={g => g.key} columns={groupColumns('Person', g => <Person id={g.key} name={g.name ?? g.key} />)} empty={none} /></Section>
      <Section title="Most Asked"><DataList caption="Most asked questions" rows={log.most_asked} rowKey={g => g.key} columns={groupColumns('Question', g => g.key)} empty={none} /></Section>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="By Kind"><DataList caption="By kind" rows={log.by_kind} rowKey={g => g.key} layout="table" columns={groupColumns('Kind', g => KIND[g.key] ?? g.key).slice(0, 2)} empty={none} /></Section>
        <Section title="By Model"><DataList caption="By model" rows={log.by_model} rowKey={g => g.key} layout="table" columns={groupColumns('Model', g => g.key).slice(0, 3)} empty={none} /></Section>
        <Section title="Where Ask Sent People"><DataList caption="Where Ask sent people" rows={log.pointed_to} rowKey={g => g.key} layout="table" columns={groupColumns('Report Or Area', g => g.key).slice(0, 2)} empty={none} /></Section>
      </div>
      <Section title="Every Question"><DataList caption="Every question" rows={log.questions} rowKey={r => r.row_id} columns={questions} empty={none} /></Section>
    </div>
  )
}

function Limits({ log, reload }: { log: Log; reload: () => void }) {
  const [error, setError] = useState('')
  const [form, setForm] = useState({ applies_to: 'everyone', who: '', model: '', period: 'day', max_questions: '', max_usd: '' })
  const [budget, setBudget] = useState({ model: log.model, allowed_models: log.allowed_models, monthly_cap_usd: log.cap == null ? '' : String(log.cap) })
  const run = (work: Promise<unknown>) => { setError(''); work.then(reload, e => setError(e instanceof Error ? e.message : 'That did not save.')) }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }))
  const columns: DataColumn<Limit>[] = [
    { key: 'who', header: 'Applies To', cell: l => (l.applies_to === 'everyone' ? 'Everyone' : l.applies_to === 'person' ? <Person id={l.who} name={l.who_name} /> : <>Role · {l.who}</>), phone: 'title' },
    { key: 'model', header: 'Model', cell: l => l.model || 'Any model', phone: 'meta' },
    { key: 'period', header: 'Per', cell: l => l.period[0].toUpperCase() + l.period.slice(1), phone: 'meta' },
    { key: 'q', header: 'Most Questions', cell: l => l.max_questions ?? '', align: 'end', phone: 'value' },
    { key: 'usd', header: 'Most Spend', cell: l => (l.max_usd == null ? '' : usd(Number(l.max_usd))), align: 'end', phone: 'value' },
    { key: 'x', header: '', cell: l => <Button variant="quiet" onClick={() => run(act('remove_limit', { row_id: l.row_id }))}>Remove</Button>, align: 'end', phone: 'value' },
  ]
  const field = (label: string, control: ReactNode) => <label className="flex min-w-0 flex-col"><span className={labelClasses()}>{label}</span>{control}</label>
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Limits And Budget" status="A limit is checked before the AI is called, so a refused question costs nothing. Where several apply to a person, the first one that is full stops them." />
      {error && <Notice tone="negative">{error}</Notice>}
      <Section title="Overall Budget And Models">
        <form className={cardClasses('grid items-end gap-3 p-4 md:grid-cols-[1fr_2fr_1fr_auto]')} onSubmit={e => { e.preventDefault(); run(act('configure', budget)) }}>
          {field('Model Everyone Starts On', <input id="cfg-model" className={inputClasses()} value={budget.model} onChange={e => setBudget(b => ({ ...b, model: e.target.value }))} />)}
          {field('Other Models People May Pick (comma separated)', <input id="cfg-allowed" className={inputClasses()} value={budget.allowed_models} onChange={e => setBudget(b => ({ ...b, allowed_models: e.target.value }))} />)}
          {field('Monthly Budget (USD)', <input id="cfg-cap" className={inputClasses()} inputMode="decimal" placeholder="No budget" value={budget.monthly_cap_usd} onChange={e => setBudget(b => ({ ...b, monthly_cap_usd: e.target.value }))} />)}
          <Button type="submit" variant="primary">Save</Button>
        </form>
      </Section>
      <Section title="Limits">
        <DataList caption="Limits" rows={log.limits} rowKey={l => l.row_id} columns={columns} empty={{ title: 'No Limits Set', body: 'Until you add one, each person may ask 50 questions a day.' }} />
        <form className={cardClasses('grid items-end gap-3 p-4 md:grid-cols-[1fr_1.4fr_1.4fr_0.8fr_0.8fr_0.8fr_auto]')} onSubmit={e => { e.preventDefault(); run(act('set_limit', form)) }}>
          {field('Applies To', <select id="lim-applies" className={inputClasses()} value={form.applies_to} onChange={e => setForm(f => ({ ...f, applies_to: e.target.value, who: '' }))}><option value="everyone">Everyone</option><option value="person">One Person</option><option value="role">A Role</option></select>)}
          {field(form.applies_to === 'role' ? 'Role' : 'Person', form.applies_to === 'person'
            ? <select id="lim-who" className={inputClasses()} value={form.who} onChange={set('who')}><option value="">Choose…</option>{log.by_person.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
            : <input id="lim-who" className={inputClasses()} value={form.who} onChange={set('who')} disabled={form.applies_to === 'everyone'} placeholder={form.applies_to === 'role' ? 'Dash Reader' : ''} />)}
          {field('Model', <select id="lim-model" className={inputClasses()} value={form.model} onChange={set('model')}><option value="">Any model</option>{[log.model, ...log.allowed_models.split(/[\s,]+/).filter(Boolean)].map(m => <option key={m}>{m}</option>)}</select>)}
          {field('Per', <select id="lim-period" className={inputClasses()} value={form.period} onChange={set('period')}><option value="hour">Hour</option><option value="day">Day</option><option value="month">Month</option></select>)}
          {field('Most Questions', <input id="lim-q" className={inputClasses()} inputMode="numeric" value={form.max_questions} onChange={set('max_questions')} />)}
          {field('Most Spend (USD)', <input id="lim-usd" className={inputClasses()} inputMode="decimal" value={form.max_usd} onChange={set('max_usd')} />)}
          <Button type="submit" variant="secondary">Add Limit</Button>
        </form>
      </Section>
    </div>
  )
}

function Models({ log, reload, session }: { log: Log; reload: () => void; session: Session }) {
  const [models, setModels] = useState<Model[] | null>(null)
  useEffect(() => { read<Model[]>('models', { provider: session.ai }).then(setModels, () => setModels([])) }, [])
  const allowed = log.allowed_models.split(/[\s,]+/).filter(Boolean)
  const save = (model: string, others: string[]) => act('configure', { model, allowed_models: others.filter(m => m !== model).join(', '), monthly_cap_usd: log.cap ?? '' }).then(reload, () => {})
  const price = (n: number) => `$${n.toFixed(2)}`
  const columns: DataColumn<Model>[] = [
    { key: 'name', header: 'Model', cell: m => <span className="font-medium text-ink">{m.name}</span>, phone: 'title' },
    { key: 'id', header: 'OpenRouter Id', cell: m => <code className="text-[12.5px]">{m.id}</code>, phone: 'meta' },
    { key: 'in', header: 'Per Million Words In', cell: m => price(m.in_per_million), align: 'end', phone: 'value' },
    { key: 'out', header: 'Per Million Words Out', cell: m => price(m.out_per_million), align: 'end', phone: 'value' },
    { key: 'use', header: '', align: 'end', phone: 'value', cell: m => m.id === log.model ? <StatusPill tone="positive">Everyone Starts Here</StatusPill> : (
      <span className="flex justify-end gap-2">
        {allowed.includes(m.id) ? <Button variant="quiet" onClick={() => void save(log.model, allowed.filter(a => a !== m.id))}>Stop Offering</Button> : <Button variant="quiet" onClick={() => void save(log.model, [...allowed, m.id])}>Offer</Button>}
        <Button onClick={() => void save(m.id, [...allowed, log.model])}>Make Default</Button>
      </span>) },
  ]
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Models" count={models ? `${models.length} from ${session.provider ?? 'OpenRouter'}` : undefined} status="GPT, Claude and GLM models, with the provider's live prices. Prices are per million tokens (roughly 750,000 words)." />
      <DataList caption="Models" rows={models ?? []} state={models ? 'ready' : 'loading'} rowKey={m => m.id} columns={columns} empty={{ title: 'Could Not Reach The Provider', body: 'The list comes live from the AI provider. You can still type a model id on Limits And Budget.' }} />
    </div>
  )
}

type View = 'ask' | 'mine' | 'usage' | 'limits' | 'models'
function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [log, setLog] = useState<Log | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>(() => (['mine', 'usage', 'limits', 'models'].includes(params.get('view') ?? '') ? params.get('view') as View : 'ask'))
  const [chat, setChat] = useState<{ id: string; earlier: Asked[] }>(() => ({ id: crypto.randomUUID(), earlier: [] }))
  const loadSession = useCallback(() => { read<Session>('session').then(setSession, e => setError(e instanceof Error ? e.message : 'Ask could not open.')) }, [])
  const loadLog = useCallback(() => { read<Log>('log', { fallback_model: session?.model }).then(setLog, () => {}); loadSession() }, [loadSession, session?.model])
  useEffect(() => {
    loadSession()
    // What this person may open, asked of each app as them: Dash's reports and stores, and the app switcher's list.
    void Promise.all([readApp<{ key: string; name: string }[]>('dash', 'reports').catch(() => []),
      readApp<{ value: string; label: string }[]>('dash', 'stores', { report: 'sales' }).catch(() => []), appCatalog()])
      .then(([reports, stores, areas]) => setCatalog({ reports: reports.map(({ key, name }) => ({ key, name })), stores, areas, focus: FOCUS }))
  }, [loadSession])
  useEffect(() => { if (session?.admin && view !== 'ask' && view !== 'mine') loadLog() }, [session?.admin, view, loadLog])

  const open = (next: View) => { setView(next); if (!PANEL) window.history.replaceState(null, '', next === 'ask' ? window.location.pathname : `?view=${next}`) }
  const NAV: [View, string, string, boolean][] = [['ask', 'Ask', ICONS.ask, true], ['mine', 'My Questions', ICONS.mine, true],
    ['usage', 'Usage', ICONS.usage, !!session?.admin], ['limits', 'Limits And Budget', ICONS.limits, !!session?.admin], ['models', 'Models', ICONS.models, !!session?.admin]]
  const body = error ? <Notice tone="negative">{error}</Notice>
    : !session || !catalog ? <p className="text-sm text-ink-muted" role="status">Opening Ask…</p>
    : view === 'ask' ? <AskView key={chat.id} session={session} catalog={catalog} refresh={loadSession} chat={chat.id} earlier={chat.earlier} fresh={() => setChat({ id: crypto.randomUUID(), earlier: [] })} />
    : view === 'mine' ? <History ask={() => { setChat({ id: crypto.randomUUID(), earlier: [] }); open('ask') }} open={c => { setChat({ id: c.rows[0].chat || crypto.randomUUID(), earlier: c.rows }); open('ask') }} />
    : !session.admin ? <EmptyState title="Admins Only" body="Usage, limits and models are for Ask Admins." />
    : !log ? <p className="text-sm text-ink-muted" role="status">Loading…</p>
    : view === 'usage' ? <Usage log={log} ai={session.ai} provider={session.provider} /> : view === 'limits' ? <Limits key={`${log.model}|${log.allowed_models}|${log.cap}`} log={log} reload={loadLog} /> : <Models log={log} reload={loadLog} session={session} />
  if (PANEL) document.documentElement.classList.add('ask-in-panel')
  if (PANEL) return <main className="h-screen overflow-hidden bg-surface" data-testid="ask-panel">{body}</main>
  return (
    <div className="ask-shell">
      {createElement('featherbase-sidebar', { 'aria-label': 'Ask' }, <>
        {NAV.filter(n => n[3]).map(([key, name, icon]) => <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => open(key)}><Icon d={icon} /><span>{name}</span></button>)}
      </>)}
      <main className="ask-page" data-testid="ask" data-view={view}><div className={panelClasses('ask-panel')}>{body}</div></main>
    </div>
  )
}

const painted = document.documentElement.getAttribute('data-featherbase-theme')
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, event => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})
createRoot(document.getElementById('root')!).render(<App />)
