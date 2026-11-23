// My Numbers: every number the viewer entered, in every month, with where it stands; a notice of what
// happened to them since the viewer last looked (approved, sent up, turned down, kept as reference),
// counted on the sidebar until seen; and, while one still waits, withdrawing or changing it. Every step
// is kept in the number's history. "Seen" is kept in this browser per made-up person (localStorage).
import { useEffect, useState } from 'react'
import { Button, Card, DataList, Notice, StatusPill, TextInput, fmtINR, type DataColumn } from '@featherbase/shop-floor'
import { Page, address, type Ctx, type Data, type DecisionRow, type NumberRow } from './App'
import { STATUS_TONE, logRow, scopeText, when } from './WorkspacePage'
import { covers } from './areas'
import { monthOf } from './months'
import { figureOf } from './combine'
import type { Person } from './madeUp'

/** What others did to a person's numbers that the person is told about. */
const TOLD = ['Approved and applied', 'Made the applied number', 'Sent up', 'Not approved', 'Kept as reference']
const seenKey = (p: Person) => `fc_seen_${p.id}`
const seenOf = (p: Person): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(seenKey(p)) ?? '[]') as string[]) } catch { return new Set() } }
/** The steps others took on this person's numbers that they have not seen yet, newest first. */
export function unseenFor(data: Data, p: Person): DecisionRow[] {
  const mine = new Set(data.numbers.filter(n => n.entered_by === p.name).map(n => n.row_id))
  const seen = seenOf(p)
  return data.decisions.filter(d => d.number && mine.has(d.number) && d.decided_by !== p.name && TOLD.includes(d.decision) && !seen.has(d.row_id))
    .sort((a, b) => b.decided_on.localeCompare(a.decided_on))
}
export function markSeen(p: Person, ids: string[]) {
  try { localStorage.setItem(seenKey(p), JSON.stringify([...new Set([...seenOf(p), ...ids])])) } catch { /* private window */ }
}

const cellLink = (n: NumberRow) => address('forecasts', { store: n.store, level: n.scope_level, name: n.scope_name, ...(n.weeks ? { weeks: n.weeks } : {}), pane: 'views', month: n.month })

export function MyNumbersPage({ ctx, onSeen }: { ctx: Ctx; onSeen: () => void }) {
  const mine = ctx.data.numbers.filter(n => n.entered_by === ctx.viewer.name).sort((a, b) => b.entered_on.localeCompare(a.entered_on))
  // The notice shows what was new when the page opened; the sidebar's count clears at once.
  const [news] = useState(() => unseenFor(ctx.data, ctx.viewer))
  useEffect(() => { markSeen(ctx.viewer, news.map(d => d.row_id)); onSeen() }, [])
  const last = (n: NumberRow) => ctx.data.decisions.filter(d => d.number === n.row_id).sort((a, b) => b.decided_on.localeCompare(a.decided_on))[0]
  const byId = new Map(ctx.data.numbers.map(n => [n.row_id, n]))
  const columns: DataColumn<NumberRow>[] = [
    { key: 'month', header: 'Month', phone: 'meta', cell: n => monthOf(n.month).short },
    { key: 'for', header: 'Scope', phone: 'title', cell: n => <a href={cellLink(n)} className="font-medium">{scopeText(n)}</a> },
    { key: 'value', header: 'Figure', align: 'end', phone: 'value', cell: n => <span className="font-semibold whitespace-nowrap">{fmtINR(figureOf(n, ctx.data.numbers))}</span> },
    { key: 'status', header: 'Status Now', phone: 'status', cell: n => <StatusPill tone={STATUS_TONE[n.status] ?? 'neutral'}>{n.status === 'Waiting' ? `Waiting for ${n.waiting_on}` : n.status}</StatusPill> },
    { key: 'last', header: 'Last Step', phone: 'meta', cell: n => { const d = last(n); return d ? <span className="text-sm">{when(d.decided_on)} · <b>{d.decided_by}</b>: {d.decision}</span> : null } },
    { key: 'act', header: '', phone: 'hidden', cell: n => <OwnActions ctx={ctx} n={n} /> },
  ]
  return (
    <Page title="My Numbers">
      <p className="-mt-2 text-sm text-ink-muted">Every number you entered, in every month, and where it stands. While one waits for approval you can withdraw it or change it; each step stays in its history.</p>
      {news.length > 0 && (
        <Notice tone="positive">
          <div data-testid="my-news"><b>{news.length === 1 ? '1 update' : `${news.length} updates`} since you last looked</b>
            <ul className="mt-1 flex flex-col gap-0.5">{news.map(d => { const n = byId.get(d.number!); return (
              <li key={d.row_id}>{when(d.decided_on)} · <b>{d.decided_by}</b>: {d.decision.toLowerCase()}{n ? <> · <a href={cellLink(n)}>{scopeText(n)}</a></> : ''}{d.note ? ` · ${d.note}` : ''}</li>) })}</ul>
          </div>
        </Notice>)}
      <Card title={`Your Numbers (${mine.length})`}>
        <div className="px-4 pb-4"><DataList caption="Your numbers" rows={mine} columns={columns} rowKey={n => n.row_id} layout="table"
          empty={{ title: 'No numbers yet', body: `${ctx.viewer.name} has not entered a number. Open a cell in the Workspace to add one.` }} /></div>
      </Card>
    </Page>
  )
}

/** Withdraw or change your own number while it waits, inside your area. Both are kept in its history. */
export function OwnActions({ ctx, n }: { ctx: Ctx; n: NumberRow }) {
  const [mode, setMode] = useState<'' | 'withdraw' | 'change'>('')
  const [note, setNote] = useState(''), [figure, setFigure] = useState(String(Math.round(n.value)))
  const own = n.entered_by === ctx.viewer.name && n.status === 'Waiting' && ctx.month.state !== 'closed' && monthOf(n.month).state === 'current'
    && covers(ctx.viewer, { store: n.store, level: n.scope_level, name: n.scope_name })
  if (!own) return null
  const total = n.kind === 'Set a total'
  const next = total ? Number(figure.replace(/[^0-9.]/g, '')) || 0 : n.value
  const done = async (change: Partial<NumberRow>, decision: string, text: string) => {
    await ctx.save('forecasting.number', { ...n, ...change, changed_by: ctx.viewer.name })
    await ctx.save('forecasting.decision', logRow(ctx, n, decision, text)); setMode(''); await ctx.reload()
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="own-actions">
      {!mode && <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setMode('change')} data-testid="change-own">Change</Button>
        <Button variant="secondary" onClick={() => setMode('withdraw')} data-testid="withdraw-own">Withdraw</Button>
      </div>}
      {mode === 'withdraw' && <div className="flex flex-wrap items-center gap-2">
        <TextInput className="w-64" placeholder="Why withdraw it? (required)" value={note} onChange={e => setNote(e.target.value)} data-testid="withdraw-why" />
        <Button variant="primary" disabled={!note.trim()} onClick={() => void done({ status: 'Withdrawn', waiting_on: null }, 'Withdrawn', note)}>Withdraw it</Button>
        <Button variant="secondary" onClick={() => setMode('')}>Cancel</Button>
      </div>}
      {mode === 'change' && <div className="flex flex-wrap items-center gap-2">
        {total ? <TextInput className="w-36" inputMode="numeric" value={figure} onChange={e => setFigure(e.target.value)} aria-label="New figure (₹)" data-testid="change-figure" />
          : <span className="text-[13px] text-ink-muted">A {n.kind.toLowerCase()} keeps its figure; withdraw it and enter a new one to change that.</span>}
        <TextInput className="w-64" placeholder="Why the change? (required)" value={note} onChange={e => setNote(e.target.value)} data-testid="change-why" />
        <Button variant="primary" disabled={!note.trim() || next <= 0} onClick={() => void done({ value: next, reason: `${n.reason} (Changed: ${note})` }, 'Edited',
          total && next !== n.value ? `${fmtINR(n.value)} → ${fmtINR(next)}: ${note}` : note)}>Save the change</Button>
        <Button variant="secondary" onClick={() => setMode('')}>Cancel</Button>
      </div>}
    </div>
  )
}
