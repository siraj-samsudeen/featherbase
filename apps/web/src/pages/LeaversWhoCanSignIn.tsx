import { useEffect, useState } from 'react'
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
  /** The last rebuild's summary; it names a leaver-job plan that could not be read or would refuse. */
  checked_result: string | null
  /** The latest rebuild attempt, when it failed after the last success: the rows shown are older. */
  last_failed: { at: string; error: string | null } | null
}

export const LEAVER_STATUS_KEY = ['leaver-sign-in-status'] as const

/** The list header's line: whether the leaver job disables anyone, its last run, and when the list was checked. */
function StatusLine() {
  const qc = useQueryClient()
  // While a requested rebuild runs: the "Checked" time it started from. The
  // line is read again until that time moves on, then the list is read again.
  const [waitingSince, setWaitingSince] = useState<{ checked: string | null; failed: string | null } | undefined>(undefined)
  const waiting = waitingSince !== undefined
  const status = useQuery({
    queryKey: LEAVER_STATUS_KEY,
    queryFn: () => api.get<Status>('/api/leaver_sign_in/status'),
    refetchInterval: waiting ? 1500 : false,
  })
  const refresh = useMutation({
    mutationFn: () => api.post('/api/leaver_sign_in/refresh', {}),
    onMutate: () => setWaitingSince({ checked: status.data?.checked_at ?? null, failed: status.data?.last_failed?.at ?? null }),
    onError: () => setWaitingSince(undefined),
  })
  const checkedAt = status.data?.checked_at ?? null
  const failedAt = status.data?.last_failed?.at ?? null
  useEffect(() => {
    // Done when a rebuild succeeded (a new Checked time) or a new attempt failed.
    if (!waitingSince || (checkedAt === waitingSince.checked && failedAt === waitingSince.failed)) return
    setWaitingSince(undefined)
    void qc.invalidateQueries({ queryKey: ['list', 'Leaver Sign In'] })
  }, [waitingSince, checkedAt, failedAt, qc])
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
      {s && (
        <span data-testid="leaver-checked">
          Checked {at(s.checked_at)}
          {s.checked_result ? <> · {s.checked_result}</> : null}
        </span>
      )}
      {s?.last_failed && (
        <span className="text-caution" data-testid="leaver-refresh-failed">
          The rebuild at {at(s.last_failed.at)} failed{s.last_failed.error ? `: ${s.last_failed.error}` : ''}. These rows are from the last one that worked.
        </span>
      )}
      <Button variant="secondary" disabled={waiting} onClick={() => refresh.mutate()} data-testid="leaver-refresh">
        {waiting ? 'Refreshing…' : 'Refresh Now'}
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
        defaultOrderBy="position asc"
        title={adminPageTitle('leavers-who-can-sign-in')}
        breadcrumb={
          <div className="text-xs text-ink-subtle">
            <Link to="/featherbase/admin" className="hover:text-ink">Home</Link>
            {' / People and access'}
          </div>
        }
        subtitle={<StatusLine />}
        empty={<p className="text-sm text-ink-muted">Nobody is listed. The line above says if anything could not be checked.</p>}
      />
    </div>
  )
}
