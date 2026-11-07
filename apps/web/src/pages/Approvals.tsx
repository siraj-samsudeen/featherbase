import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { ProposalCard, WAITING_QUERY_KEY, type RuleProposal } from '../components/ChangeProposals'

// #627: what waits for this person's approval, changes and new rows alike, each
// with Approve and Reject. The approval email for a new row links here with
// ?proposal=<id>, which opens that proposal at the top whatever its state.

export const APPROVALS_TITLE = 'Waiting for your approval'

export function waitingQuery() {
  return {
    queryKey: WAITING_QUERY_KEY,
    queryFn: () => api.get<{ proposals: RuleProposal[] }>('/api/change_proposals/waiting'),
  }
}

export function Approvals({ proposal }: { proposal?: string }) {
  const waiting = useQuery(waitingQuery())
  const linked = useQuery({
    queryKey: [...WAITING_QUERY_KEY, 'one', proposal],
    enabled: Boolean(proposal),
    retry: false,
    queryFn: () => api.get<RuleProposal>(`/api/change_proposals/${encodeURIComponent(proposal!)}`),
  })
  const rest = (waiting.data?.proposals ?? []).filter((p) => p.row_id !== proposal)
  return (
    <div data-testid="approvals">
      <h1 className="text-xl font-semibold text-ink">{APPROVALS_TITLE}</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Changes and new rows that an approval rule holds until you approve them. Nothing changes until it is approved.
      </p>
      {proposal && linked.isError && (
        <p role="alert" className="mb-3 text-sm text-negative" data-testid="approvals-linked-error">
          {linked.error instanceof ApiError ? linked.error.message : 'That proposal could not be read.'}
        </p>
      )}
      {linked.data && (
        <ul className="mb-4" data-testid="approvals-linked">
          <ProposalCard proposal={linked.data} showTarget onDecided={() => void linked.refetch()} />
        </ul>
      )}
      {waiting.isError && <p role="alert" className="text-sm text-negative">What waits for you could not be read. Reload to retry.</p>}
      {waiting.isSuccess && !rest.length && !linked.data && (
        <p className="text-sm text-ink-subtle" data-testid="approvals-empty">Nothing waits for your approval.</p>
      )}
      {rest.length > 0 && (
        <ul className="space-y-2" data-testid="approvals-list">
          {rest.map((p) => <ProposalCard key={p.row_id} proposal={p} showTarget />)}
        </ul>
      )}
    </div>
  )
}
