// #1246: a category head's Buyer Sections on Your categories, and the master data team's decisions on
// Waiting for you. A move changes nothing until the master data team keeps it (or, applied at once, until
// they confirm or undo it).
import { useState } from 'react'
import { Button, Card, Field, Notice, Select, StatusPill, TextInput, fmtDate } from '@featherbase/shop-floor'
import { act } from './api'
import { RECORD, RecordLink } from './record-link'

interface Ref { code: string; name: string }
export interface BuyerSectionCard { id: string; name: string; region: string; buyer: Ref | null; subcategories: (Ref & { link: string })[] }
interface Waiting { id: string; subcategory: string; subcategory_name: string; region: string; from: string | null; to: string; applied: boolean; waiting_for: string }
interface Decided { id: string; subcategory: string; subcategory_name: string; from: string | null; to: string; state: string; reason: string | null; decided_on: string }
export interface BuyerSectionsAnswer { buyerSections: BuyerSectionCard[]; unplaced: (Ref & { region: string })[]; waiting: Waiting[]; decided?: Decided[] }
const OUTCOME: Record<string, string> = { Applied: 'Kept', Confirmed: 'Kept', Rejected: 'Turned down', Undone: 'Undone', 'Needs fresh review': 'Changed since you asked', Withdrawn: 'Taken back' }
export interface BuyerMoveToDecide { id: string; who: string; who_code?: string | null; subcategory: string; subcategory_name: string; region: string; from: string | null; from_id?: string | null; to: string; to_id?: string; applied: boolean; asked_on: string }

const messageOf = (error: unknown) => (error as Error).message

/** One subcategory and where it could go: the head's other Buyer Sections in the same region. */
function MoveRow({ sub, region, here, buyerSections, waiting, onDone }: { sub: Ref; region: string; here: string | null; buyerSections: BuyerSectionCard[]; waiting?: Waiting
  onDone: (note: { tone: 'positive' | 'negative'; text: string }) => Promise<unknown> }) {
  const choices = buyerSections.filter(d => d.region === region && d.id !== here)
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  async function move() {
    setBusy(true)
    try {
      const done = await act<{ state: string }>('move_buyer_subcategory', { subcategory: sub.code, to_section: to })
      const name = buyerSections.find(d => d.id === to)?.name ?? ''
      await onDone({ tone: 'positive', text: done.state === 'Not yet reviewed' ? `Moved ${sub.name} to ${name}. The master data team reviews it.` : `Asked to move ${sub.name} to ${name}. The master data team decides.` })
      setTo('')
    } catch (failure) { await onDone({ tone: 'negative', text: messageOf(failure) }) }
    finally { setBusy(false) }
  }
  return (
    <tr className="group border-t border-border hover:bg-subtle" data-testid="buyer-subcategory">
      <td className="px-3 py-2 align-top text-sm"><RecordLink table={RECORD.subcategory} id={sub.code}>{sub.name}</RecordLink> <span className="text-ink-muted">{sub.code}</span></td>
      <td className="px-3 py-2 align-top text-sm">
        {waiting ? <StatusPill tone="caution">{waiting.applied ? `Moved to ${waiting.to}, ${waiting.waiting_for} reviews it` : `Waiting for ${waiting.waiting_for}: to ${waiting.to}`}</StatusPill>
          : choices.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Select value={to} onChange={e => setTo(e.target.value)} aria-label={`Move ${sub.name} to`} data-testid="move-to">
                <option value="">{here ? 'Move to…' : 'Put in…'}</option>
                {choices.map(d => <option key={d.id} value={d.id}>{d.name}{d.buyer ? ` (${d.buyer.name})` : ' (no buyer yet)'}</option>)}
              </Select>
              <Button data-action disabled={!to || busy} onClick={() => void move()} data-testid="move-buyer-subcategory">{here ? 'Move' : 'Put in'}</Button>
            </span>
          )}
      </td>
    </tr>
  )
}

/** A category head's Buyer Sections and what in their categories no Buyer Section buys yet. Nothing when they head no Buyer Section. */
export function YourBuyerSections({ answer, onChanged }: { answer: BuyerSectionsAnswer; onChanged: () => Promise<unknown> }) {
  const [note, setNote] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null)
  if (!answer.buyerSections.length) return null
  // One change waits per subcategory and region, as the server serializes them.
  const waitingFor = (code: string, region: string) => answer.waiting.find(w => w.subcategory === code && w.region === region)
  const done = (next: NonNullable<typeof note>) => { setNote(next); return onChanged() }
  return (
    <div className="flex flex-col gap-4" data-testid="buyer-sections">
      <h2 className="text-lg font-semibold">Your Buyer Sections</h2>
      <p className="fd-muted text-sm">Move a subcategory to another of your Buyer Sections to change who buys it. The master data team decides; nothing changes until then.</p>
      {note && <Notice tone={note.tone}><span data-testid="buyer-move-note">{note.text}</span></Notice>}
      {answer.buyerSections.map(buyerSection => (
        <Card key={buyerSection.id} data-testid="buyer-section-card"
          title={<span className="inline-flex flex-wrap gap-x-1"><RecordLink table={RECORD.buyerSection} id={buyerSection.id}>{buyerSection.name}</RecordLink><span aria-hidden="true" className="text-ink-muted">·</span>
            {buyerSection.buyer ? <span className="whitespace-nowrap"><span className="text-ink-muted">Buyer: </span><RecordLink table={RECORD.employee} id={buyerSection.buyer.code}>{buyerSection.buyer.name}</RecordLink></span>
              : <span className="text-ink-muted" data-testid="no-buyer-yet">No buyer yet</span>}
            <span aria-hidden="true" className="text-ink-muted">·</span><RecordLink table={RECORD.region} id={buyerSection.region}>{buyerSection.region}</RecordLink></span>}>
          {buyerSection.subcategories.length
            ? <table className="w-full"><tbody>{buyerSection.subcategories.map(s => <MoveRow key={s.code} sub={s} region={buyerSection.region} here={buyerSection.id} buyerSections={answer.buyerSections} waiting={waitingFor(s.code, buyerSection.region)} onDone={done} />)}</tbody></table>
            : <p className="fd-muted p-4 text-sm">Buys nothing yet.</p>}
        </Card>
      ))}
      {(answer.decided ?? []).length > 0 && (
        <Card title="Decided recently" data-testid="buyer-decided">
          <ul className="flex flex-col divide-y divide-border">
            {answer.decided!.map(d => (
              <li key={d.id} className="flex flex-col gap-0.5 px-4 py-2 text-sm" data-testid="buyer-decided-row">
                <span><span className="font-medium">{OUTCOME[d.state] ?? d.state}</span> · {d.from ? 'Move ' : 'Put '}<RecordLink table={RECORD.subcategory} id={d.subcategory}>{d.subcategory_name}</RecordLink>{d.from ? ` from ${d.from}` : ''} {d.from ? 'to' : 'into'} {d.to}
                  <span className="text-ink-muted"> · {fmtDate(d.decided_on)}</span></span>
                {d.reason && <span className="text-ink-muted">“{d.reason}”</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {answer.unplaced.length > 0 && (
        <Card data-testid="buyer-unplaced" title={`Not in any Buyer Section yet · ${answer.unplaced.length}`}>
          <table className="w-full"><tbody>{answer.unplaced.map(s => <MoveRow key={`${s.region}|${s.code}`} sub={s} region={s.region} here={null} buyerSections={answer.buyerSections} waiting={waitingFor(s.code, s.region)} onDone={done} />)}</tbody></table>
        </Card>
      )}
    </div>
  )
}

function DecideCard({ move, onDecided }: { move: BuyerMoveToDecide; onDecided: (said: string) => Promise<unknown> }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function decide(payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const done = await act<{ state: string }>('decide_buyer_section', { proposal: move.id, ...payload })
      await onDecided(done.state === 'Needs fresh review' ? `${move.subcategory_name} has changed since ${move.who} asked: it goes back to them.`
        : payload.decision === 'reject' ? (move.applied ? `Undone. ${move.subcategory_name} is back where it was; ${move.who} sees your reason.` : `Turned down. ${move.who} sees your reason.`)
        : `Kept. ${move.subcategory_name} is now in ${move.to}.`)
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }
  return (
    <Card title={<span><RecordLink table={RECORD.employee} id={move.who_code}>{move.who}</RecordLink> · Category head</span>} data-testid="buyer-move-card" actions={<StatusPill tone="caution">{move.applied ? 'Already moved' : 'Buyer Section change'}</StatusPill>}>
      <div className="flex flex-col gap-3 p-4">
        <p className="font-semibold" data-testid="buyer-move-ask">
          {move.from ? 'Move ' : 'Put '}<RecordLink table={RECORD.subcategory} id={move.subcategory}>{move.subcategory_name}</RecordLink>
          {move.from && <> from <RecordLink table={RECORD.buyerSection} id={move.from_id}>{move.from}</RecordLink></>}
          {move.from ? ' to ' : ' into '}<RecordLink table={RECORD.buyerSection} id={move.to_id}>{move.to}</RecordLink>
          {' '}<span className="fd-muted font-normal">· <RecordLink table={RECORD.region} id={move.region}>{move.region}</RecordLink></span></p>
        <p className="fd-muted text-sm">{move.applied ? <>Already in use.<span data-action-hint> Keep it, or undo it.</span></> : `Asked on ${fmtDate(move.asked_on)}. Keeping it changes who buys ${move.subcategory_name} from today.`}</p>
        {rejecting && <Field label={move.applied ? 'Reason' : 'Why not?'}><TextInput value={reason} onChange={event => setReason(event.target.value)} data-testid="buyer-reject-reason" /></Field>}
        {error && <Notice tone="negative"><span data-testid="buyer-decide-refused">{error}</span></Notice>}
        <div className="flex flex-wrap gap-2">
          {!rejecting ? <>
            <Button data-action variant="primary" disabled={busy} onClick={() => void decide({ decision: 'approve' })} data-testid="buyer-keep">Keep it</Button>
            <Button data-action variant="quiet" disabled={busy} onClick={() => setRejecting(true)}>{move.applied ? 'Undo it' : 'Turn down'}</Button>
          </> : <>
            <Button data-action variant="danger" disabled={busy || !reason.trim()} onClick={() => void decide({ decision: 'reject', reason: reason.trim() })} data-testid="buyer-confirm-reject">{move.applied ? 'Undo it' : 'Turn it down'}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setRejecting(false)}>Cancel</Button>
          </>}
        </div>
      </div>
    </Card>
  )
}

/** The master data team's Buyer Section changes, on Waiting for you. */
export function BuyerSectionApprovals({ moves, onDecided }: { moves: BuyerMoveToDecide[]; onDecided: (said: string) => Promise<unknown> }) {
  return <>{moves.map(move => <DecideCard key={move.id} move={move} onDecided={onDecided} />)}</>
}
