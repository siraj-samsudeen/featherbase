import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { jobTitle } from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { fmtInstantIST } from '../lib/inr'
import { JobMonitor } from '../components/JobMonitor'
import { Button, DataList, Notice, StatusPill, cx, useMediaQuery, type DataColumn, type StatusTone } from '../components/ui'

// #464: the Jobs page. Every scheduled job in one list: an on/off switch, its
// schedule, its last run (time, OK / Failed / Refused and the one-line
// result) and Run now. Reads and writes go through the generic Table API, so
// the switch runs the Scheduled Job save rules (the queue is re-timed after
// the save commits) and Run now is an ordinary manual enqueue that never
// moves the schedule. The queue monitor (retry a failed job) sits below.

interface ScheduledJobRow {
  row_id: string
  method: string
  cadence: string
  enabled: boolean | number
  description: string | null
  last_run_at: string | null
  last_outcome: 'success' | 'error' | 'refused' | null
  last_result: string | null
  updated_at: string
}

interface LiveEntry {
  method: string
  run_at: string | null
  trigger: string | null
}

interface JobView extends ScheduledJobRow {
  nextRun: string | null
  /** A run someone asked for is still waiting or running. */
  pending: boolean
}

const OUTCOME: Record<string, { label: string; tone: StatusTone }> = {
  success: { label: 'OK', tone: 'positive' },
  error: { label: 'Failed', tone: 'negative' },
  refused: { label: 'Refused', tone: 'caution' },
}

const capitalised = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

async function loadJobs(): Promise<JobView[]> {
  const rows = (
    await listResource<ScheduledJobRow>('Scheduled Job', {
      fields: ['row_id', 'method', 'cadence', 'enabled', 'description', 'last_run_at', 'last_outcome', 'last_result', 'updated_at'],
      order_by: 'method asc',
      limit_page_length: 500,
    })
  ).data
  if (!rows.length) return []
  const live = (
    await listResource<LiveEntry>('Background Job', {
      filters: [
        ['method', 'in', rows.map((r) => r.method)],
        ['job_status', 'in', ['queued', 'running']],
      ],
      fields: ['method', 'run_at', 'trigger'],
      order_by: 'run_at asc',
      limit_page_length: 1000,
    })
  ).data
  return rows.map((r) => {
    const mine = live.filter((l) => l.method === r.method)
    return {
      ...r,
      nextRun: mine.find((l) => l.trigger === 'schedule' || l.trigger == null)?.run_at ?? null,
      pending: mine.some((l) => l.trigger === 'manual'),
    }
  })
}

function OnSwitch({ job, busy, onToggle }: { job: JobView; busy: boolean; onToggle: () => void }) {
  const on = Boolean(job.enabled)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Run ${jobTitle(job.method)} on its schedule`}
        disabled={busy}
        onClick={onToggle}
        className={cx(
          // The 44px tap target wraps a smaller track (item 11).
          'group inline-flex min-h-control items-center rounded-control max-sm:min-h-11',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none',
            on ? 'border-action bg-action' : 'border-border-control bg-subtle',
          )}
        >
          <span
            className={cx(
              'inline-block size-4 rounded-full transition-transform motion-reduce:transition-none',
              on ? 'translate-x-6 bg-action-ink' : 'translate-x-1 bg-border-control',
            )}
          />
        </span>
      </button>
      <span className={cx('text-control font-medium', on ? 'text-ink' : 'text-ink-muted')}>
        {busy ? 'Saving…' : on ? 'On' : 'Off'}
      </span>
    </span>
  )
}

function LastRun({ job }: { job: JobView }) {
  if (!job.last_run_at || !job.last_outcome) return <span className="text-ink-muted">Never run</span>
  const outcome = OUTCOME[job.last_outcome] ?? { label: capitalised(job.last_outcome), tone: 'neutral' as const }
  return (
    <div className="min-w-0 space-y-0.5 font-normal">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-testid="last-run-state">
          <StatusPill tone={outcome.tone}>{outcome.label}</StatusPill>
        </span>
        <span className="text-ink-muted">{fmtInstantIST(job.last_run_at)}</span>
      </div>
      {job.last_result && <p className="text-ink wrap-anywhere">{job.last_result}</p>}
    </div>
  )
}

export function Jobs() {
  const queryClient = useQueryClient()
  // What the last switch or Run now came to, shown above the list.
  const [notice, setNotice] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [asked, setAsked] = useState<Set<string>>(new Set())
  // The width at which DataList reads as cards: the switch then sits beside
  // the job's name rather than in a row of its own (item 11).
  const cards = useMediaQuery('(width < 40rem)')

  // A confirmation goes after a few seconds; a failure stays until the next try.
  useEffect(() => {
    if (notice?.tone !== 'positive') return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const jobs = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: loadJobs,
    // Item 10: quick while a run someone asked for is on its way.
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => j.pending) || asked.size ? 3000 : 30_000),
  })

  async function toggle(job: JobView) {
    const name = jobTitle(job.method)
    const on = !job.enabled
    setSaving(job.method)
    setNotice(null)
    try {
      await api.post('/api/save_row', {
        table: 'Scheduled Job',
        row: {
          row_id: job.row_id,
          method: job.method,
          cadence: job.cadence,
          enabled: on,
          description: job.description,
          updated_at: job.updated_at,
        },
      })
    } catch (err) {
      setNotice({
        tone: 'negative',
        text: `Could not switch ${name} ${on ? 'on' : 'off'}: ${err instanceof ApiError ? err.message : 'the save failed'}`,
      })
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] })
      setSaving(null)
    }
  }

  async function runNow(job: JobView) {
    const name = jobTitle(job.method)
    setAsked((s) => new Set(s).add(job.method))
    setNotice(null)
    try {
      await api.post('/api/enqueue_job', { method: job.method })
      setNotice({ tone: 'positive', text: `${name} queued` })
      await queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] })
    } catch (err) {
      setNotice({ tone: 'negative', text: `Could not run ${name}: ${err instanceof ApiError ? err.message : 'the request failed'}` })
    } finally {
      setAsked((s) => {
        const next = new Set(s)
        next.delete(job.method)
        return next
      })
    }
  }

  const columns: DataColumn<JobView>[] = [
    {
      key: 'job',
      header: 'Job',
      phone: 'title',
      cell: (j) => (
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-ink">{jobTitle(j.method)}</span>
            {cards && <OnSwitch job={j} busy={saving === j.method} onToggle={() => void toggle(j)} />}
          </div>
          {j.description && (
            <p className="mb-1 line-clamp-2 text-xs font-normal text-ink-muted sm:mb-0" title={j.description}>
              {j.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'on',
      header: 'On',
      phone: 'hidden',
      cell: (j) => <OnSwitch job={j} busy={saving === j.method} onToggle={() => void toggle(j)} />,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      phone: 'meta',
      cell: (j) => (
        <span className="whitespace-nowrap">
          <span className="text-ink">{capitalised(j.cadence)}</span>
          <span className="block text-ink-muted">
            {j.enabled ? (j.nextRun ? `Next run ${fmtInstantIST(j.nextRun)}` : 'Next run not queued yet') : 'Not scheduled'}
          </span>
        </span>
      ),
    },
    { key: 'last', header: 'Last run', cell: (j) => <LastRun job={j} /> },
    {
      key: 'run',
      header: <span className="sr-only">Run now</span>,
      align: 'end',
      cell: (j) => {
        const queued = j.pending || asked.has(j.method)
        return (
          <Button
            aria-label={`Run ${jobTitle(j.method)} now`}
            disabled={queued}
            onClick={() => void runNow(j)}
            className="whitespace-nowrap max-sm:min-h-11"
          >
            {queued ? 'Queued' : 'Run now'}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="space-y-6" data-testid="jobs-page">
      <div>
        <h1 className="text-lg font-semibold text-ink">Jobs</h1>
        <p className="text-sm text-ink-muted">
          Scheduled jobs run on their own. A run that fails or refuses emails every System Manager.
        </p>
        <p className="text-sm text-ink-muted">Switching a job on queues a run immediately.</p>
      </div>
      <section aria-labelledby="scheduled-jobs-heading" className="space-y-2">
        <h2 id="scheduled-jobs-heading" className="text-base font-semibold text-ink">Scheduled jobs</h2>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <DataList
          caption="Scheduled jobs"
          rows={jobs.data ?? []}
          columns={columns}
          rowKey={(j) => j.method}
          rowTestId={(j) => `scheduled-job-${j.method}`}
          state={jobs.isPending ? 'loading' : jobs.isError && !jobs.data ? 'error' : 'ready'}
          error="The scheduled jobs could not be loaded."
          onRetry={() => void jobs.refetch()}
          empty={{ title: 'No scheduled jobs', body: 'A job runs on a schedule once it has a Scheduled Job row.' }}
        />
      </section>
      <section>
        <JobMonitor />
      </section>
    </div>
  )
}
