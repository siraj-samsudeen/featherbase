// Forecasts: a store's section, subcategory by subcategory: the engine's figure, the applied one (the
// target), every number people put on it, and why. Several numbers can sit on one subcategory; one is
// Applied, the rest stay as Reference, and all are graded.
import { useState } from 'react'
import {
  Button, Card, DataList, DrillPane, Field, Headline, Notice, PaneSection, PersonLabel, Segmented, StatusPill, TextInput,
  fmtINR, iconButtonClasses, Pencil, type DataColumn, type StatusTone,
} from '@featherbase/shop-floor'
import { BASES, SUBS, UPLIFT, fromWeights, person, personByName, subKey, value, weightOf, type Code, type Person, type Sub } from './madeUp'
import { Page, type Ctx, type DecisionRow, type NumberRow } from './App'

const MONTH = '2026-11'
const pct = (a: number, b: number) => Math.round((a / b - 1) * 100)
export const STATUS_TONE: Record<string, StatusTone> = { Applied: 'positive', Waiting: 'caution', Reference: 'neutral', 'Not approved': 'negative' }
export const when = (s: string) => {
  const [d, t] = s.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${String(day).padStart(2, '0')}-${mon}-${y}${t ? ` ${t}` : ''}`
}

export function Who({ name, className = 'w-full' }: { name: string; className?: string }) {
  const p = personByName(name)
  return <PersonLabel rowId={p?.code ?? name} name={name} label={p ? { code: p.code, role: p.role, place: p.place } : undefined} canOpen={false} className={className} />
}

export const numbersOn = (ctx: Ctx, s: Sub, month = MONTH) =>
  ctx.data.numbers.filter(n => n.month === month && n.store === s.store && n.scope_name === s.name)
const appliedOf = (ctx: Ctx, s: Sub) => numbersOn(ctx, s).find(n => n.status === 'Applied')

type Mode = 'why' | 'numbers' | 'comments'

export function ForecastsPage({ ctx }: { ctx: Ctx }) {
  const params = new URLSearchParams(window.location.search)
  const home = ctx.viewer.place.includes('·') ? ctx.viewer.place.split(' · ') : null
  const [store, setStore] = useState(params.get('store') ?? (home && SUBS.some(s => s.store === home[0]) ? home[0] : 'Lakeside'))
  const sections = [...new Set(SUBS.filter(s => s.store === store).map(s => s.section))]
  const [sectionPick, setSection] = useState(params.get('section') ?? (home && sections.includes(home[1]) ? home[1] : sections[0]))
  const section = sections.includes(sectionPick) ? sectionPick : sections[0]
  const subs = SUBS.filter(s => s.store === store && s.section === section)
  const [pane, setPane] = useState<{ key: string; mode: Mode } | null>(() => {
    const sub = params.get('sub'); return sub ? { key: `${store}|${sub}`, mode: (params.get('pane') as Mode) ?? 'numbers' } : { key: subKey(subs[0]), mode: 'numbers' }
  })
  const open = pane ? subs.find(s => subKey(s) === pane.key) : undefined

  const applied = (s: Sub) => appliedOf(ctx, s)?.value ?? s.engine
  const total = subs.reduce((n, s) => n + applied(s), 0)
  const engine = subs.reduce((n, s) => n + s.engine, 0)
  const act = subs.reduce((n, s) => n + s.act20, 0)
  const fc = subs.reduce((n, s) => n + s.fc20, 0)
  const notesOn = (s: Sub) => ctx.data.decisions.filter(d => !d.number && d.month === MONTH && d.store === s.store && d.scope_name === s.name)

  const columns: DataColumn<Sub>[] = [
    { key: 'name', header: 'Subcategory', phone: 'title', cell: s => (
      <button type="button" onClick={() => setPane({ key: subKey(s), mode: 'numbers' })}
        className={`whitespace-nowrap text-start font-medium ${pane?.key === subKey(s) ? 'text-ink underline' : 'text-action hover:underline'}`}>{s.name}</button>) },
    { key: 'engine', header: 'Engine', align: 'end', phone: 'meta', cell: s => fmtINR(s.engine) },
    { key: 'applied', header: 'Applied (Target)', align: 'end', phone: 'value', cell: s => {
      const a = appliedOf(ctx, s)
      return a ? <span className="font-semibold">{fmtINR(a.value)}</span> : <span className="text-ink-muted">{fmtINR(s.engine)}</span>
    } },
    { key: 'numbers', header: 'Numbers', phone: 'status', cell: s => {
      const all = numbersOn(ctx, s); const waiting = all.filter(n => n.status === 'Waiting')
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {all.length ? <button type="button" className="text-sm text-action hover:underline" onClick={() => setPane({ key: subKey(s), mode: 'numbers' })}>{all.length + 1} numbers</button>
            : <span className="text-sm text-ink-muted">Engine only</span>}
          {waiting.length > 0 && <StatusPill tone="caution">{waiting.length} waiting</StatusPill>}
          {notesOn(s).some(d => d.decision === 'This is wrong') && <StatusPill tone="negative">Flagged wrong</StatusPill>}
        </span>)
    } },
    { key: 'act20', header: 'Sold To 20th', align: 'end', phone: 'meta', cell: s => fmtINR(s.act20) },
    { key: 'run', header: 'Running', align: 'end', phone: 'meta', cell: s => { const p = pct(s.act20, s.fc20); return <StatusPill tone={p >= 0 ? 'positive' : 'caution'}>{p >= 0 ? `+${p}% ahead` : `${-p}% behind`}</StatusPill> } },
    { key: 'act', header: '', phone: 'hidden', cell: s => (
      <span className="flex justify-end gap-1">
        <button type="button" aria-label={`Add a number for ${s.name}`} title="Add a number" className={iconButtonClasses()} onClick={() => setPane({ key: subKey(s), mode: 'numbers' })}><Pencil aria-hidden size={16} /></button>
        <button type="button" aria-label={`Comments on ${s.name}`} title="Comments" className={`${iconButtonClasses()} gap-0.5 text-[13px]`} onClick={() => setPane({ key: subKey(s), mode: 'comments' })}>💬{notesOn(s).length || ''}</button>
      </span>) },
  ]

  return (
    <Page title="Forecasts" actions={
      <div className="flex flex-wrap gap-2">
        <Segmented label="Store" value={store} onChange={v => { setStore(v); setPane(null) }} options={[...new Set(SUBS.map(s => s.store))].map(v => ({ value: v, label: v }))} />
        <Segmented label="Section" value={section} onChange={v => { setSection(v); setPane(null) }} options={sections.map(v => ({ value: v, label: v }))} />
      </div>}>
      <p className="-mt-2 text-sm text-ink-muted">November 2026 · engine Run of 30-Oct-2026 (demo_2026_11_official) · before tax</p>
      <Headline label={`November 2026 · ${store} · ${section}`}
        conclusion={`${fmtINR(act)} sold to 20-Nov, ${Math.abs(pct(act, fc))}% ${act >= fc ? 'ahead of' : 'behind'} the forecast`} tone={act >= fc ? 'positive' : 'caution'}
        detail={<>Applied for the month {fmtINR(total)} · engine {fmtINR(engine)} · {total === engine ? 'no number applied yet' : `people's numbers change it by ${total > engine ? '+' : ''}${fmtINR(total - engine)}`}</>}
        progress={{ value: Math.round((act / total) * 1000) / 10, marker: Math.round((fc / total) * 1000) / 10, label: 'Sold so far against the applied month figure' }} />
      <div className={`grid items-start gap-4 ${open ? 'xl:grid-cols-[minmax(0,1fr)_30rem]' : ''}`}>
        <Card title="Subcategories">
          <div className="px-4 pb-4"><DataList caption="Subcategories' forecast" rows={subs} columns={columns} rowKey={subKey} layout="table" empty={{ title: 'No subcategories', body: 'Nothing is forecast for this section.' }} /></div>
        </Card>
        {open && pane && (
          <div className="sticky top-4 overflow-hidden rounded-card">
            <DrillPane place="right" kind={`${open.store} · ${open.section} · ${open.code}`} title={open.name} onClose={() => setPane(null)}
              actions={<Segmented label="Pane" value={pane.mode} onChange={mode => setPane({ ...pane, mode })} options={[
                { value: 'why', label: 'Why' }, { value: 'numbers', label: `Numbers (${numbersOn(ctx, open).length + 1})` }, { value: 'comments', label: `Comments${notesOn(open).length ? ` (${notesOn(open).length})` : ''}` }]} />}>
              {pane.mode === 'why' && <Why s={open} />}
              {pane.mode === 'numbers' && <Numbers key={open.name + open.store} ctx={ctx} s={open} />}
              {pane.mode === 'comments' && <Comments ctx={ctx} s={open} notes={notesOn(open)} />}
            </DrillPane>
          </div>
        )}
      </div>
    </Page>
  )
}

function Why({ s }: { s: Sub }) {
  const blend = BASES.reduce((n, b) => n + weightOf(s, b.code) * (value(s, b.code) ?? 0), 0)
  return (
    <PaneSection title={`Why the engine says ${fmtINR(s.engine)}`}>
      <table className="w-full text-sm">
        <thead><tr className="text-[13px] text-ink-muted"><th className="py-1 text-start font-medium">Basis</th><th className="text-end font-medium">Weight</th><th className="text-end font-medium">Its value</th><th className="text-end font-medium">₹ it adds</th></tr></thead>
        <tbody>
          {BASES.map(b => { const w = weightOf(s, b.code); const v = value(s, b.code) ?? 0; return (
            <tr key={b.code} className={w ? '' : 'text-ink-muted'}>
              <td className="py-1.5"><span className="font-medium">{b.code}</span> <span className="text-[13px]">{b.name}</span></td>
              <td className="text-end tabular-nums">{Math.round(w * 100)}%</td>
              <td className="text-end tabular-nums">{fmtINR(v)}</td>
              <td className="text-end tabular-nums">{w ? fmtINR(w * v) : '—'}</td>
            </tr>) })}
          <tr className="border-t border-border"><td className="py-1.5">Blend of the bases</td><td /><td /><td className="text-end tabular-nums">{fmtINR(blend)}</td></tr>
          <tr><td className="py-1.5">{Math.round(UPLIFT * 100)}% uplift (a judgement call)</td><td /><td /><td className="text-end tabular-nums">+ {fmtINR(blend * UPLIFT)}</td></tr>
          {Math.abs(s.other) > 10 && <tr><td className="py-1.5">Small-cell split and rounding</td><td /><td /><td className="text-end tabular-nums">{s.other > 0 ? '+ ' : '− '}{fmtINR(Math.abs(s.other))}</td></tr>}
          <tr className="border-t border-border font-semibold"><td className="py-1.5">Engine's November figure</td><td /><td /><td className="text-end tabular-nums">{fmtINR(s.engine)}</td></tr>
        </tbody>
      </table>
    </PaneSection>
  )
}

const howText = (n: NumberRow) => {
  if (n.kind === 'Change the weights' && n.weights_json) {
    const w = JSON.parse(n.weights_json) as Record<string, number>
    return `Changed the weights: ${Object.entries(w).filter(([, v]) => v).map(([k, v]) => `${k} ${v}%`).join(', ')}`
  }
  return n.kind
}

/** Who a number goes to next: the person's manager, or nobody for the Chief Executive. */
const nextUp = (p: Person) => (p.reportsTo ? person(p.reportsTo) : null)

function Numbers({ ctx, s }: { ctx: Ctx; s: Sub }) {
  const numbers = numbersOn(ctx, s).sort((a, b) => a.entered_on.localeCompare(b.entered_on))
  const anyApplied = numbers.some(n => n.status === 'Applied')
  const [adding, setAdding] = useState(false)
  return (
    <>
      <ol className="flex flex-col gap-3" data-testid="numbers-list">
        <li className="flex flex-col gap-1.5 rounded-card bg-subtle p-3">
          <div className="flex items-start justify-between gap-2"><span className="font-medium">Engine</span><span className="text-lg font-semibold tabular-nums">{fmtINR(s.engine)}</span></div>
          <div className="flex items-center gap-2"><StatusPill tone={anyApplied ? 'neutral' : 'positive'}>{anyApplied ? 'Reference' : 'Applied'}</StatusPill><span className="text-[13px] text-ink-muted">Run of 30-Oct-2026</span></div>
        </li>
        {numbers.map(n => <NumberCard key={n.row_id} ctx={ctx} s={s} n={n} siblings={numbers} />)}
      </ol>
      {adding ? <AddNumber ctx={ctx} s={s} onDone={() => setAdding(false)} />
        : <div><Button variant="primary" onClick={() => setAdding(true)} data-testid="add-number">Add your number</Button></div>}
    </>
  )
}

function NumberCard({ ctx, s, n, siblings }: { ctx: Ctx; s: Sub; n: NumberRow; siblings: NumberRow[] }) {
  const history = ctx.data.decisions.filter(d => d.number === n.row_id).sort((a, b) => a.decided_on.localeCompare(b.decided_on))
  const mine = n.status === 'Waiting' && n.waiting_on === ctx.viewer.name
  const [note, setNote] = useState('')
  const up = nextUp(ctx.viewer)
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const decide = async (decision: string, change: Partial<NumberRow>, others: NumberRow[] = []) => {
    await ctx.save('forecasting.number', { ...n, ...change })
    await ctx.save('forecasting.decision', { number: n.row_id, month: n.month, store: n.store, scope_name: n.scope_name, decision, decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: now, note })
    for (const o of others) {
      await ctx.save('forecasting.number', { ...o, status: 'Reference', waiting_on: null })
      await ctx.save('forecasting.decision', { number: o.row_id, month: o.month, store: o.store, scope_name: o.scope_name, decision: 'Kept as reference', decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: now, note: `${n.entered_by}'s number was applied instead.` })
    }
    await ctx.reload()
  }
  const othersToSettle = siblings.filter(o => o.row_id !== n.row_id && (o.status === 'Applied' || (o.status === 'Waiting' && o.waiting_on === ctx.viewer.name)))
  return (
    <li className={`flex flex-col gap-2 rounded-card p-3 ${n.status === 'Applied' ? 'bg-positive-subtle' : 'bg-subtle'}`} data-testid="number-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><Who name={n.entered_by} /></div>
        <span className="text-lg font-semibold tabular-nums">{fmtINR(n.value)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATUS_TONE[n.status]}>{n.status === 'Waiting' ? `Waiting for ${n.waiting_on}` : n.status}</StatusPill>
        <span className="text-[13px] text-ink-muted">{howText(n)} · {pct(n.value, s.engine) >= 0 ? '+' : ''}{pct(n.value, s.engine)}% on the engine · {when(n.entered_on)}</span>
      </div>
      <p className="text-sm">{n.reason}</p>
      {history.length > 0 && (
        <ol className="flex flex-col gap-1 border-l-2 border-border pl-3 text-[13px]">
          {history.map(h => <li key={h.row_id}><span className="text-ink-muted">{when(h.decided_on)}</span> · <b>{h.decided_by}</b>: {h.decision}{h.note ? ` · ${h.note}` : ''}</li>)}
        </ol>
      )}
      {mine && (
        <div className="flex flex-col gap-2 rounded-control bg-surface p-2" data-testid="decide">
          <span className="text-sm font-medium">This waits for you</span>
          <TextInput placeholder="A note (needed to say no)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void decide('Approved and applied', { status: 'Applied', waiting_on: null }, othersToSettle)}>Approve and apply</Button>
            {up && <Button variant="secondary" onClick={() => void decide('Sent up', { waiting_on: up.name })}>Send up to {up.name}</Button>}
            <Button variant="secondary" disabled={!note.trim()} onClick={() => void decide('Not approved', { status: 'Not approved', waiting_on: null })}>Not approved</Button>
          </div>
          {othersToSettle.length > 0 && <span className="text-[13px] text-ink-muted">Approving this keeps {othersToSettle.map(o => `${o.entered_by}'s ${fmtINR(o.value)}`).join(' and ')} as reference.</span>}
        </div>
      )}
    </li>
  )
}

function AddNumber({ ctx, s, onDone }: { ctx: Ctx; s: Sub; onDone: () => void }) {
  const [how, setHow] = useState<'Set a figure' | 'Change the weights' | 'Change by a percent'>('Set a figure')
  const [figure, setFigure] = useState('')
  const [percent, setPercent] = useState('')
  const [w, setW] = useState<Partial<Record<Code, number>>>(() => Object.fromEntries(BASES.map(b => [b.code, Math.round(weightOf(s, b.code) * 100)])))
  const [reason, setReason] = useState('')
  const sum = BASES.reduce((n, b) => n + (Number(w[b.code]) || 0), 0)
  const next = how === 'Set a figure' ? Number(figure.replace(/[^0-9.]/g, '')) || 0
    : how === 'Change by a percent' ? Math.round(s.engine * (1 + (Number(percent) || 0) / 100)) : Math.round(fromWeights(s, w))
  const ready = reason.trim() && next > 0 && (how !== 'Change the weights' || sum === 100)
  const up = nextUp(ctx.viewer)
  const send = async () => {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const direct = !up
    const saved = await ctx.save('forecasting.number', {
      month: MONTH, run: 'demo_2026_11_official', store: s.store, section: s.section, scope_level: 'Subcategory', scope_name: s.name,
      kind: how, value: next, weights_json: how === 'Change the weights' ? JSON.stringify(w) : null,
      entered_by: ctx.viewer.name, entered_by_role: ctx.viewer.role, entered_on: now.slice(0, 10), reason,
      status: direct ? 'Applied' : 'Waiting', waiting_on: direct ? null : up!.name })
    await ctx.save('forecasting.decision', { number: saved.row_id, month: MONTH, store: s.store, scope_name: s.name,
      decision: direct ? 'Approved and applied' : 'Sent for approval', decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: now,
      note: direct ? "The Chief Executive's number applies without approval." : `To ${up!.name}` })
    if (direct) for (const o of numbersOn(ctx, s).filter(o => o.status === 'Applied')) await ctx.save('forecasting.number', { ...o, status: 'Reference' })
    await ctx.reload(); onDone()
  }
  return (
    <div className="flex flex-col gap-3 rounded-card bg-subtle p-3" data-testid="add-form">
      <Segmented label="How" value={how} onChange={setHow} options={[{ value: 'Set a figure', label: 'Set a figure' }, { value: 'Change the weights', label: 'Change the weights' }, { value: 'Change by a percent', label: 'By a percent' }]} />
      {how === 'Set a figure' && <Field label="November figure, before tax (₹)" hint="Spread over the month by the engine's day shape."><TextInput data-testid="figure" inputMode="numeric" value={figure} placeholder={String(s.engine)} onChange={e => setFigure(e.target.value)} /></Field>}
      {how === 'Change by a percent' && <Field label="Change on the engine (%)"><TextInput data-testid="percent" inputMode="numeric" value={percent} placeholder="+10 or −5" onChange={e => setPercent(e.target.value)} /></Field>}
      {how === 'Change the weights' && (
        <table className="w-full text-sm">
          <tbody>
            {BASES.map(b => (
              <tr key={b.code}>
                <td className="py-1"><span className="font-medium">{b.code}</span> <span className="text-[13px] text-ink-muted">{b.name}</span></td>
                <td className="text-end tabular-nums">{fmtINR(value(s, b.code) ?? 0)}</td>
                <td className="pl-2 text-end"><TextInput aria-label={`${b.code} weight`} data-testid={`w-${b.code}`} inputMode="numeric" className="w-16 text-end" value={String(w[b.code] ?? 0)} onChange={e => setW({ ...w, [b.code]: Number(e.target.value.replace(/\D/g, '')) })} /></td>
              </tr>))}
            <tr className="border-t border-border"><td className="py-1.5 font-medium">Total</td><td /><td className="text-end"><StatusPill tone={sum === 100 ? 'positive' : 'negative'}>{sum}%</StatusPill></td></tr>
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-3 gap-2 rounded-control bg-surface p-2 text-sm">
        <div><div className="text-[13px] text-ink-muted">Engine</div><div className="font-semibold tabular-nums">{fmtINR(s.engine)}</div></div>
        <div><div className="text-[13px] text-ink-muted">Yours</div><div className="font-semibold tabular-nums">{next ? fmtINR(next) : '—'}</div></div>
        <div><div className="text-[13px] text-ink-muted">Change</div><div className="font-semibold tabular-nums">{next ? `${pct(next, s.engine) >= 0 ? '+' : ''}${pct(next, s.engine)}%` : '—'}</div></div>
      </div>
      <Field label="Why (required)"><textarea data-testid="reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="What do you know that the engine doesn't?" className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" /></Field>
      {up ? <div className="flex flex-col gap-1 text-sm"><span className="text-ink-muted">Goes for approval to</span><Who name={up.name} /></div>
        : <Notice>As Chief Executive, your number applies straight away.</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!ready} onClick={() => void send()}>{up ? 'Send for approval' : 'Apply'}</Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

function Comments({ ctx, s, notes }: { ctx: Ctx; s: Sub; notes: DecisionRow[] }) {
  const [kind, setKind] = useState<'Comment' | 'This is wrong'>('Comment')
  const [text, setText] = useState('')
  const post = async () => {
    await ctx.save('forecasting.decision', { month: MONTH, store: s.store, scope_name: s.name, decision: kind, decided_by: ctx.viewer.name, decided_by_role: ctx.viewer.role, decided_on: new Date().toISOString().slice(0, 16).replace('T', ' '), note: text })
    setText(''); await ctx.reload()
  }
  return (
    <>
      <ol className="flex flex-col gap-3">
        {notes.length === 0 && <li className="text-sm text-ink-muted">No comments yet.</li>}
        {[...notes].sort((a, b) => a.decided_on.localeCompare(b.decided_on)).map(n => (
          <li key={n.row_id} className="flex flex-col gap-1.5 rounded-card bg-subtle p-3">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><Who name={n.decided_by} /></div><span className="text-[13px] text-ink-muted">{when(n.decided_on)}</span></div>
            {n.decision === 'This is wrong' && <div><StatusPill tone="negative">This is wrong</StatusPill></div>}
            <p className="text-sm">{n.note}</p>
          </li>))}
      </ol>
      <div className="flex flex-col gap-2">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'Comment', label: 'Comment' }, { value: 'This is wrong', label: 'This is wrong' }]} />
        <textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'This is wrong' ? 'What is wrong, and what should it be?' : 'Write a comment'} className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-control text-ink" />
        <div><Button variant="primary" disabled={!text.trim()} onClick={() => void post()}>Post</Button></div>
      </div>
    </>
  )
}
