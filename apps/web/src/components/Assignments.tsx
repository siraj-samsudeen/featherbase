import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'

interface ToDoRow {
  name: string
  allocated_to: string
  status: string
}

// EML-006 / UI-017: assign this document to a user. Creates a ToDo in their
// list and notifies them.
export function Assignments({ doctype, name }: { doctype: string; name: string }) {
  const queryClient = useQueryClient()
  const [assignTo, setAssignTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todos = useQuery({
    queryKey: ['assignments', doctype, name],
    queryFn: () =>
      listResource<ToDoRow>('ToDo', {
        filters: [
          ['reference_doctype', '=', doctype],
          ['reference_name', '=', name],
          ['status', '=', 'Open'],
        ],
        fields: ['name', 'allocated_to', 'status'],
        order_by: 'creation asc',
        limit_page_length: 50,
      }),
  })

  async function assign() {
    const to = assignTo.trim()
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/assign', { doctype, name, assign_to: to })
      setAssignTo('')
      await queryClient.invalidateQueries({ queryKey: ['assignments', doctype, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Assign failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fc-card p-4" data-testid="assignments-panel">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        Assigned To
      </div>
      <ul className="mb-2 space-y-1">
        {todos.data?.data.length === 0 && (
          <li className="text-xs text-[var(--color-ink-faint)]">No one assigned</li>
        )}
        {todos.data?.data.map((t) => (
          <li key={t.name} className="text-sm text-[var(--color-ink)]" data-testid="assignee">
            {t.allocated_to}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1">
        <input
          value={assignTo}
          onChange={(e) => setAssignTo(e.target.value)}
          placeholder="user@example.com"
          className="fc-input flex-1"
          data-testid="assign-to"
        />
        <button
          onClick={assign}
          disabled={busy || !assignTo.trim()}
          className="fc-btn-primary disabled:opacity-40"
          data-testid="assign-submit"
        >
          Assign
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-[var(--color-danger)]" data-testid="assign-error">
          {error}
        </p>
      )}
    </div>
  )
}
