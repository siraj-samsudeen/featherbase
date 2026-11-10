import { STATES } from './task-states'
import { Button } from '@featherbase/shop-floor'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { personName } from './people'
import { ClosureNotes, ReasonForm } from './Closure'
import { SUBMITTED } from './verification'
import { TaskStoreAndDue } from './Stores'
import { localDay } from './storeWork'
import type { Project, Task } from './taskRows'
import { sameDocumentHash, savedViewHash } from './taskHash'

export function TaskList({ tasks, openChildren, users, projects, focusSet, me, explanations, onPatch, onFocus, onMove, savedViewId }: {
  tasks: Task[]
  openChildren: Map<string, number>
  users: { row_id: string; full_name?: string | null }[]
  projects: Project[]
  focusSet: Set<string>
  me: string
  explanations: Map<string, string>
  onPatch: (task: Task, patch: Partial<Task> & { change_reason?: string }) => Promise<void>
  onFocus: (id: string) => Promise<void>
  onMove?: (id: string, offset: -1 | 1) => Promise<void>
  savedViewId?: string
}) {
  const queryClient = useQueryClient()
  const today = localDay()
  const [explaining, setExplaining] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const nameOf = (person: string) => personName(users.find(user => user.row_id === person))
  const [explanation, setExplanation] = useState('')
  const [posting, setPosting] = useState(false)

  async function addExplanation(task: Task) {
    const content = explanation.trim()
    if (content) {
      setPosting(true)
      try {
        await api.post('/api/save_row', {
          table: 'Comment',
          row: { ref_table: 'tasker.task', ref_name: task.row_id, content },
        })
        await queryClient.invalidateQueries({ queryKey: ['task-management', 'comments'] })
      } finally {
        setPosting(false)
      }
    }
    setExplanation('')
    setExplaining(null)
  }

  return <div className="tasker-task-list">
    <div className="tasker-task-guide" aria-hidden="true">
      <span />
      <span>Task</span>
      <div className="tasker-task-metadata"><span>State</span><span>Destination</span><span>Responsibility</span></div>
      <span>Signals</span>
    </div>
    {tasks.map((task) => {
    const focused = focusSet.has(task.row_id)
    const inactive = ['Blocked', 'On hold'].includes(task.task_state)
    const awaitsVerifier = Boolean(task.verifier) && !task.is_done
    return (
      <article key={task.row_id} className={`tasker-task-row ${task.is_done ? 'is-done' : ''}`}>
        <input aria-label={`Mark ${task.task_title} done`} type="checkbox" disabled={(!task.is_done && Boolean(openChildren.get(task.row_id))) || awaitsVerifier} title={awaitsVerifier ? 'Its verifier closes this task. Submit it from the task details.' : openChildren.get(task.row_id) ? 'Finish or cancel the subtasks first' : undefined} checked={Boolean(task.is_done)} onChange={(event) => void onPatch(task, { is_done: event.target.checked })} className="tasker-task-checkbox" />
        <div className="tasker-task-copy">
          <a href={sameDocumentHash(savedViewId ? savedViewHash(savedViewId, task.row_id) : `#task=${encodeURIComponent(task.row_id)}`)} className={task.is_done ? 'line-through' : ''}>{task.task_title}</a>
          <TaskStoreAndDue task={task} today={today} />
          <ClosureNotes task={task} nameOf={nameOf} />
          {cancelling === task.row_id && <ReasonForm label="Reason for cancelling" action="Cancel task" onClose={() => setCancelling(null)}
            onSubmit={async (reason) => { await onPatch(task, { task_state: 'Cancelled', change_reason: reason }); setCancelling(null) }} />}
          {explaining === task.row_id && (
            <form className="tasker-explanation-form" onSubmit={(event) => { event.preventDefault(); void addExplanation(task) }}>
              <label className="sr-only" htmlFor={`explain-${task.row_id}`}>Optional explanation</label>
              <input id={`explain-${task.row_id}`} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Optional explanation" autoFocus className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 pointer-fine:text-xs" />
              <Button type="submit" variant="primary"  disabled={posting}>Save note</Button>
              <Button type="button"  onClick={() => { setExplanation(''); setExplaining(null) }}>Skip</Button>
            </form>
          )}
          {explaining !== task.row_id && inactive && explanations.get(task.row_id) && (
            <p className="tasker-task-explanation"><span>{task.task_state}:</span> {explanations.get(task.row_id)}</p>
          )}
        </div>
        <div className="tasker-task-metadata">
          <select data-state={task.task_state} aria-label={`State for ${task.task_title}`} value={task.task_state ?? 'Not started'} onChange={(event) => { const taskState = event.target.value; if (taskState === 'Cancelled') { setCancelling(task.row_id); return } void onPatch(task, { task_state: taskState }); if (['Blocked', 'On hold'].includes(taskState)) { setExplaining(task.row_id); setExplanation('') } }}>{STATES.map((state) => <option key={state} disabled={(state === 'Done' && awaitsVerifier) || (state === SUBMITTED && task.task_state !== SUBMITTED)}>{state}</option>)}</select>
          <select aria-label={`Destination for ${task.task_title}`} disabled={Boolean(task.parent_task)} value={!task.shared && task.personal_tasks_owner ? `personal:${task.personal_tasks_owner}` : task.project ? `project:${task.project}` : ''} onChange={(event) => { const [kind, value] = event.target.value.split(':', 2); void onPatch(task, kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null }) }}><option value="" disabled={task.shared}>{task.shared ? 'Shared work' : 'Inbox'}</option><optgroup label="Projects">{projects.map((project) => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}</optgroup><optgroup label="Personal tasks">{!task.shared && users.filter(user => user.row_id === me).map((user) => <option key={user.row_id} value={`personal:${user.row_id}`}>{personName(user)}</option>)}</optgroup></select>
          <div className="tasker-responsibility">
            <select aria-label={`Assign ${task.task_title}`} value={task.assigned_to ?? ''} onChange={(event) => void onPatch(task, { assigned_to: event.target.value || null })}><option value="">Unassigned</option>{users.filter(user => task.shared || user.row_id === me).map((user) => <option key={user.row_id} value={user.row_id}>{personName(user)}</option>)}</select>
            {!task.assigned_to && me && <Button type="button" onClick={() => void onPatch(task, { assigned_to: me })} className="tasker-take-button">Take it</Button>}
          </div>
        </div>
        <div className="tasker-task-signals">
          <Button type="button" aria-label={`${task.urgent ? 'Remove urgent flag from' : 'Mark urgent'} ${task.task_title}`} aria-pressed={task.urgent} title="Urgent is visible to the team" onClick={() => void onPatch(task, { urgent: !task.urgent })} className={`tasker-urgent ${task.urgent ? 'is-urgent' : ''}`}>{task.urgent && <span aria-hidden="true" />}{task.urgent ? 'Urgent' : 'Not urgent'}</Button>
          <Button type="button" aria-label={`${focused ? 'Remove from' : 'Add to'} My Focus: ${task.task_title}`} title="My Focus is private to you" onClick={() => void onFocus(task.row_id)} className={`tasker-focus-star ${focused ? 'is-focused' : ''}`}>{focused ? '★' : '☆'} <span>Focus</span></Button>
          {onMove && focused && <div className="tasker-focus-order"><Button type="button" aria-label={`Move ${task.task_title} up`} onClick={() => void onMove(task.row_id, -1)}>↑</Button><Button type="button" aria-label={`Move ${task.task_title} down`} onClick={() => void onMove(task.row_id, 1)}>↓</Button></div>}
        </div>
      </article>
    )
  })}
  </div>
}
