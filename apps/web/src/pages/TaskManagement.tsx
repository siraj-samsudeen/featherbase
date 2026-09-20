import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'

type View = 'inbox' | 'work' | 'projects' | 'personal'

interface Task {
  row_id: string
  task_title: string
  task_state: string
  is_done: boolean
  urgent: boolean
  project: string | null
  personal_tasks_owner: string | null
  assigned_to: string | null
  updated_at: string
}

interface Project {
  row_id: string
  project_name: string
}

interface TaskComment {
  ref_name: string
  content: string
  created_at: string
}

const TASK_FIELDS = [
  'row_id',
  'task_title',
  'task_state',
  'is_done',
  'urgent',
  'project',
  'personal_tasks_owner',
  'assigned_to',
  'created_at',
  'updated_at',
]

const STATES = ['Not started', 'In progress', 'Blocked', 'On hold', 'Done', 'Cancelled']
const FOCUS_SETTINGS = 'Task Management Focus'

export function TaskManagementPage() {
  const queryClient = useQueryClient()
  const me = getSessionUser()?.row_id ?? ''
  const [view, setView] = useState<View>('inbox')
  const [capture, setCapture] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectTask, setProjectTask] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [personalOwner, setPersonalOwner] = useState(me)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const tasks = useQuery({
    queryKey: ['task-management', 'tasks'],
    queryFn: () =>
      listResource<Task>('Team Task', {
        fields: TASK_FIELDS,
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })
  const projects = useQuery({
    queryKey: ['task-management', 'projects'],
    queryFn: () =>
      listResource<Project>('Team Project', {
        fields: ['row_id', 'project_name'],
        order_by: 'project_name asc',
        limit_page_length: 200,
      }),
  })
  const users = useQuery({
    queryKey: ['task-management', 'users'],
    queryFn: () =>
      listResource<{ row_id: string }>('User', {
        fields: ['row_id'],
        order_by: 'row_id asc',
        limit_page_length: 200,
      }),
  })
  const focus = useQuery({
    queryKey: ['task-management', 'focus'],
    queryFn: () =>
      api.get<{ settings: { task_ids?: string[] } | null }>(
        `/api/user_settings/${encodeURIComponent(FOCUS_SETTINGS)}`,
      ),
  })
  const comments = useQuery({
    queryKey: ['task-management', 'comments'],
    queryFn: () =>
      listResource<TaskComment>('Comment', {
        filters: [['ref_table', '=', 'Team Task']],
        fields: ['ref_name', 'content', 'created_at'],
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })

  const allTasks = tasks.data?.data ?? []
  const byId = new Map(allTasks.map((task) => [task.row_id, task]))
  const latestExplanation = new Map<string, string>()
  for (const comment of comments.data?.data ?? [])
    latestExplanation.set(comment.ref_name, comment.content)
  const focusIds = (focus.data?.settings?.task_ids ?? []).filter((id) => byId.has(id))
  const focusSet = new Set(focusIds)
  const inbox = allTasks.filter((task) => !task.project && !task.personal_tasks_owner)
  const focused = focusIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const myWork = [
    ...focused,
    ...allTasks.filter((task) => task.assigned_to === me && !focusSet.has(task.row_id)),
  ]
  const projectRows = allTasks.filter((task) => task.project === selectedProject)
  const personalRows = allTasks.filter((task) => task.personal_tasks_owner === personalOwner)
  const people = [...(users.data?.data ?? [])]
  if (me && !people.some((user) => user.row_id === me)) people.unshift({ row_id: me })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['task-management'] })
  }

  async function createTask(title: string, extra: Partial<Task> = {}) {
    const trimmed = title.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/save_row', {
        table: 'Team Task',
        row: { task_title: trimmed, ...extra },
      })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create task')
      throw err
    } finally {
      setSaving(false)
    }
  }

  async function patchTask(task: Task, patch: Partial<Task>) {
    setError(null)
    try {
      await api.patch(
        `/api/table/${encodeURIComponent('Team Task')}/${encodeURIComponent(task.row_id)}`,
        { ...patch, updated_at: task.updated_at },
      )
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update task')
    }
  }

  async function saveFocus(ids: string[]) {
    setError(null)
    queryClient.setQueryData(['task-management', 'focus'], { settings: { task_ids: ids } })
    try {
      await api.put(`/api/user_settings/${encodeURIComponent(FOCUS_SETTINGS)}`, { task_ids: ids })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update My Focus')
      await queryClient.invalidateQueries({ queryKey: ['task-management', 'focus'] })
    }
  }

  async function toggleFocus(id: string) {
    await saveFocus(focusSet.has(id) ? focusIds.filter((value) => value !== id) : [...focusIds, id])
  }

  async function moveFocus(id: string, offset: -1 | 1) {
    const from = focusIds.indexOf(id)
    const to = from + offset
    if (from < 0 || to < 0 || to >= focusIds.length) return
    const next = [...focusIds]
    ;[next[from], next[to]] = [next[to], next[from]]
    await saveFocus(next)
  }

  async function createProject() {
    const name = projectName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.post<Project>('/api/save_row', {
        table: 'Team Project',
        row: { project_name: name },
      })
      setProjectName('')
      setSelectedProject(saved.row_id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create project')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'inbox', label: 'Inbox', count: inbox.length },
    { id: 'work', label: 'My Work', count: myWork.length },
    { id: 'projects', label: 'Projects' },
    {
      id: 'personal',
      label: 'Personal tasks',
      count: allTasks.filter((task) => task.personal_tasks_owner === me).length,
    },
  ]

  return (
    <div className="mx-auto max-w-5xl" data-testid="task-management-page">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-brand)]">DWT team</p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">Tasks</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Capture first. Decide where it belongs when you are ready.</p>
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Task views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            aria-current={view === tab.id ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              view === tab.id
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {tab.label}{tab.count != null ? ` ${tab.count}` : ''}
          </button>
        ))}
      </nav>

      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {view === 'inbox' && (
        <section aria-labelledby="inbox-heading">
          <form
            className="fc-card mb-6 flex gap-2 p-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const title = capture
              try {
                await createTask(title)
                setCapture('')
              } catch { /* message is shown above */ }
            }}
          >
            <label className="sr-only" htmlFor="quick-capture">Quick capture</label>
            <input
              id="quick-capture"
              value={capture}
              onChange={(event) => setCapture(event.target.value)}
              placeholder="What do you need to remember?"
              className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15"
              autoFocus
            />
            <button className="fc-btn-primary" disabled={saving || !capture.trim()}>Add</button>
          </form>
          <SectionTitle id="inbox-heading" title="Inbox" hint="Unassigned ideas waiting for triage" />
          <TaskList tasks={inbox} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
        </section>
      )}

      {view === 'work' && (
        <section aria-labelledby="work-heading">
          <SectionTitle id="work-heading" title="My Work" hint="Your private focus order, followed by work assigned to you" />
          <TaskList tasks={myWork} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} onMove={moveFocus} />
        </section>
      )}

      {view === 'projects' && (
        <section aria-labelledby="projects-heading" className="grid gap-5 md:grid-cols-[15rem_1fr]">
          <div>
            <SectionTitle id="projects-heading" title="Projects" hint="Shared areas of work" />
            <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void createProject() }}>
              <label className="sr-only" htmlFor="project-name">Project name</label>
              <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="New project" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-sm" />
              <button className="fc-btn-primary" disabled={saving || !projectName.trim()}>Add</button>
            </form>
            <div className="space-y-1">
              {(projects.data?.data ?? []).map((project) => (
                <button key={project.row_id} type="button" onClick={() => setSelectedProject(project.row_id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedProject === project.row_id ? 'bg-[var(--color-brand-tint)] font-medium text-[var(--color-brand)]' : 'text-[var(--color-ink)] hover:bg-[var(--color-subtle)]'}`}>{project.project_name}</button>
              ))}
            </div>
          </div>
          <div>
            {selectedProject ? (
              <>
                <SectionTitle title={projects.data?.data.find((project) => project.row_id === selectedProject)?.project_name ?? selectedProject} hint="Tasks begin unassigned; someone can take responsibility when work starts" />
                <form className="mb-3 flex gap-2" onSubmit={async (event) => { event.preventDefault(); const title = projectTask; try { await createTask(title, { project: selectedProject }); setProjectTask('') } catch { /* shown above */ } }}>
                  <label className="sr-only" htmlFor="project-task">Add task to project</label>
                  <input id="project-task" value={projectTask} onChange={(event) => setProjectTask(event.target.value)} placeholder="Add a task, then press Enter" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" autoFocus />
                  <button className="fc-btn-primary" disabled={saving || !projectTask.trim()}>Add</button>
                </form>
                <TaskList tasks={projectRows} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
              </>
            ) : <Empty text="Choose a project, or create the first one." />}
          </div>
        </section>
      )}

      {view === 'personal' && (
        <section aria-labelledby="personal-heading">
          <SectionTitle id="personal-heading" title="Personal tasks" hint="Team-visible individual task lists" />
          <label className="mb-4 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            Show tasks for
            <select aria-label="Personal tasks owner" value={personalOwner} onChange={(event) => setPersonalOwner(event.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-ink)]">{people.map((user) => <option key={user.row_id}>{user.row_id}</option>)}</select>
          </label>
          <form className="fc-card mb-5 flex gap-2 p-3" onSubmit={async (event) => { event.preventDefault(); const title = capture; try { await createTask(title, { personal_tasks_owner: personalOwner }); setCapture('') } catch { /* shown above */ } }}>
            <label className="sr-only" htmlFor="personal-capture">Add personal task</label>
            <input id="personal-capture" value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="Add a personal task" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" autoFocus />
            <button className="fc-btn-primary" disabled={saving || !capture.trim()}>Add</button>
          </form>
          <TaskList tasks={personalRows} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
        </section>
      )}
    </div>
  )
}

function SectionTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return <div className="mb-3"><h2 id={id} className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>{hint && <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p>}</div>
}

function Empty({ text }: { text: string }) {
  return <div className="fc-card border-dashed px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">{text}</div>
}

function TaskList({ tasks, users, projects, focusSet, me, explanations, onPatch, onFocus, onMove }: {
  tasks: Task[]
  users: { row_id: string }[]
  projects: Project[]
  focusSet: Set<string>
  me: string
  explanations: Map<string, string>
  onPatch: (task: Task, patch: Partial<Task>) => Promise<void>
  onFocus: (id: string) => Promise<void>
  onMove?: (id: string, offset: -1 | 1) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [explaining, setExplaining] = useState<string | null>(null)
  const [explanation, setExplanation] = useState('')
  const [posting, setPosting] = useState(false)

  async function addExplanation(task: Task) {
    const content = explanation.trim()
    if (content) {
      setPosting(true)
      try {
        await api.post('/api/save_row', {
          table: 'Comment',
          row: { ref_table: 'Team Task', ref_name: task.row_id, content },
        })
        await queryClient.invalidateQueries({ queryKey: ['task-management', 'comments'] })
      } finally {
        setPosting(false)
      }
    }
    setExplanation('')
    setExplaining(null)
  }

  if (!tasks.length) return <Empty text="Nothing here yet." />
  return <div className="space-y-2">{tasks.map((task) => {
    const focused = focusSet.has(task.row_id)
    const inactive = ['Blocked', 'On hold', 'Cancelled'].includes(task.task_state)
    return (
      <article key={task.row_id} className={`fc-card flex items-start gap-3 px-3 py-3 ${task.is_done ? 'opacity-60' : ''}`}>
        <input aria-label={`Mark ${task.task_title} done`} type="checkbox" checked={Boolean(task.is_done)} onChange={(event) => void onPatch(task, { is_done: event.target.checked })} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/$table/$name" params={{ table: 'Team Task', name: task.row_id }} search={{ prefill: undefined }} className={`font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)] ${task.is_done ? 'line-through' : ''}`}>{task.task_title}</Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <select aria-label={`State for ${task.task_title}`} value={task.task_state ?? 'Not started'} onChange={(event) => { const taskState = event.target.value; void onPatch(task, { task_state: taskState }); if (['Blocked', 'On hold', 'Cancelled'].includes(taskState)) { setExplaining(task.row_id); setExplanation('') } }} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]">{STATES.map((state) => <option key={state}>{state}</option>)}</select>
            <select aria-label={`Destination for ${task.task_title}`} value={task.personal_tasks_owner ? `personal:${task.personal_tasks_owner}` : task.project ? `project:${task.project}` : ''} onChange={(event) => { const [kind, value] = event.target.value.split(':', 2); void onPatch(task, kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null }) }} className="max-w-52 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]"><option value="">Inbox</option><optgroup label="Projects">{projects.map((project) => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}</optgroup><optgroup label="Personal tasks">{users.map((user) => <option key={user.row_id} value={`personal:${user.row_id}`}>{user.row_id}</option>)}</optgroup></select>
            <select aria-label={`Assign ${task.task_title}`} value={task.assigned_to ?? ''} onChange={(event) => void onPatch(task, { assigned_to: event.target.value || null })} className="max-w-44 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]"><option value="">Unassigned</option>{users.map((user) => <option key={user.row_id} value={user.row_id}>{user.row_id}</option>)}</select>
            {!task.assigned_to && me && <button type="button" onClick={() => void onPatch(task, { assigned_to: me })} className="rounded border border-[var(--color-brand)] px-2 py-1 text-xs font-medium text-[var(--color-brand)] hover:bg-[var(--color-brand-tint)]">Take it</button>}
          </div>
          {explaining === task.row_id && (
            <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void addExplanation(task) }}>
              <label className="sr-only" htmlFor={`explain-${task.row_id}`}>Optional explanation</label>
              <input id={`explain-${task.row_id}`} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Optional explanation" autoFocus className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs" />
              <button className="fc-btn-primary" disabled={posting}>Save note</button>
              <button type="button" className="fc-btn" onClick={() => { setExplanation(''); setExplaining(null) }}>Skip</button>
            </form>
          )}
          {explaining !== task.row_id && inactive && explanations.get(task.row_id) && (
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]"><span className="font-medium">{task.task_state}:</span> {explanations.get(task.row_id)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label={`${task.urgent ? 'Remove urgent flag from' : 'Mark urgent'} ${task.task_title}`} aria-pressed={task.urgent} title="Urgent is visible to the team" onClick={() => void onPatch(task, { urgent: !task.urgent })} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition ${task.urgent ? 'border-red-300 bg-red-50 text-red-700' : 'border-transparent bg-[var(--color-subtle)] text-[var(--color-ink-muted)] hover:border-red-200 hover:text-red-700'}`}>{task.urgent && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-600" />}Urgent</button>
          <button type="button" aria-label={`${focused ? 'Remove from' : 'Add to'} My Focus: ${task.task_title}`} title="My Focus is private to you" onClick={() => void onFocus(task.row_id)} className={`rounded p-1 text-lg ${focused ? 'text-amber-500' : 'text-[var(--color-ink-faint)] hover:text-amber-500'}`}>{focused ? '★' : '☆'}</button>
          {onMove && focused && <><button type="button" aria-label={`Move ${task.task_title} up`} onClick={() => void onMove(task.row_id, -1)} className="rounded px-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]">↑</button><button type="button" aria-label={`Move ${task.task_title} down`} onClick={() => void onMove(task.row_id, 1)} className="rounded px-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]">↓</button></>}
        </div>
      </article>
    )
  })}</div>
}
