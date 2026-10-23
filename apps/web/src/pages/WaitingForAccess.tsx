import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { fmtInstantIST } from '../lib/inr'
import { DataList, type DataColumn } from '../components/ui'

// #429: people a sign-in rule let in who hold no role yet, and see only the
// no-access page. Opening one goes to their Person form to give roles.

export interface WaitingPerson {
  person: string
  full_name: string | null
  email_domain: string | null
  method: string | null
  method_label: string | null
  arrived_by: string | null
  first_sign_in: string | null
  last_sign_in: string | null
}

export const WAITING_QUERY_KEY = ['waiting-for-access'] as const
export const WAITING_COUNT_QUERY_KEY = ['waiting-for-access-count'] as const

const columns: DataColumn<WaitingPerson>[] = [
  {
    key: 'name',
    header: 'Name',
    phone: 'title',
    cell: (p) => (
      <Link
        to="/featherbase/admin/$table/$name"
        params={{ table: 'Person', name: p.person }}
        search={{ prefill: undefined }}
        className="text-action hover:underline"
        data-testid={`waiting-${p.person}`}
      >
        {p.full_name || p.person}
      </Link>
    ),
  },
  { key: 'domain', header: 'Email domain', phone: 'meta', cell: (p) => p.email_domain ?? '—' },
  { key: 'method', header: 'Arrived by', phone: 'meta', cell: (p) => p.method_label ?? 'Added by an administrator' },
  { key: 'first', header: 'First sign-in', cell: (p) => fmtInstantIST(p.first_sign_in) },
  { key: 'last', header: 'Last sign-in', cell: (p) => fmtInstantIST(p.last_sign_in) },
]

export function WaitingForAccess() {
  const q = useQuery({
    queryKey: WAITING_QUERY_KEY,
    queryFn: () => api.get<{ people: WaitingPerson[]; count: number }>('/api/people/waiting_for_access'),
  })
  return (
    <div className="space-y-4" data-testid="waiting-for-access">
      <div>
        <h1 className="text-lg font-semibold text-ink">Waiting for access</h1>
        <p className="text-sm text-ink-muted">
          People who signed in but hold no role yet, newest first. Open one to give them roles.
        </p>
      </div>
      <DataList
        caption="People waiting for access"
        rows={q.data?.people ?? []}
        columns={columns}
        rowKey={(p) => p.person}
        state={q.isPending ? 'loading' : q.isError ? 'error' : 'ready'}
        onRetry={() => void q.refetch()}
        empty={{ title: 'Nobody is waiting.', body: 'Someone who signs in without a role shows up here.' }}
      />
    </div>
  )
}
