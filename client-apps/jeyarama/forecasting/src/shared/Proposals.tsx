// Approvals (the managers' prototypes): a proposed change as a card — who sent it, Feather Forecast → the proposal,
// what it is against last month, last year and AOP, how it was entered (a day range, a %), the reasons and the
// explanation — and, for the one who decides (the Store Manager), Approve · Edit the number · Send back, with Undo.
// Anyone else sees it waiting. The row pills say where each subcategory's change stands.
import { useState, type ReactNode } from 'react'
import { Button, Chip, Notice, RecordLink, StatusPill, inputClasses } from '@featherbase/shop-floor'
import { count, day, inr, pc, type Line } from './model'
import { REASONS, changeWords, type ProposalActions, type ProposalItem } from './review'
import { LINE_TABLE } from './ReviewTree'

const reasonLabel = (c: string) => REASONS.find(r => r.code === c)?.label ?? c
const signed = (a: number, b: number) => <span className={a >= b ? 'text-positive' : 'text-negative'}>{pc(a, b)}</span>

/** One proposal. `actions` null: the viewer only sees it (it waits for the Store Manager at `store`). */
export function ProposalCard({ p, line, actions, hrefFor, title = true, onOpen }: {
  p: ProposalItem; line: Line; actions: ProposalActions | null
  /** Where its subcategory opens (the card's title is its RecordLink). */
  hrefFor: (l: Line) => string
  /** Show the subcategory as the card's title (off inside the subcategory's own panel). */
  title?: boolean
  /** Clicking the title opens the subcategory on this page (its tree row); without it the link goes to `hrefFor`. */
  onOpen?: () => void
}) {
  const [ui, setUi] = useState<null | 'edit' | 'back'>(null)
  const [edit, setEdit] = useState(''), [back, setBack] = useState('')
  const l = line, unit = l.fq ? l.fc / l.fq : 0
  const stop = (f: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); f() }
  let act: ReactNode
  if (p.state === 'approved') act = <Notice tone="positive">{actions ? 'You approved' : 'Approved'} {inr(p.final)}{p.final !== p.proposed ? ` (in place of ${inr(p.proposed)})` : ''}.{' '}
    {actions && <button type="button" className="fr-link" onClick={stop(() => actions.undo(p))}>Undo</button>}</Notice>
  else if (p.state === 'sent_back') act = <Notice>Sent back to {p.by}: “{p.backReason}”{' '}{actions && <button type="button" className="fr-link" onClick={stop(() => actions.undo(p))}>Undo</button>}</Notice>
  else if (!actions) act = <div className="fr-live">Waiting for the Store Manager at {l.store}.</div>
  else if (ui === 'edit') act = <div className="fr-numrow" onClick={e => e.stopPropagation()}>
    <input className={inputClasses()} type="number" step="0.01" aria-label="Your number in ₹ lakh" value={edit} onChange={e => setEdit(e.target.value)} /><span className="fr-dim">₹ lakh</span>
    <Button variant="primary" onClick={() => { const v = parseFloat(edit); if (!(v > 0)) return; actions.approve(p, Math.round(v * 1e5)); setUi(null) }}>Approve with this number</Button>
    <Button onClick={() => setUi(null)}>Cancel</Button></div>
  else if (ui === 'back') act = <div className="fr-numrow" onClick={e => e.stopPropagation()}>
    <input className={inputClasses('min-w-72 flex-1')} type="text" placeholder="Why you are sending it back" aria-label="Why you are sending it back" value={back} onChange={e => setBack(e.target.value)} />
    <Button variant="primary" onClick={() => { if (!back.trim()) return; actions.sendBack(p, back.trim()); setUi(null) }}>Send back</Button>
    <Button onClick={() => setUi(null)}>Cancel</Button></div>
  else act = <div className="fr-buttons">
    <Button variant="primary" onClick={stop(() => actions.approve(p))}>Approve</Button>
    <Button onClick={stop(() => { setEdit((p.proposed / 1e5).toFixed(2)); setUi('edit') })}>Edit the number</Button>
    <Button onClick={stop(() => { setBack(''); setUi('back') })}>Send back</Button></div>
  return (
    <div className="fr-pcard" data-testid="proposal-card" data-state={p.state}>
      {title && <div className="fr-ptitle"><RecordLink table={LINE_TABLE} rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={onOpen ? () => onOpen() : undefined} />
        <span className="fr-dim">{l.storeName} · {p.section}</span></div>}
      <div className="fr-pwho"><span className="fr-avatar">{p.by.slice(0, 1)}</span><span><b>{p.by}</b> · {p.role} · {p.section} · {day(p.sentOn)}</span></div>
      <div className="fr-pnums"><span className="fr-dim">Feather Forecast</span> <b>{inr(p.forecast)}</b> <span className="fr-dim">→ proposes</span> <b>{inr(p.proposed)}</b> {signed(p.proposed, p.forecast)}
        {p.change.scope === 'day' || p.change.method === 'percent' ? <span className="fr-dim"> · {changeWords(p.change, inr, day)}</span> : null}</div>
      <div className="fr-live">{unit ? `= ${count(p.proposed / unit)} pcs at ASP ₹${count(unit)} · ` : ''}{pc(p.proposed, l.r31)} on last month · {pc(p.proposed, l.ly)} on last year · {pc(p.proposed, l.aop)} on AOP ({inr(l.aop)})</div>
      <div className="fr-pwhy">{p.reasons.map(r => <Chip key={r} hue="grey" compact>{reasonLabel(r)}</Chip>)}<span>“{p.note}”</span></div>
      {act}
    </div>
  )
}

/** Where a subcategory's change stands, as pills on its row. `approver`: the Store Manager, for whom a waiting
 *  proposal reads "Waiting for you". */
export function proposalPills(p: ProposalItem | undefined, approver: boolean): ReactNode[] {
  if (!p) return []
  if (p.state === 'waiting') return [<StatusPill key="p" tone={approver ? 'caution' : 'neutral'} className="fr-pill">{approver ? 'Waiting for you' : 'Change proposed'}</StatusPill>]
  if (p.state === 'approved') return [<StatusPill key="p" tone="positive" className="fr-pill">Approved{p.final !== p.proposed ? ` at ${inr(p.final)}` : ''}</StatusPill>]
  return [<StatusPill key="p" tone="neutral" className="fr-pill">Sent back</StatusPill>]
}

/** A node's count of waiting proposals ("2 waiting" for the approver, "6 proposed" for others). */
export function nodeWaiting(n: number, approver: boolean): ReactNode {
  return n ? <StatusPill tone={approver ? 'caution' : 'neutral'} className="fr-pill">{n} {approver ? 'waiting' : 'proposed'}</StatusPill> : null
}
