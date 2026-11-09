import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'
import { useCanReadTable } from '../lib/session'
import { ShownName } from '../lib/people'
import { buttonClasses, cardClasses, inputClasses } from '@featherbase/shop-floor'

interface ToDoRow {
  row_id: string
  allocated_to: string
  todo_status: string
}

// EML-006 / UI-017: assign this row to a user. Creates a ToDo in their
// list and notifies them.
export function Assignments({ table, name, readOnly }: { table: string; name: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const [assignTo, setAssignTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // #861: only ask for ToDo rows when this person's role may read them.
  const canRead = useCanReadTable('ToDo')
  const todos = useQuery({
    enabled: canRead === true,
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

  if (readOnly && canRead === false) return null
  if (readOnly && todos.data?.data.length === 0) return null

  return (
    <div className={cardClasses('p-4')} data-testid="assignments-panel">
      <div className="mb-2 text-xs font-semibold text-ink-subtle">
        Assigned to
      </div>
      {todos.isError && <p role="alert" className="text-sm text-negative">Assignments could not be read.</p>}
      <ul className="mb-2 space-y-1">
        {todos.data?.data.length === 0 && (
          <li className="text-xs text-ink-subtle">No one assigned</li>
        )}
        {todos.data?.data.map((t) => (
          <li key={t.row_id} className="text-sm text-ink" data-testid="assignee">
            <ShownName id={t.allocated_to} />
          </li>
        ))}
      </ul>
      {!readOnly && <div className="flex items-center gap-1">
        <input
          value={assignTo}
          onChange={(e) => setAssignTo(e.target.value)}
          placeholder="user@example.com"
          aria-label="Assign to (email address)"
          className={inputClasses('flex-1')}
          data-testid="assign-to"
        />
        <button
          onClick={assign}
          disabled={busy || !assignTo.trim()}
          className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
          data-testid="assign-submit"
        >
          Assign
        </button>
      </div>}
      {error && (
        <p className="mt-1 text-xs text-negative" data-testid="assign-error">
          {error}
        </p>
      )}
    </div>
  )
}
