// Questions on a subcategory (TL-33): the thread in an opened subcategory, and My questions in the page header.
// Answers come from the Forecast Creator and Forecast Reviewer roles, as Comments on the question.
import { useEffect, useRef, useState } from 'react'
import { Bell, Button, RecordLink, StatusPill, inputClasses, labelClasses, raisedClasses } from '@featherbase/shop-floor'
import type { Line } from './model'
import { when, type Question } from './review'

export function Questions({ l, questions, initial, onAsk }: { l: Line; questions: Question[]; initial: string; onAsk: (text: string) => void }) {
  const [asking, setAsking] = useState(false)
  const [draft, setDraft] = useState('')
  return <>
    <h4>Questions</h4>
    <div className="fr-thread">{questions.map(q => (
      <div key={q.id} className="fr-thread">
        <div className="fr-msg"><div className="fr-who"><span className="fr-avatar">{initial}</span>You asked · {when(q.askedAt)}</div>{q.text}</div>
        {q.answer
          ? <div className="fr-msg fr-reply"><div className="fr-who"><span className="fr-avatar" style={{ background: 'var(--color-ink-muted)' }}>FC</span>{q.answer.by} · answered</div>{q.answer.text}</div>
          : <div className="fr-waiting">Waiting for a Forecast Creator or Reviewer. You can still accept or change the forecast meanwhile.</div>}
      </div>))}</div>
    {asking
      ? <div className="fr-form" style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
          <div><label className={labelClasses()} htmlFor={`fr-q-${l.rowId}`}>Your question about {l.name}</label>
            <textarea id={`fr-q-${l.rowId}`} className={inputClasses('min-h-16 resize-y py-2')} autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="e.g. Why is this so much higher than last December?" />
            <div className="fr-live">Goes to everyone in the Forecast Creator and Forecast Reviewer roles. You are told when it is answered.</div></div>
          <div className="fr-buttons">
            <Button variant="primary" onClick={() => { if (!draft.trim()) return; onAsk(draft.trim()); setDraft(''); setAsking(false) }}>Send question</Button>
            <Button onClick={() => { setDraft(''); setAsking(false) }}>Cancel</Button>
          </div>
        </div>
      : <div style={{ marginTop: questions.length ? 8 : 0 }}>
          <Button variant="quiet" className="-ml-2.5 px-2.5" onClick={e => { e.stopPropagation(); setAsking(true) }}
            icon={<svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}>
            {questions.length ? 'Ask another question' : 'Ask about this subcategory'}</Button>
        </div>}
  </>
}

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
    <div className="fr-qwrap" ref={box}>
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)} icon={<Bell aria-hidden size={16} />} className="relative">
        My questions{waiting && !unread ? <span className="fr-dim" style={{ fontWeight: 400 }}>{waiting} open</span> : null}
        {unread ? <span className="fr-count" aria-label={`${unread} new ${unread === 1 ? 'answer' : 'answers'}`}>{unread}</span> : null}
      </Button>
      {open && (
        <div className={raisedClasses('fr-qmenu')} role="menu" aria-label="My questions">
          <h5>Questions you asked, newest first</h5>
          {questions.length ? [...questions].reverse().map(q => {
            const line = lines.find(l => l.name === q.line)
            return (
              <a key={q.id} role="menuitem" className="fr-qitem" href={line ? hrefFor(line) : undefined}
                onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setOpen(false); onJump(q.line) }}>
                <span className="fr-qtop">
                  {q.answer && !q.seen && <span className="fr-newdot" title="New answer" />}
                  {line ? <RecordLink table="forecasting.forecast_line_month" rowId={line.rowId} name={q.line} inLink /> : <span>{q.line}</span>}
                  {q.answer ? <StatusPill tone="neutral">Answered</StatusPill> : <StatusPill tone="caution">Open</StatusPill>}
                </span>
                <span className="fr-qtext">{q.text}</span>
              </a>)
          }) : <div className="fr-qempty">No questions yet. Open a subcategory and choose <b>Ask about this subcategory</b>.</div>}
        </div>)}
    </div>
  )
}
