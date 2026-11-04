import { TASK_STATES } from './task-states'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Notice, Select, TextInput, fmtCount } from '@featherbase/shop-floor'
import { api, listAllResources } from './api'
import { useMembers } from './discussions'

interface Subtask {
  row_id: string
  task_title: string
  task_state: string | null
  assigned_to: string | null
  updated_at: string
}
const states = TASK_STATES

export function Subtasks({ taskId, shared, creator, parentState, onOpen }: {
  taskId: string; shared: boolean; creator: string; parentState: string
  onOpen: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const members = useMembers()
  const [title, setTitle] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const children = useQuery({
    queryKey: ['task-management', 'subtasks', taskId],
    queryFn: () => listAllResources<Subtask>('tasker.task', {
      fields: ['row_id', 'task_title', 'task_state', 'assigned_to', 'updated_at'],
      filters: [['parent_task', '=', taskId]], order_by: 'created_at asc', limit_page_length: 200,
    }),
  })
  async function save(row: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      await api.post('/api/save_row', { table: 'tasker.task', row })
      await queryClient.invalidateQueries({ queryKey: ['task-management'] })
      return true
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save subtask'); return false }
    finally { setBusy(false) }
  }
  const rows = children.data?.data ?? []
  const done = rows.filter(row => row.task_state === 'Done').length
  const cancelled = rows.filter(row => row.task_state === 'Cancelled').length
  const people = (members.data?.data ?? []).filter(person => shared || person.row_id === creator)
  return <section aria-label="Subtasks" className="mt-6 space-y-3">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Subtasks</h3>
      <span className="text-sm text-ink-muted">{fmtCount(done)} of {fmtCount(rows.length)} done{cancelled > 0 ? ` · ${fmtCount(cancelled)} cancelled` : ''}</span>
    </div>
    {error && <Notice tone="negative">{error}</Notice>}
    {children.error && <Notice tone="negative">Could not load subtasks: {children.error.message}</Notice>}
    {!children.isPending && !children.error && rows.length === 0 && <p className="text-sm text-ink-muted">Break this task into smaller steps.</p>}
    {rows.map(row => <article key={row.row_id} className="space-y-2 rounded-control border border-border p-3">
      <button type="button" className="text-left font-semibold text-action underline-offset-2 hover:underline" onClick={() => onOpen(row.row_id)}>{row.task_title}</button>
      <div className="flex flex-wrap gap-2">
        <Select aria-label={`State for subtask ${row.task_title}`} value={row.task_state ?? 'Not started'} disabled={busy} onChange={event => { void save({ row_id: row.row_id, updated_at: row.updated_at, task_state: event.target.value }) }}>
          {states.map(state => <option key={state}>{state}</option>)}
        </Select>
        <Select aria-label={`Assign subtask ${row.task_title}`} value={row.assigned_to ?? ''} disabled={busy} onChange={event => { void save({ row_id: row.row_id, updated_at: row.updated_at, assigned_to: event.target.value || null }) }}>
          <option value="">Unassigned</option>{people.map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}
        </Select>
      </div>
    </article>)}
    {parentState === 'Done' ? <p className="text-sm text-ink-muted">Reopen this task before adding more steps.</p> : <form className="space-y-3" onSubmit={async event => {
      event.preventDefault()
      if (await save({ task_title: title.trim(), parent_task: taskId, assigned_to: assignedTo || null })) { setTitle(''); setAssignedTo('') }
    }}>
      <Field label="New subtask"><TextInput value={title} onChange={event => setTitle(event.target.value)} disabled={busy} required /></Field>
      <Field label="Subtask responsibility"><Select value={assignedTo} onChange={event => setAssignedTo(event.target.value)} disabled={busy}>
        <option value="">Unassigned</option>{people.map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}
      </Select></Field>
      <Button type="submit" disabled={busy || !title.trim()}>Add subtask</Button>
    </form>}
  </section>
}
