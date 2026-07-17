import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'

interface WorkflowStatus {
  workflow: string | null
  state?: string
  actions?: { action: string; next_state: string }[]
}

// WF-002: current workflow state + transition buttons for the roles the
// user holds. Server enforces the transition, so these buttons are just a
// convenience over /api/apply_workflow_action.
export function WorkflowActions({ doctype, name }: { doctype: string; name: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = useQuery({
    queryKey: ['workflow', doctype, name],
    queryFn: () =>
      api.get<WorkflowStatus>(
        `/api/workflow/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      ),
  })

  if (!status.data?.workflow) return null

  async function apply(action: string) {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/apply_workflow_action', { doctype, name, action })
      await queryClient.invalidateQueries({ queryKey: ['workflow', doctype, name] })
      await queryClient.invalidateQueries({ queryKey: ['doc', doctype, name] })
      await queryClient.invalidateQueries({ queryKey: ['list', doctype] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Transition failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex items-center gap-2" data-testid="workflow-actions">
      <span
        className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand)]"
        data-testid="workflow-state"
      >
        {status.data.state}
      </span>
      {status.data.actions?.map((a) => (
        <button
          key={a.action}
          onClick={() => apply(a.action)}
          disabled={busy}
          data-testid={`workflow-action-${a.action}`}
          className="fc-btn-primary disabled:opacity-40"
        >
          {a.action}
        </button>
      ))}
      {error && (
        <span className="text-xs text-[var(--color-danger)]" data-testid="workflow-error">
          {error}
        </span>
      )}
    </span>
  )
}
