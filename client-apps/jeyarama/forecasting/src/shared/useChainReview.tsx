// What the managers' pages show besides the Run: the proposals and their decisions, the viewer's own changes, and the
// viewer's questions, keyed by the line's rowId (a manager sees many stores, where a name repeats). On a real Run each
// is saved through the server as the signed-in person (chainWrites.ts, #1442) and shown once it is saved; the made-up
// chain keeps them in memory. The same shapes as the Team Leader's (review.ts).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StatusPill } from '@featherbase/shop-floor'
import type { Line } from './model'
import type { Answer, ProposalActions, ProposalItem, Question, ReviewActions, ReviewState } from './review'
import type { Chain } from './chainData'
import { proposalPills } from './Proposals'
import { chainWrites, loadViewerState, type ChangeRow } from './chainWrites'

/** Who is acting on a real Run's page: the person (whose name the server checks) and the role the page is for. */
export interface Live { chain: Chain; person: string; role: string }

export function useChainReview(initial: ProposalItem[], live?: Live) {
  const real = Boolean(live?.chain.real && live.chain.runIds)
  const [proposals, setProposals] = useState(initial)
  const [state, setState] = useState<ReviewState>({ answers: {}, questions: [] })
  const [problem, setProblem] = useState<string | null>(null)
  const own = useMemo(() => new Map<string, ChangeRow>(), [live?.person])
  const lineAt = useMemo(() => new Map((live?.chain.lines ?? []).map(l => [l.rowId, l])), [live?.chain.lines])
  const writes = useMemo(() => (real && live ? chainWrites(live.person, live.role, live.chain.changes ?? new Map(), own, id => lineAt.get(id)) : null), [real, live?.person, live?.role, live?.chain, own, lineAt])

  // the viewer's own saved changes and questions
  useEffect(() => {
    if (!real || !live) return
    let gone = false
    loadViewerState(live.chain.runIds!, live.chain.lines, live.person).then(v => {
      if (gone) return
      for (const [k, r] of v.own) own.set(k, r)
      setState(v.state)
    }).catch(e => { if (!gone) setProblem(`Your changes and questions could not be read: ${(e as Error).message}`) })
    return () => { gone = true }
  }, [real, live?.chain, live?.person, own])

  /** Saves, then shows: a refused save leaves the page as it was and says why. */
  const saved = async (work: () => Promise<unknown>, then: () => void) => {
    if (!writes) { then(); return }
    try { await work(); setProblem(null); then() } catch (e) { setProblem(`Not saved: ${(e as Error).message}`) }
  }
  const set = (p: ProposalItem, patch: Partial<ProposalItem>) => setProposals(ps => ps.map(x => (x.id === p.id ? { ...x, ...patch } : x)))
  /** The page's own-change entry for a line, as the tables now hold it (the Store Manager's number in place of a proposal). */
  const ownFrom = (line: string) => setState(s => {
    const r = own.get(line), answers = { ...s.answers }
    if (r) answers[line] = { status: 'change_proposed', value: Number(r.changed_value_before_tax), reasons: [], note: r.explanation }
    else delete answers[line]
    return { ...s, answers }
  })
  const proposalActions: ProposalActions = {
    approve: (p, value) => void saved(() => writes!.approve(p, value), () => { set(p, { state: 'approved', final: value ?? p.proposed }); if (writes) ownFrom(p.line) }),
    sendBack: (p, reason) => void saved(() => writes!.sendBack(p, reason), () => set(p, { state: 'sent_back', backReason: reason })),
    undo: p => void saved(() => writes!.undo(p), () => { set(p, { state: 'waiting', final: undefined, backReason: undefined }); if (writes) ownFrom(p.line) }),
  }
  const answer = (l: Line, a: Answer) => setState(s => ({ ...s, answers: { ...s.answers, [l.rowId]: a } }))
  const actions: ReviewActions = {
    accept: async l => answer(l, { status: 'accepted', value: null, reasons: [], note: '' }),
    propose: (l, p) => saved(() => writes!.propose(l, p), () => answer(l, { status: 'change_proposed', value: p.value, reasons: p.reasons, note: p.note, change: p.change })),
    ask: async (l, text) => {
      let id = ''
      await saved(async () => { id = await writes!.ask(l, text) }, () => setState(s => ({ ...s,
        questions: [...s.questions, { id: id || `q${s.questions.length + 1}`, line: l.rowId, text, askedAt: new Date().toISOString(), answer: null, seen: false }] })))
    },
    seen: async rowId => {
      const fresh = state.questions.filter(q => q.line === rowId && q.answer && !q.seen)
      if (!fresh.length) return
      await saved(() => writes!.seen(fresh), () => setState(s => ({ ...s, questions: s.questions.map((q): Question => (q.line === rowId && q.answer ? { ...q, seen: true } : q)) })))
    },
  }
  const byLine = new Map(proposals.map(p => [p.line, p]))
  const proposalOf = (l: Line) => byLine.get(l.rowId)
  return {
    proposals, proposalOf, proposalActions, state, actions,
    /** Why the last save, or reading the viewer's own rows, failed; null when all is saved. */
    problem,
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
