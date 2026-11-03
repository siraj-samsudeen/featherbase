import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { COPY_CADENCES } from 'shared'
import { ApiError, api } from '../lib/api'
import { Button, Notice, Select } from './ui'

interface Schedule { row_id: string; cadence: string; enabled: boolean; last_outcome: string | null; last_result: string | null }

export function CopySchedule({ table }: { table: string }) {
  const client = useQueryClient()
  const schedule = useQuery({ queryKey: ['copy-schedule', table], queryFn: () => api.get<Schedule | null>(`/api/table/${encodeURIComponent(table)}:copy_schedule`) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = schedule.data

  async function save(cadence: string, enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/table/${encodeURIComponent(table)}:set_copy_schedule`, { cadence, enabled })
      await client.invalidateQueries()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The refresh schedule could not be saved')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2" data-testid="copy-schedule">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Refresh automatically
          <Select aria-label="Refresh automatically" disabled={busy || schedule.isPending || schedule.isError}
            value={current?.enabled ? current.cadence : 'off'}
            onChange={(e) => { const value = e.target.value; void save(value === 'off' ? current?.cadence ?? 'hourly' : value, value !== 'off') }}>
            <option value="off">Off</option>
            {COPY_CADENCES.map((cadence) => <option key={cadence} value={cadence}>{cadence[0].toUpperCase() + cadence.slice(1)}</option>)}
          </Select>
        </label>
        {current && <>
          <Button variant="secondary" disabled={busy} onClick={() => void save(current.cadence, !current.enabled)}>
            {current.enabled ? 'Pause' : 'Resume'}
          </Button>
          <Link to="/featherbase/admin/$table/$name" params={{ table: 'Scheduled Job', name: current.row_id }} search={{ prefill: undefined }} className="text-accent hover:underline">Manage job</Link>
          {!current.enabled && <span className="text-ink-muted">Paused · {current.cadence}</span>}
          {current.last_outcome && <span className="text-ink-muted">Last run: {current.last_outcome}{current.last_result ? ` · ${current.last_result}` : ''}</span>}
        </>}
      </div>
      {(error || schedule.isError) && <Notice tone="negative">{error ?? 'The refresh schedule could not be loaded'}</Notice>}
    </div>
  )
}
