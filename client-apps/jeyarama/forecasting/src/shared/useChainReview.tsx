// What the managers' pages show besides the Run, kept in memory while the made-up chain stands in for the app's
// tables (#1418 brings the copied Run): the proposals and their decisions, the viewer's own changes, and the
// viewer's questions. Keyed by the line's rowId (a manager sees many stores, where a name repeats). The same
// shapes as the Team Leader's (review.ts), so a page moves to the tables by swapping this hook.
import { useState, type ReactNode } from 'react'
import { StatusPill } from '@featherbase/shop-floor'
import type { Line } from './model'
import type { Answer, ProposalActions, ProposalItem, Question, ReviewActions, ReviewState } from './review'
import { proposalPills } from './Proposals'

export function useChainReview(initial: ProposalItem[]) {
  const [proposals, setProposals] = useState(initial)
  const [state, setState] = useState<ReviewState>({ answers: {}, questions: [] })
  const set = (p: ProposalItem, patch: Partial<ProposalItem>) => setProposals(ps => ps.map(x => (x.id === p.id ? { ...x, ...patch } : x)))
  const proposalActions: ProposalActions = {
    approve: (p, value) => set(p, { state: 'approved', final: value ?? p.proposed }),
    sendBack: (p, reason) => set(p, { state: 'sent_back', backReason: reason }),
    undo: p => set(p, { state: 'waiting', final: undefined, backReason: undefined }),
  }
  const answer = (l: Line, a: Answer) => setState(s => ({ ...s, answers: { ...s.answers, [l.rowId]: a } }))
  const actions: ReviewActions = {
    accept: async l => answer(l, { status: 'accepted', value: null, reasons: [], note: '' }),
    propose: async (l, p) => answer(l, { status: 'change_proposed', value: p.value, reasons: p.reasons, note: p.note, change: p.change }),
    ask: async (l, text) => setState(s => ({ ...s, questions: [...s.questions, { id: `q${s.questions.length + 1}`, line: l.rowId, text, askedAt: new Date().toISOString(), answer: null, seen: false }] })),
    seen: async rowId => setState(s => ({ ...s, questions: s.questions.map((q): Question => (q.line === rowId && q.answer ? { ...q, seen: true } : q)) })),
  }
  const byLine = new Map(proposals.map(p => [p.line, p]))
  const proposalOf = (l: Line) => byLine.get(l.rowId)
  return {
    proposals, proposalOf, proposalActions, state, actions,
    waiting: proposals.filter(p => p.state === 'waiting'),
    /** How many proposals wait among these lines. */
    waitingIn: (lines: Line[]) => lines.reduce((t, l) => t + (byLine.get(l.rowId)?.state === 'waiting' ? 1 : 0), 0),
    /** What approved changes and the viewer's own changes add to Feather Forecast among these lines. */
    approvedDelta: (lines: Line[]) => lines.reduce((t, l) => {
      const p = byLine.get(l.rowId), own = state.answers[l.rowId]
      if (own?.status === 'change_proposed' && own.value != null) return t + own.value - l.fc
      return t + (p?.state === 'approved' && p.final != null ? p.final - l.fc : 0)
    }, 0),
    /** A subcategory's pills: its proposal, the viewer's own change, an open question. */
    linePills: (l: Line, approver: boolean): ReactNode[] => {
      const out = proposalPills(byLine.get(l.rowId), approver)
      if (state.answers[l.rowId]?.status === 'change_proposed') out.push(<StatusPill key="own" tone="neutral" className="fr-pill">You changed it</StatusPill>)
      if (state.questions.some(q => q.line === l.rowId && !q.answer)) out.push(<StatusPill key="q" tone="caution" className="fr-pill">Question open</StatusPill>)
      return out
    },
  }
}
export type ChainReview = ReturnType<typeof useChainReview>
