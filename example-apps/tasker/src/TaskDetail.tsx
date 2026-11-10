import { STATES } from './task-states'
import { Recurrence } from './RecurrenceControls'
import { Subtasks } from './Subtasks'
import { Discussion } from './Discussion'
import { Button, buttonClasses } from '@featherbase/shop-floor'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rowHref } from '../../../packages/shared/src/app-routes'
import { fmtDate, fmtDateTime } from '@featherbase/shop-floor'
import { api, getSessionUser, listAllResources } from './api'
import { personName, type PersonOption } from './people'
import { Markdown } from './Markdown'
import { describeHistoryValue } from './history'
import { TaskActions } from './TaskActions'
import { ReasonForm, VerificationPanel } from './Closure'
import { SUBMITTED } from './verification'
import { dueNote, useStores } from './Stores'
import { calendarDay, dueMark, localDay } from './storeWork'
import type { Project, Task } from './taskRows'
import { hashSavedViewId, sameDocumentHash, savedViewHash } from './taskHash'

export type DetailMode = 'compact' | 'inspector' | 'focus'

export interface TaskComment {
  author_name?: string
  ref_name: string
  content: string
  created_by: string
  created_at: string
}

interface TaskVersion {
  author_name?: string
  ref_name: string
  data: { changed?: [string, unknown, unknown][] } | null
  created_by: string
  created_at: string
}

export function TaskDetail({ id, mode, onMode, onSaved, people, projects, onCompleted }: {
  id: string
  mode: DetailMode
  onMode: (mode: DetailMode) => Promise<void>
  onSaved: () => Promise<void>
  people: PersonOption[]
  projects: Project[]
  onCompleted: (projectId?: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const stores = useStores()
  const task = useQuery({ queryKey: ['task-management', 'detail', id],
    queryFn: () => api.get<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`),
    retry: false,
  })
  const parent = useQuery({ queryKey: ['task-management', 'parent', task.data?.parent_task],
    enabled: Boolean(task.data?.parent_task),
    queryFn: () => api.get<Task>(`/api/table/tasker.task/${encodeURIComponent(task.data!.parent_task!)}`),
  })
  const effectiveShared = Boolean(task.data?.parent_task ? parent.data?.shared : task.data?.shared)
  const childProgress = useQuery({ queryKey: ['task-management', 'subtasks', id], enabled: Boolean(task.data && !task.data.parent_task),
    queryFn: () => listAllResources<{ row_id: string; task_title: string; task_state: string | null; assigned_to: string | null; updated_at: string }>('tasker.task', {
      fields: ['row_id', 'task_title', 'task_state', 'assigned_to', 'updated_at'], filters: [['parent_task', '=', id]], order_by: 'created_at asc', limit_page_length: 200,
    }),
  })
  const unfinishedChildren = (childProgress.data?.data ?? []).filter(child => !['Done', 'Cancelled'].includes(String(child.task_state)))
  const completionBlocked = Boolean(!task.data?.is_done && !task.data?.parent_task && (childProgress.isPending || childProgress.error || unfinishedChildren.length))

  const taskActivity = useQuery({
    queryKey: ['task-management', 'detail-activity', id],
    queryFn: () => api.get<{ comments: TaskComment[]; versions: TaskVersion[] }>(
      `/api/activity/tasker.task/${encodeURIComponent(id)}`,
    ),
  })
  const [draft, setDraft] = useState<{ task_title: string; description: string; updated_at: string } | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const detail = useRef<HTMLElement>(null)
  const me = getSessionUser()?.row_id ?? ''
  function cancelDraft() {
    setDraft(null); setError('')
    requestAnimationFrame(() => editButton.current?.focus())
  }
  const [reasonFor, setReasonFor] = useState<{ kind: 'cancel' } | { kind: 'due'; due: string | null } | null>(null)
  const nameOf = (person: string) => personName(people.find(user => user.row_id === person))
  async function patch(patch: Record<string, unknown>, updatedAt: string): Promise<boolean> {
    setSaving(true); setError('')
    try {
      await api.patch(`/api/table/tasker.task/${encodeURIComponent(id)}`, { ...patch, updated_at: updatedAt })
      await onSaved()
      return true
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update task'); return false }
    finally { setSaving(false) }
  }
  useEffect(() => {
    setDraft(null)
    setError('')
    setReasonFor(null)
  }, [id])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (!new URLSearchParams(location.hash.slice(1)).has('question'))
      detail.current?.querySelector<HTMLElement>('a, button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [id, mode])
  useEffect(() => {
    if (mode !== 'inspector') return
    if (!window.matchMedia) return
    const compact = window.matchMedia('(max-width: 1100px)')
    const sync = () => document.documentElement.classList.toggle('tasker-compact-inspector-open', compact.matches)
    sync()
    compact.addEventListener('change', sync)
    return () => {
      compact.removeEventListener('change', sync)
      document.documentElement.classList.remove('tasker-compact-inspector-open')
    }
  }, [mode])

  const activity = [
    ...(taskActivity.data?.comments ?? []).map((entry) => ({ kind: 'comment' as const, at: entry.created_at, who: entry.author_name ?? 'Unknown person', content: entry.content })),
    ...(taskActivity.data?.versions ?? []).map((entry) => ({ kind: 'version' as const, at: entry.created_at, who: entry.author_name ?? 'Unknown person', changes: entry.data?.changed ?? [] })),
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
  const latestActivity = activity.at(-1)

  return <section ref={detail} className="tasker-detail" aria-label="Task detail content" onKeyDown={(event) => {
    if (event.key === 'Escape') {
      if (draft && !saving) cancelDraft()
      else if (!saving) location.hash = hashSavedViewId() ? savedViewHash(hashSavedViewId()!) : ''
    }
    if (event.key === 'Tab' && (mode === 'focus' || (mode === 'inspector' && window.matchMedia?.('(max-width: 1100px)').matches))) {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], summary, button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="tasker-detail-toolbar">
      <a href={sameDocumentHash(hashSavedViewId() ? savedViewHash(hashSavedViewId()!) : '#')} className={buttonClasses({ className: "" })} autoFocus>Close</a>
      <div className="tasker-mode-switch" aria-label="Task detail view">
        {([['compact', 'Compact'], ['inspector', 'Inspector'], ['focus', 'Focus']] as [DetailMode, string][]).map(([value, label]) =>
          <Button key={value} type="button" aria-pressed={mode === value} onClick={() => void onMode(value)}>{label}</Button>)}
      </div>
    </div>
    <h2 className="my-5 text-xl font-semibold">{task.data?.task_title ?? 'Task details'}</h2>
    {task.error && <p role="alert">{task.error.message} <Button disabled={task.isFetching} onClick={() => void task.refetch()}>Try again</Button></p>}
    {task.isPending && <p role="status">Loading task…</p>}
    {error && <p role="alert">{error}</p>}
    <TaskActions key={id} task={task.data ?? { row_id: id, updated_at: '' }} disabled={!task.data || Boolean(task.error) || saving || Boolean(draft)} onCompleted={onCompleted} />
    {task.data && !task.error && <>
      <fieldset className="tasker-detail-controls" disabled={saving || Boolean(draft)}>
        <legend className="sr-only">Task workflow</legend>
        <label>State<select aria-label="Task state" value={task.data.task_state} onChange={(event) => { if (event.target.value === 'Cancelled') setReasonFor({ kind: 'cancel' }); else void patch({ task_state: event.target.value }, task.data.updated_at) }}>{STATES.map(state => <option key={state} disabled={(state === 'Done' && (completionBlocked || Boolean(task.data.verifier && task.data.task_state !== 'Done'))) || (state === SUBMITTED && task.data.task_state !== SUBMITTED)}>{state}</option>)}</select></label>
        <label>Responsibility<select aria-label="Task responsibility" value={task.data.assigned_to ?? ''} onChange={(event) => void patch({ assigned_to: event.target.value || null }, task.data.updated_at)}>
          <option value="">Unassigned</option>{people.filter(user => effectiveShared || user.row_id === me).map(user => <option key={user.row_id} value={user.row_id}>{personName(user)}</option>)}
        </select></label>
        <label>Destination<select disabled={Boolean(task.data.parent_task)} aria-label="Task destination" value={!effectiveShared && task.data.personal_tasks_owner ? `personal:${task.data.personal_tasks_owner}` : task.data.project ? `project:${task.data.project}` : ''} onChange={(event) => {
          const [kind, value] = event.target.value.split(':', 2)
          void patch(kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null }, task.data.updated_at)
        }}><option value="" disabled={effectiveShared}>{effectiveShared ? 'Shared work' : 'Inbox'}</option>{projects.map(project => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}
          {!effectiveShared && !task.data.parent_task && people.filter(user => user.row_id === me).map(user => <option key={user.row_id} value={`personal:${user.row_id}`}>Personal: {personName(user)}</option>)}
        </select></label>
        <label>Store<select aria-label="Task store" disabled={Boolean(task.data.parent_task)} title={task.data.parent_task ? 'A subtask belongs to its parent’s store' : undefined} value={task.data.store ?? ''} onChange={(event) => void patch({ store: event.target.value || null }, task.data.updated_at)}>
          <option value="">No store</option>{stores.map(store => <option key={store.row_id} value={store.row_id}>{store.store_name}</option>)}
          {task.data.store && !stores.some(store => store.row_id === task.data.store) && <option value={task.data.store}>Unavailable store</option>}
        </select></label>
        <label>Start date<input type="date" value={calendarDay(task.data.start_date) ?? ''} onChange={(event) => void patch({ start_date: event.target.value || null }, task.data.updated_at)} /></label>
        <label>Due date<input type="date" value={calendarDay(task.data.due_date) ?? ''} min={calendarDay(task.data.start_date) ?? undefined} onChange={(event) => { const due = event.target.value || null; if (task.data.due_date && due !== calendarDay(task.data.due_date)) setReasonFor({ kind: 'due', due }); else void patch({ due_date: due }, task.data.updated_at) }} /></label>
        {dueNote(task.data, localDay()) && <p className="tasker-due-note" data-mark={dueMark(task.data, localDay()) ?? undefined}>{dueNote(task.data, localDay())}</p>}
        <div className="tasker-detail-signals">
          {!task.data.assigned_to && <Button type="button"  onClick={() => void patch({ assigned_to: me }, task.data.updated_at)}>Take it</Button>}
          <Button type="button"  aria-pressed={task.data.urgent} onClick={() => void patch({ urgent: !task.data.urgent }, task.data.updated_at)}>{task.data.urgent ? 'Urgent' : 'Not urgent'}</Button>
          {(!task.data.verifier || task.data.is_done) && <Button type="button" disabled={completionBlocked} onClick={() => void patch({ is_done: !task.data.is_done }, task.data.updated_at)}>{task.data.is_done ? 'Undo Done' : 'Mark Done'}</Button>}
        </div>
      </fieldset>
      {reasonFor?.kind === 'cancel' && <ReasonForm label="Reason for cancelling" action="Cancel task" onClose={() => setReasonFor(null)}
        onSubmit={async (reason) => { if (await patch({ task_state: 'Cancelled', change_reason: reason }, task.data.updated_at)) setReasonFor(null) }} />}
      {reasonFor?.kind === 'due' && <ReasonForm label="Reason for moving the due date" action="Move due date" note={reasonFor.due ? `Move the due date from ${fmtDate(calendarDay(task.data.due_date))} to ${fmtDate(reasonFor.due)}` : 'Remove the due date'} onClose={() => setReasonFor(null)}
        onSubmit={async (reason) => { if (await patch({ due_date: reasonFor.due, change_reason: reason }, task.data.updated_at)) setReasonFor(null) }} />}
      <VerificationPanel task={task.data} shared={effectiveShared} me={me} people={people} disabled={saving || Boolean(draft)} nameOf={nameOf} onPatch={(values) => patch(values, task.data.updated_at)} />
      {completionBlocked && <p className="mt-3 text-sm text-ink-muted">{unfinishedChildren.length ? 'Finish or cancel the open subtasks before marking this task Done.' : childProgress.error ? 'Subtasks could not be checked. Reopen this task to try again.' : 'Checking subtasks…'}</p>}
      {mode === 'compact' ? <div className="tasker-compact-summary">
        <Markdown>{task.data.description || 'No description yet.'}</Markdown>
        {latestActivity && <p className="mt-3 border-l-2 border-[var(--color-border)] pl-3 pointer-fine:text-xs text-[var(--color-ink-muted)]">
          Latest: {latestActivity.kind === 'comment' ? latestActivity.content : 'Task fields changed'}
        </p>}
        <p className="mt-3 pointer-fine:text-xs text-[var(--color-ink-muted)]">Open Inspector to edit or join the discussion.</p>
      </div> : <>
      {draft ? <form className="tasker-description-editor" onSubmit={async (event) => {
        // Keep the draft's original revision even if another action refetches this row.
        event.preventDefault(); setSaving(true); setError('')
        try {
          const saved = await api.patch<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`, {
            ...draft, task_title: draft.task_title.trim(),
          })
          queryClient.setQueryData(['task-management', 'detail', id], saved)
          await onSaved()
          await queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-activity', id] })
          cancelDraft()
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not save') }
        finally { setSaving(false) }
      }}>
        <label className="block pointer-fine:text-sm mb-3">Task title
          <input autoFocus className="mt-2 w-full rounded border border-[var(--color-border)] p-3"
            disabled={saving} value={draft.task_title}
            onChange={(event) => setDraft({ ...draft, task_title: event.target.value })} />
        </label>
        <label className="block pointer-fine:text-sm">Description
          <textarea className="mt-2 w-full rounded border border-[var(--color-border)] p-3" rows={4} disabled={saving}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary"  disabled={saving || !draft?.task_title.trim()}>Save task</Button>
          <Button type="button"  disabled={saving || !draft} onClick={cancelDraft}>Cancel changes</Button>
        </div>
      </form> : <div className="tasker-description-read">
        <div className="tasker-description-heading"><h3>Description</h3>
          <Button ref={editButton} type="button"  onClick={() => setDraft({ task_title: task.data.task_title, description: task.data.description ?? '', updated_at: task.data.updated_at })}>Edit task</Button>
        </div>
        <Markdown>{task.data.description || 'No description yet. Add context when it helps.'}</Markdown>
      </div>}

      {task.data.parent_task && <a className="text-action underline" href={sameDocumentHash(`#task=${encodeURIComponent(task.data.parent_task)}`)}>Open parent task</a>}
      {!task.data.parent_task && <Subtasks taskId={id} shared={task.data.shared} creator={task.data.created_by} parentState={task.data.task_state} onOpen={childId => { location.hash = `task=${encodeURIComponent(childId)}` }} />}
      {!task.data.parent_task && <Recurrence task={task.data} onSaved={onSaved} />}
      <p className="mt-4 text-sm text-ink-muted">{effectiveShared ? 'Shared with your team' : 'Only you can see this task'}</p>
      <Discussion key={id} taskId={id} shared={effectiveShared} />
      <div className="mt-7 border-t border-[var(--color-border)] pt-5">
        <h3 className="mb-3 pointer-fine:text-sm font-semibold">Activity history</h3>
        {taskActivity.error && <p role="alert">Could not load discussion and history: {taskActivity.error.message}</p>}

        {!activity.length && <p className="pointer-fine:text-xs text-[var(--color-ink-subtle)]">No discussion or changes yet.</p>}
        <ol className="space-y-4" data-testid="task-activity">
          {activity.map((entry, index) => <li key={`${entry.kind}-${entry.at}-${index}`} className="border-l-2 border-[var(--color-border)] pl-3 pointer-fine:text-sm">
            <p className="pointer-fine:text-xs text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">{entry.who}</strong> {entry.kind === 'comment' ? 'commented' : 'edited'} · {fmtDateTime(new Date(entry.at))}</p>
            {entry.kind === 'comment'
              ? <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
              : <ul className="mt-1 pointer-fine:text-xs text-[var(--color-ink-muted)]">{entry.changes.length ? entry.changes.map(([field, from, to], changeIndex) => <li key={changeIndex}><strong>{field.replaceAll('_', ' ')}</strong>: {describeHistoryValue(field, from, { people, projects })} → {describeHistoryValue(field, to, { people, projects })}</li>) : <li>Task updated</li>}</ul>}
          </li>)}
        </ol>
        <a className="mt-6 block pointer-fine:text-xs text-[var(--color-action)]" href={rowHref('tasker.task', id)}>Attachments and advanced fields in Featherbase ↗</a>
      </div>
      </>}
    </>}
  </section>
}
