import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, fmtDateTime } from '@featherbase/shop-floor'
import { adminPageTitle } from 'shared'
import { api } from '../lib/api'
import { ListView } from '../components/ListView'
import type { Filter } from '../components/ListFilters'

/** #1271: the leaver job's state and when this list was checked (System Managers only). */
interface Status {
  leaver_job: { on: boolean; last_run_at: string | null; last_outcome: string | null; last_result: string | null } | null
  checked_at: string | null
}

export const LEAVER_STATUS_KEY = ['leaver-sign-in-status'] as const

/** The list header's line: whether the leaver job disables anyone, its last run, and when the list was checked. */
function StatusLine() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: LEAVER_STATUS_KEY, queryFn: () => api.get<Status>('/api/leaver_sign_in/status') })
  const refresh = useMutation({
    mutationFn: () => api.post('/api/leaver_sign_in/refresh', {}),
    // The rebuild runs as a job; read the list and the line again shortly.
    onSuccess: () => setTimeout(() => {
      void qc.invalidateQueries({ queryKey: LEAVER_STATUS_KEY })
      void qc.invalidateQueries({ queryKey: ['list', 'Leaver Sign In'] })
    }, 1500),
  })
  const s = status.data
  const job = s?.leaver_job
  const at = (iso: string | null) => (iso ? fmtDateTime(new Date(iso)) : 'never')
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted" data-testid="leaver-status">
      {s && (
        <span data-testid="leaver-job-line">
          Leaver job: <b className={job?.on ? 'font-medium text-positive' : 'font-medium text-caution'}>{job?.on ? 'On' : 'Off'}</b>
          {' · '}last run {at(job?.last_run_at ?? null)}
          {job?.last_result ? <> · {job.last_result}</> : null}
          {!job?.on && <> · nobody is disabled while it is off</>}
        </span>
      )}
      {s && <span data-testid="leaver-checked">Checked {at(s.checked_at)}</span>}
      <Button variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()} data-testid="leaver-refresh">
        {refresh.isPending || refresh.isSuccess ? 'Refreshing…' : 'Refresh Now'}
      </Button>
    </div>
  )
}

export function LeaversWhoCanSignIn({ filters, onFiltersChange }: { filters: Filter[]; onFiltersChange: (f: Filter[]) => void }) {
  return (
    <div data-testid="leavers-who-can-sign-in" className="h-full">
      <ListView
        table="Leaver Sign In"
        filters={filters}
        onFiltersChange={onFiltersChange}
        defaultOrderBy="left_on desc"
        title={adminPageTitle('leavers-who-can-sign-in')}
        breadcrumb={
          <div className="text-xs text-ink-subtle">
            <Link to="/featherbase/admin" className="hover:text-ink">Home</Link>
            {' / People and access'}
          </div>
        }
        subtitle={<StatusLine />}
        empty={<p className="text-sm text-ink-muted">Nobody who has left, or who is not an employee, can still sign in.</p>}
      />
    </div>
  )
}
