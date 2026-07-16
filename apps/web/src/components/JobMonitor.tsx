import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, getSessionUser, listResource } from '../lib/api'
import { useRealtime } from '../lib/realtime'

// JOB-004: monitor background jobs and retry failed ones from the Desk.

interface Job {
  name: string
  method: string
  status: string
  attempts: number | string
  error: string | null
  creation: string
}

const STATUS_STYLE: Record<string, string> = {
  done: 'text-[var(--color-good)]',
  failed: 'text-[var(--color-danger)]',
  running: 'text-[var(--color-brand)]',
  queued: 'text-[var(--color-ink-muted)]',
}

export function JobMonitor() {
  const [busy, setBusy] = useState<string | null>(null)
  // JOB-005: live progress for a demo long-running job, over realtime.
  const user = getSessionUser()
  const [progress, setProgress] = useState<{ job: string; percent: number; message: string | null } | null>(null)
  useRealtime(user ? [`user:${user.name}`] : [], (e) => {
    if (e.event === 'job_progress') {
      const p = e.payload as { job: string; percent: number; message: string | null }
      setProgress(p)
    }
  })

  async function runDemo() {
    setProgress({ job: 'pending', percent: 0, message: 'Starting…' })
    const res = await api.post<{ name: string }>('/api/enqueue_job', { method: 'demo_progress' })
    setProgress({ job: res.name, percent: 0, message: 'Queued' })
  }

  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () =>
      listResource<Job>('Background Job', {
        fields: ['name', 'method', 'status', 'attempts', 'error', 'creation'],
        order_by: 'creation desc',
        limit_page_length: 100,
      }),
    refetchInterval: 3000, // live view
  })

  async function retry(name: string) {
    setBusy(name)
    try {
      await api.post('/api/retry_job', { name })
      await jobs.refetch()
    } finally {
      setBusy(null)
    }
  }

  const rows = jobs.data?.data ?? []

  return (
    <div data-testid="job-monitor" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Background Jobs</h1>
        <button className="fc-btn" data-testid="run-demo-job" onClick={() => void runDemo()}>
          Run demo job
        </button>
      </div>

      {progress && (
        <div className="fc-card p-4" data-testid="demo-progress">
          <div className="mb-1 flex justify-between text-xs text-[var(--color-ink-muted)]">
            <span>{progress.message ?? 'Working…'}</span>
            <span data-testid="demo-progress-percent">{progress.percent}%</span>
          </div>
          <div className="h-2 w-full rounded bg-[var(--color-subtle)]">
            <div
              className="h-2 rounded bg-[var(--color-brand)] transition-all"
              style={{ width: `${progress.percent}%` }}
              data-testid="demo-progress-bar"
            />
          </div>
        </div>
      )}

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-muted)]">
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">Error</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody data-testid="job-rows">
            {rows.map((j) => (
              <tr key={j.name} className="border-b border-[var(--color-border)] last:border-0" data-testid={`job-${j.name}`}>
                <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{j.method}</td>
                <td className={`px-3 py-2 ${STATUS_STYLE[j.status] ?? ''}`} data-testid={`job-status-${j.name}`}>
                  {j.status}
                </td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{String(j.attempts)}</td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-[var(--color-ink-faint)]" title={j.error ?? ''}>
                  {j.error ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {j.status === 'failed' && (
                    <button
                      className="fc-btn"
                      data-testid={`retry-${j.name}`}
                      disabled={busy === j.name}
                      onClick={() => void retry(j.name)}
                    >
                      {busy === j.name ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--color-ink-faint)]">
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
