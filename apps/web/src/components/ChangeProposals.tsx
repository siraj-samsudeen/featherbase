import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api } from '../lib/api'
import { PrincipalName } from '../lib/people'
import { useChangeFormat } from '../lib/change-format'
import { buttonClasses, cardClasses, fmtInstant, inputClasses, pillClasses } from '@featherbase/shop-floor'

// #627: a change an approval rule held for approval, and the people it waits for.

export interface ProposalChange {
  column_name: string
  original_value: string | null
  proposed_value: string | null
  review_base_value: string | null
}

export interface ProposalRequirement {
  key: string
  people: string[]
  roles: string[]
  approved_by: string | null
  approved_at: string | null
}

export interface RuleProposal {
  row_id: string
  target_table: string
  target_row: string | null
  operation: 'create' | 'update'
  maker: string
  state: 'Pending' | 'Needs fresh review' | 'Applied' | 'Rejected' | string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
  result_row: string | null
  created_at: string
  changes: ProposalChange[]
  waiting_for: ProposalRequirement[]
  /** The names of the people it names, as the server reads them for whoever may see it. */
  names?: Record<string, string>
  can_decide?: boolean
}

/** A person the proposal names, by the name it carries. */
function Person({ id, proposal }: { id: string; proposal: RuleProposal }) {
  const name = proposal.names?.[id]
  return name ? <span data-testid="principal-name">{name}</span> : <PrincipalName id={id} />
}

export const OPEN_STATES = ['Pending', 'Needs fresh review']
export const isOpen = (p: RuleProposal) => OPEN_STATES.includes(p.state)

export function rowProposalsQuery(table: string, name: string) {
  return {
    queryKey: ['row-proposals', table, name],
    queryFn: () =>
      api.get<{ proposals: RuleProposal[] }>(`/api/row_proposals/${encodeURIComponent(table)}/${encodeURIComponent(name)}`),
  }
}

export const WAITING_QUERY_KEY = ['change-proposals', 'waiting']

/** Who one requirement can be met by, as a person reads it. */
function Approvers({ requirement, proposal }: { requirement: ProposalRequirement; proposal: RuleProposal }) {
  const parts: React.ReactNode[] = [
    ...requirement.people.map((id) => <Person key={id} id={id} proposal={proposal} />),
    ...requirement.roles.map((role) => <span key={`role:${role}`}>anyone with the role {role}</span>),
  ]
  if (!parts.length) return <span>nobody</span>
  return <>{parts.flatMap((part, i) => (i === 0 ? [part] : [<span key={`or${i}`}> or </span>, part]))}</>
}

/** "Waiting for approval from Asha, and from anyone with the role Region Lead." */
export function WaitingFor({ proposal }: { proposal: RuleProposal }) {
  const pending = proposal.waiting_for.filter((w) => !w.approved_by)
  if (!pending.length) return null
  return (
    <span data-testid="proposal-waiting-for">
      Waiting for approval from{' '}
      {pending.map((w, i) => (
        <span key={w.key}>
          {i > 0 && (i === pending.length - 1 ? ', and from ' : ', from ')}
          <Approvers requirement={w} proposal={proposal} />
        </span>
      ))}
      .
    </span>
  )
}

/** The message a held save shows on the form. */
export function HeldNotice({ proposal, onDismiss }: { proposal: RuleProposal; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-md border border-caution/40 bg-caution-tint px-3 py-2 text-sm text-ink"
      data-testid="form-waiting"
    >
      <span>
        <span className="font-medium">
          {proposal.operation === 'create'
            ? `Your new ${proposal.target_table} row is waiting for approval.`
            : 'Your change is waiting for approval.'}
        </span>{' '}
        It is not made until it is approved. <WaitingFor proposal={proposal} />
      </span>
      <button onClick={onDismiss} className="text-xs underline">
        dismiss
      </button>
    </div>
  )
}

function stateTone(state: string) {
  if (state === 'Applied') return 'bg-positive-tint text-positive'
  if (state === 'Rejected') return 'bg-negative-tint text-negative'
  if (state === 'Needs fresh review') return 'bg-caution-tint text-caution'
  return 'bg-action-tint text-action'
}

/** One proposal: what it changes, who proposed it, who it waits for, and the decision buttons
 *  for a person who may decide it. */
export function ProposalCard({ proposal, showTarget = false, onDecided, beforeDecide }: {
  proposal: RuleProposal
  showTarget?: boolean
  onDecided?: (next: RuleProposal) => void
  /** Called just before a decision is sent: an approval changes the row, and the
   *  row's own page should not read that as someone else's change. */
  beforeDecide?: () => void
}) {
  const queryClient = useQueryClient()
  const format = useChangeFormat(proposal.target_table, '—')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fresh = proposal.state === 'Needs fresh review'
  const approved = proposal.waiting_for.filter((w) => w.approved_by)

  async function decide(kind: 'approve' | 'reject') {
    if (kind === 'reject' && !reason.trim()) {
      setError('Say why you are rejecting this')
      return
    }
    setBusy(true)
    setError(null)
    beforeDecide?.()
    try {
      const next = await api.post<RuleProposal>(
        `/api/change_proposals/${encodeURIComponent(proposal.row_id)}/${kind}`,
        kind === 'reject' ? { reason: reason.trim() } : {},
      )
      setRejecting(false)
      setReason('')
      await queryClient.invalidateQueries({ queryKey: ['row-proposals', proposal.target_table] })
      await queryClient.invalidateQueries({ queryKey: WAITING_QUERY_KEY })
      if (next.state === 'Applied') {
        await queryClient.invalidateQueries({ queryKey: ['doc', proposal.target_table] })
        await queryClient.invalidateQueries({ queryKey: ['list', proposal.target_table] })
        await queryClient.invalidateQueries({ queryKey: ['activity', proposal.target_table] })
      }
      onDecided?.(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work')
      await queryClient.invalidateQueries({ queryKey: ['row-proposals', proposal.target_table] })
      await queryClient.invalidateQueries({ queryKey: WAITING_QUERY_KEY })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-md border border-border bg-surface px-3 py-2 text-sm" data-testid="proposal" data-state={proposal.state}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span className={pillClasses(stateTone(proposal.state))} data-testid="proposal-state">
          {proposal.state === 'Pending' ? 'Waiting for approval' : proposal.state}
        </span>
        <span>
          <span className="font-medium text-ink" data-testid="proposal-maker"><Person id={proposal.maker} proposal={proposal} /></span>{' '}
          {proposal.operation === 'create' ? 'proposed a new row' : 'proposed a change'}
          {showTarget && (
            <>
              {' '}to{' '}
              {proposal.target_row ? (
                <RouterLink
                  to="/featherbase/admin/table/$table/row/$name"
                  params={{ table: proposal.target_table, name: proposal.target_row }}
                  search={{ prefill: undefined }}
                  className="text-action underline"
                  data-testid="proposal-target"
                >
                  {proposal.target_table} {proposal.target_row}
                </RouterLink>
              ) : (
                <span className="font-medium text-ink" data-testid="proposal-target">{proposal.target_table}</span>
              )}
            </>
          )}{' '}
          · <span className="whitespace-nowrap">{fmtInstant(proposal.created_at)}</span>
        </span>
      </div>
      <ul className="mt-1 space-y-0.5" data-testid="proposal-changes">
        {proposal.changes.map((c) => (
          <li key={c.column_name} className="[overflow-wrap:anywhere]" data-testid={`proposal-change-${c.column_name}`}>
            <span className="font-medium">{format.label(c.column_name)}</span>:{' '}
            {proposal.operation === 'create' ? (
              <span>{format.value(c.column_name, c.proposed_value)}</span>
            ) : fresh && c.review_base_value !== c.original_value ? (
              <span>
                was {format.value(c.column_name, c.original_value)} when proposed, now{' '}
                <span className="font-medium">{format.value(c.column_name, c.review_base_value)}</span> →{' '}
                {format.value(c.column_name, c.proposed_value)}
              </span>
            ) : (
              <span>
                {format.value(c.column_name, c.original_value)} → {format.value(c.column_name, c.proposed_value)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {fresh && (
        <p className="mt-1 text-xs text-caution" data-testid="proposal-fresh-review">
          This needs a fresh review: the row changed after it was proposed, so earlier approvals no longer count.
        </p>
      )}
      {isOpen(proposal) && (
        <p className="mt-1 text-xs text-ink-muted">
          {approved.map((w) => (
            <span key={w.key} className="mr-2" data-testid="proposal-approved-by">
              Approved by <Person id={w.approved_by!} proposal={proposal} />.
            </span>
          ))}
          <WaitingFor proposal={proposal} />
        </p>
      )}
      {proposal.state === 'Rejected' && (
        <p className="mt-1 text-xs text-ink-muted" data-testid="proposal-decision">
          Rejected by {proposal.decided_by ? <Person id={proposal.decided_by} proposal={proposal} /> : 'the platform'}
          {proposal.decided_at && <> · {fmtInstant(proposal.decided_at)}</>}
          {proposal.decision_reason && <span className="block whitespace-pre-wrap text-ink" data-testid="proposal-reason">Reason: {proposal.decision_reason}</span>}
        </p>
      )}
      {proposal.state === 'Applied' && (
        <p className="mt-1 text-xs text-ink-muted" data-testid="proposal-decision">
          Approved by {approved.map((w, i) => <span key={w.key}>{i > 0 && ', '}<Person id={w.approved_by!} proposal={proposal} /></span>)}
          {proposal.decided_at && <> · {fmtInstant(proposal.decided_at)}</>}
          {proposal.operation === 'create' && proposal.result_row && (
            <>
              {' '}·{' '}
              <RouterLink
                to="/featherbase/admin/table/$table/row/$name"
                params={{ table: proposal.target_table, name: proposal.result_row }}
                search={{ prefill: undefined }}
                className="text-action underline"
                data-testid="proposal-result-row"
              >
                open the new row
              </RouterLink>
            </>
          )}
        </p>
      )}
      {proposal.can_decide && isOpen(proposal) && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {!rejecting ? (
            <>
              <button onClick={() => decide('approve')} disabled={busy} className={buttonClasses({ variant: 'primary' })} data-testid="proposal-approve">
                {fresh ? 'Approve again' : 'Approve'}
              </button>
              <button onClick={() => { setRejecting(true); setError(null) }} disabled={busy} className={buttonClasses({ variant: 'danger' })} data-testid="proposal-reject">
                Reject
              </button>
            </>
          ) : (
            <form
              className="flex w-full flex-wrap items-start gap-2"
              onSubmit={(e) => { e.preventDefault(); void decide('reject') }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Why are you rejecting this?</span>
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why are you rejecting this?"
                  className={inputClasses()}
                  data-testid="proposal-reject-reason"
                />
              </label>
              <button type="submit" disabled={busy} className={buttonClasses({ variant: 'danger' })} data-testid="proposal-reject-send">
                Reject
              </button>
              <button type="button" onClick={() => { setRejecting(false); setError(null) }} className={buttonClasses({ variant: 'quiet' })}>
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-negative" data-testid="proposal-error">{error}</p>}
    </li>
  )
}

/** The proposals on one row: open ones in full, and the last few decided ones. */
export function PendingChanges({ table, name, beforeDecide }: { table: string; name: string; beforeDecide?: () => void }) {
  const q = useQuery(rowProposalsQuery(table, name))
  const proposals = q.data?.proposals ?? []
  if (!proposals.length) return null
  const open = proposals.filter(isOpen)
  const decided = proposals.filter((p) => !isOpen(p)).slice(0, 3)
  return (
    <section className={cardClasses('mb-3 p-3')} data-testid="pending-changes" aria-label="Changes waiting for approval">
      <h2 className="mb-2 text-xs font-semibold text-ink-subtle">
        {open.length ? `Waiting for approval (${open.length})` : 'Approval decisions'}
      </h2>
      <ul className="space-y-2">
        {open.map((p) => <ProposalCard key={p.row_id} proposal={p} beforeDecide={beforeDecide} />)}
        {decided.map((p) => <ProposalCard key={p.row_id} proposal={p} />)}
      </ul>
    </section>
  )
}
