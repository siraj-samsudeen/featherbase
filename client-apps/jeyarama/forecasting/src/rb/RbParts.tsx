// The RB review's own pieces (the agreed prototype): the breadcrumb, and the Approvals tab (progress by store, proposals waiting, questions RB can answer).
import { useState, type MouseEvent } from 'react'
import { Breadcrumbs, Button, Chip, Notice, RecordLink, TABLE_CLASSES, cellClasses, headCellClasses, inputClasses } from '@featherbase/shop-floor'
import { count, type Line } from '../shared/model'
import { Hover } from '../shared/Hover'
import { ProposalCard } from '../shared/Proposals'
import { LINE_TABLE } from '../shared/ReviewTree'
import type { ProposalItem } from '../shared/review'
import type { CrumbStep, StoreProgress } from './rbModel'

/** The prototype's "Sample" mark: what is made up until the app records it. */
export const Sample = ({ text }: { text: string }) => <Hover text={text}><Chip hue="grey" compact>Sample</Chip></Hover>

/** "You are at All regions › Kerala › LKS Lakeside · click a row to go down to division": Shop Floor's Breadcrumbs,
 *  each earlier step going back up. */
export function Crumbs({ steps, hint, onStep }: { steps: CrumbStep[]; hint?: string; onStep: (at: number) => void }) {
  const back = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const at = a?.getAttribute('href')?.match(/^#rb-crumb-(\d+)$/)
    if (!at) return
    e.preventDefault(); onStep(+at[1])
  }
  return (
    <div className="rb-crumbs" data-testid="rb-crumbs">
      <span className="fr-dim">You are at</span>
      <div onClickCapture={back}><Breadcrumbs label="Where you are" items={steps.map(s => ({ label: s.label, href: s.current ? undefined : `#rb-crumb-${s.at}` }))} /></div>
      {hint && <span className="fr-dim">· {hint}</span>}
    </div>
  )
}

export interface RbQuestion { id: number; line: Line; by: string; text: string; answer: string | null }

/** Approvals (Two Tabs) or Pending: how far each store has got, the proposals waiting, the questions. */
export function PendingTab({ progress, proposals, lineOf, questions, hrefFor, onStore, onLine, onAnswer, madeUp = true }: {
  /** The made-up chain marks its sample figures; a real Run shows what the app holds. */
  madeUp?: boolean
  progress: StoreProgress[]; proposals: ProposalItem[]; lineOf: (rowId: string) => Line | undefined; questions: RbQuestion[]
  hrefFor: (l: Line) => string; onStore: (store: string) => void; onLine: (rowId: string) => void; onAnswer: (id: number, text: string) => void
}) {
  const heads = ['Store', 'Region', 'Subcategories answered by Team Leaders', 'Subcategories', 'Proposals with the Store Manager', 'Oldest waiting', 'Questions open']
  const num = (i: number) => i >= 3
  const waiting = proposals.filter(p => p.state === 'waiting').length
  return (
    <div data-testid="rb-pending">
      <h2 className="fr-sec">By store {madeUp && <Sample text="Review progress, oldest waiting and questions are made up until the app records them" />}<span className="fr-dim">click a store to open it</span></h2>
      <div className="fr-scroll">
        <table className={TABLE_CLASSES} data-testid="rb-by-store">
          <thead><tr>{heads.map((h, i) => <th key={h} className={headCellClasses({ first: i === 0, last: i === heads.length - 1, className: num(i) ? 'text-right' : '' })}>{h}</th>)}</tr></thead>
          <tbody>{progress.map(x => (
            <tr key={x.store} className="group cursor-pointer" data-store={x.store} onClick={() => onStore(x.store)}>
              <td className={cellClasses({ first: true })}><button type="button" className="fr-link" onClick={e => { e.stopPropagation(); onStore(x.store) }}><b>{x.store}</b> {x.storeName}</button></td>
              <td className={cellClasses()}>{x.region}</td>
              <td className={cellClasses()}><span className="rb-prog" aria-hidden><i style={{ width: `${x.answered}%` }} /></span>{x.answered}%</td>
              <td className={cellClasses({ className: 'text-right tabular-nums' })}>{count(x.lines)}</td>
              <td className={cellClasses({ className: 'text-right tabular-nums' })}>{x.waiting || '—'}</td>
              <td className={cellClasses({ className: 'text-right tabular-nums' })}>{x.waiting ? `${x.oldest} day${x.oldest === 1 ? '' : 's'}` : '—'}</td>
              <td className={cellClasses({ last: true, className: 'text-right tabular-nums' })}>{x.questions || '—'}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <h2 className="fr-sec">Proposed changes waiting <span className="fr-dim">{waiting} with Store Managers; each Store Manager decides</span></h2>
      <div className="fr-pcards">{proposals.map(p => { const l = lineOf(p.line); return l && <ProposalCard key={p.id} p={p} line={l} actions={null} hrefFor={hrefFor} /> })}</div>
      <h2 className="fr-sec">Questions waiting for an answer <span className="fr-dim">anyone in the Forecast Creator or Forecast Reviewer role can answer</span></h2>
      <div className="rb-qlist">{questions.map(q => <QuestionCard key={q.id} q={q} hrefFor={hrefFor} onLine={onLine} onAnswer={onAnswer} />)}</div>
    </div>
  )
}

function QuestionCard({ q, hrefFor, onLine, onAnswer }: { q: RbQuestion; hrefFor: (l: Line) => string; onLine: (rowId: string) => void; onAnswer: (id: number, text: string) => void }) {
  const [draft, setDraft] = useState('')
  const l = q.line
  return (
    <div className="fr-pcard" data-testid="rb-question">
      <div className="fr-pwho"><span className="fr-avatar">{q.by.slice(0, 1)}</span><span><b>{q.by}</b> · about {l.store} ·{' '}
        <RecordLink table={LINE_TABLE} rowId={l.rowId} name={l.name} href={hrefFor(l)} onNavigate={() => onLine(l.rowId)} /></span>
        <Sample text="A made-up question until the app records them" /></div>
      <div>“{q.text}”</div>
      {q.answer
        ? <Notice tone="positive">You answered: “{q.answer}” The asker is notified.</Notice>
        : <div className="fr-numrow">
          <input className={inputClasses('min-w-72 flex-1')} type="text" placeholder="Your answer" aria-label={`Your answer to ${q.by}`} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) onAnswer(q.id, draft.trim()) }} />
          <Button variant="primary" onClick={() => { if (draft.trim()) onAnswer(q.id, draft.trim()) }}>Send answer</Button>
        </div>}
    </div>
  )
}
