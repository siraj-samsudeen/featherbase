import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Field, Notice, Select, TextInput, fmtDateTime } from '@featherbase/shop-floor'
import { api } from './api'
import type { RecurrenceSchedule } from './recurrence'

interface Series {
  row_id: string
  schedule_mode: RecurrenceSchedule['mode']
  interval: number
  anchor_date: string
  paused: boolean
  next_at: string | null
}
export function Recurrence({ task, onSaved }: {
  task: { row_id: string; updated_at: string; recurrence?: string | null; parent_task?: string | null }
  onSaved: () => Promise<void>
}) {
  const [mode, setMode] = useState<RecurrenceSchedule['mode']>('weekly')
  const [interval, setInterval] = useState('1')
  const [anchor, setAnchor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const series = useQuery({
    queryKey: ['task-management', 'recurrence', task.recurrence], enabled: Boolean(task.recurrence),
    refetchInterval: query => query.state.error ? 15000 : false,
    queryFn: () => api.get<Series>(`/api/table/tasker.recurrence/${encodeURIComponent(task.recurrence!)}`),
  })
  async function run(action: string, payload: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      await api.post(`/api/app_actions/tasker/${action}`, { idempotencyKey: crypto.randomUUID(), payload })
      await onSaved()
      if (task.recurrence) await series.refetch()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not change repeats') }
    finally { setBusy(false) }
  }
  if (task.parent_task) return null
  const unit = series.data?.schedule_mode === 'weekly' ? 'week' : series.data?.schedule_mode === 'monthly' ? 'month' : 'day'
  return <section aria-label="Recurring task" className="mt-5 rounded-card border border-border p-4">
    <h3 className="mb-3 text-sm font-semibold">Repeat</h3>
    {error && <Notice tone="negative">{error}</Notice>}
    {series.error && <Notice tone="negative">Could not load repeats: {series.error.message} <Button onClick={() => void series.refetch()}>Try again</Button></Notice>}
    {series.data ? <>
      <p className="text-sm">{series.data.paused ? 'Paused' : 'Repeats'} · every {series.data.interval} {unit}{series.data.interval === 1 ? '' : 's'}{series.data.schedule_mode === 'after_completion' ? ' after completion' : ''}</p>
      <p className="mt-2 text-sm text-ink-muted">{series.data.next_at ? `Next occurrence: ${fmtDateTime(new Date(series.data.next_at))}` : 'The next occurrence is scheduled after this task is finished.'}</p>
      <Button className="mt-3" disabled={busy} onClick={() => void run(series.data!.paused ? 'resume_recurrence' : 'pause_recurrence', { row_id: series.data!.row_id })}>{series.data.paused ? 'Resume repeats' : 'Pause repeats'}</Button>
    </> : !task.recurrence ? <details>
      <summary className="cursor-pointer text-sm text-action">Make this task recurring</summary>
      <form className="mt-3 grid gap-3" onSubmit={event => {
        event.preventDefault()
        void run('start_recurrence', { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: mode, interval: Number(interval), anchor_date: mode === 'after_completion' ? '1970-01-01' : anchor })
      }}>
        <Field label="Repeat by"><Select value={mode} onChange={event => setMode(event.target.value as RecurrenceSchedule['mode'])} disabled={busy}>
          <option value="daily">Fixed daily schedule</option><option value="weekly">Fixed weekly schedule</option><option value="monthly">Fixed monthly schedule</option><option value="after_completion">Days after completion</option>
        </Select></Field>
        <Field label="Every" hint={mode === 'after_completion' ? 'Days measured from the time you finish.' : 'Fixed schedules use the instance timezone.'}><TextInput type="number" min={1} max={365} required value={interval} onChange={event => setInterval(event.target.value)} disabled={busy} /></Field>
        {mode !== 'after_completion' && <Field label="Starting date" hint="Fixed repeats run at the beginning of the scheduled local day."><TextInput type="date" required value={anchor} onChange={event => setAnchor(event.target.value)} disabled={busy} /></Field>}
        <p className="text-sm text-ink-muted">One occurrence at a time. Fixed schedules skip missed dates while work remains open, then use the next future date after completion. New occurrences get fresh subtasks and their own discussion. Cancelling pauses the repeats.</p>
        <Button type="submit" variant="primary" disabled={busy}>Save repeats</Button>
      </form>
    </details> : <p className="text-sm text-ink-muted">Loading repeats…</p>}
  </section>
}
