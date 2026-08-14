import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'

interface ToDoRow {
  row_id: string
  allocated_to: string
  todo_status: string
}

// EML-006 / UI-017: assign this row to a user. Creates a ToDo in their
// list and notifies them.
export function Assignments({ table, name }: { table: string; name: string }) {
  const queryClient = useQueryClient()
  const [assignTo, setAssignTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todos = useQuery({
    queryKey: ['assignments', table, name],
    queryFn: () =>
      listResource<ToDoRow>('ToDo', {
        filters: [
          ['ref_table', '=', table],
          ['reference_name', '=', name],
          ['todo_status', '=', 'Open'],
        ],
        fields: ['row_id', 'allocated_to', 'todo_status'],
        order_by: 'created_at asc',
        limit_page_length: 50,
      }),
  })

  async function assign() {
    const to = assignTo.trim()
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/assign', { table, row_id: name, assign_to: to })
      setAssignTo('')
      await queryClient.invalidateQueries({ queryKey: ['assignments', table, name] })
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
          <li key={t.row_id} className="text-sm text-[var(--color-ink)]" data-testid="assignee">
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
