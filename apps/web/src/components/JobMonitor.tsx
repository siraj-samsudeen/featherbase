import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, getSessionUser, listResource } from '../lib/api'
import { useRealtime } from '../lib/realtime'
import { buttonClasses, cardClasses } from '@featherbase/shop-floor'

// JOB-004: monitor background jobs and retry failed ones from the Admin UI.
// The Queue section of the Jobs page (#464).

interface Job {
  row_id: string
  method: string
  job_status: string
  attempts: number | string
  error: string | null
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  done: 'text-positive',
  refused: 'text-caution',
  failed: 'text-negative',
  running: 'text-action',
  queued: 'text-ink-muted',
}

export function JobMonitor() {
  const [busy, setBusy] = useState<string | null>(null)
  // JOB-005: live progress for a long-running job, over realtime.
  const user = getSessionUser()
  const [progress, setProgress] = useState<{ job: string; percent: number; message: string | null } | null>(null)
  useRealtime(user ? [`user:${user.row_id}`] : [], (e) => {
    if (e.event === 'job_progress') {
      const p = e.payload as { job: string; percent: number; message: string | null }
      setProgress(p)
    }
  })

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () =>
      listResource<Job>('Background Job', {
        fields: ['row_id', 'method', 'job_status', 'attempts', 'error', 'created_at'],
        order_by: 'created_at desc',
        limit_page_length: 100,
      }),
    refetchInterval: 3000, // live view
  })

  // #1362: the queue entry is done once the queue is finished with it; whether
  // its run refused to act is on its Job Execution row, so a refusal says so.
  const doneIds = (jobs.data?.data ?? []).filter((j) => j.job_status === 'done').map((j) => j.row_id)
  const refusals = useQuery({
    queryKey: ['jobs', 'refused', doneIds],
    enabled: doneIds.length > 0,
    queryFn: () =>
      listResource<{ job: string; result: string | null }>('Job Execution', {
        fields: ['job', 'result'],
        filters: [['job', 'in', doneIds], ['outcome', '=', 'refused']],
        limit_page_length: doneIds.length,
      }),
  })
  const refusedReason = new Map((refusals.data?.data ?? []).map((e) => [e.job, e.result]))

  async function retry(name: string) {
    setBusy(name)
    try {
      await api.post('/api/retry_job', { row_id: name })
      await jobs.refetch()
    } finally {
      setBusy(null)
    }
  }

  const rows = (jobs.data?.data ?? []).map((j) => refusedReason.has(j.row_id)
    ? { ...j, job_status: 'refused', error: refusedReason.get(j.row_id) || null }
    : j)

  return (
    <div data-testid="job-monitor" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Queue</h2>
      </div>

      {progress && (
        <div className={cardClasses('p-4')} data-testid="demo-progress">
          <div className="mb-1 flex justify-between text-xs text-ink-muted">
            <span>{progress.message ?? 'Working…'}</span>
            <span data-testid="demo-progress-percent">{progress.percent}%</span>
          </div>
          <div className="h-2 w-full rounded bg-subtle">
            <div
              className="h-2 rounded bg-action transition-all"
              style={{ width: `${progress.percent}%` }}
              data-testid="demo-progress-bar"
            />
          </div>
        </div>
      )}

      <div className={cardClasses('overflow-x-auto')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-ink-muted">
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">Error</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody data-testid="job-rows">
            {rows.map((j) => (
              <tr key={j.row_id} className="border-b border-border last:border-0" data-testid={`job-${j.row_id}`}>
                <td className="px-3 py-2 font-medium text-ink">{j.method}</td>
                <td className={`px-3 py-2 ${STATUS_STYLE[j.job_status] ?? ''}`} data-testid={`job-status-${j.row_id}`}>
                  {j.job_status}
                </td>
                <td className="px-3 py-2 text-ink-muted">{String(j.attempts)}</td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-ink-subtle" title={j.error ?? ''}>
                  {j.error ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {j.job_status === 'failed' && (
                    <button
                      className={buttonClasses()}
                      data-testid={`retry-${j.row_id}`}
                      disabled={busy === j.row_id}
                      onClick={() => void retry(j.row_id)}
                    >
                      {busy === j.row_id ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-subtle">
                  No jobs
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
