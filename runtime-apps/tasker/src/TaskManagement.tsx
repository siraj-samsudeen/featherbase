import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser, listResource } from './api'

type View = 'inbox' | 'work' | 'together' | 'projects' | 'personal'
type DetailMode = 'compact' | 'inspector' | 'focus'

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
  updated_at: string
}

interface TaskComment {
  ref_name: string
  content: string
  created_by: string
  created_at: string
}

interface TaskVersion {
  ref_name: string
  data: { changed?: [string, unknown, unknown][] } | null
  created_by: string
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
const PROJECT_SETTINGS = 'tasker.projects'
const PREFERENCE_SETTINGS = 'tasker.preferences'

function hashTaskId() {
  return new URLSearchParams(location.hash.slice(1)).get('task')
}

export function peopleWithTaskResponsibility(
  listed: { row_id: string }[],
  tasks: Pick<Task, 'assigned_to'>[],
  currentUser: string,
) {
  const people = [...listed]
  for (const rowId of [currentUser, ...tasks.map((task) => task.assigned_to ?? '')]) {
    if (rowId && !people.some((person) => person.row_id === rowId)) people.push({ row_id: rowId })
  }
  return people
}

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
  const [selectedTask, setSelectedTask] = useState(hashTaskId)

  useEffect(() => {
    const change = () => setSelectedTask(hashTaskId())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])

  const tasks = useQuery({
    queryKey: ['task-management', 'tasks'],
    queryFn: () =>
      listResource<Task>('tasker.task', {
        fields: TASK_FIELDS,
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })
  const projects = useQuery({
    queryKey: ['task-management', 'projects'],
    queryFn: () =>
      listResource<Project>('tasker.project', {
        fields: ['row_id', 'project_name', 'updated_at'],
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
  const projectPreferences = useQuery({
    queryKey: ['task-management', 'project-preferences'],
    queryFn: () => api.get<{ settings: { project_ids?: string[] } | null }>(
      `/api/user_settings/${encodeURIComponent(PROJECT_SETTINGS)}`,
    ),
  })
  const detailPreferences = useQuery({
    queryKey: ['task-management', 'detail-preferences'],
    queryFn: () => api.get<{ settings: { mode?: DetailMode } | null }>(
      `/api/user_settings/${encodeURIComponent(PREFERENCE_SETTINGS)}`,
    ),
  })
  const comments = useQuery({
    queryKey: ['task-management', 'comments'],
    queryFn: () =>
      listResource<TaskComment>('Comment', {
        filters: [['ref_table', '=', 'tasker.task']],
        fields: ['ref_name', 'content', 'created_by', 'created_at'],
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })

  const allTasks = tasks.data?.data ?? []
  const byId = new Map(allTasks.map((task) => [task.row_id, task]))
  const latestExplanation = new Map<string, string>()
  for (const comment of comments.data?.data ?? [])
    latestExplanation.set(comment.ref_name, comment.content)
  // @spec stale_focus_self_heals
  const focusIds = (focus.data?.settings?.task_ids ?? []).filter((id) => byId.has(id))
  const focusSet = new Set(focusIds)
  // @spec inbox_is_destination
  const inbox = allTasks.filter((task) => !task.project && !task.personal_tasks_owner)
  const focused = focusIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  // @spec my_work_has_no_duplicates
  const myWork = [
    ...focused,
    ...allTasks.filter((task) => task.assigned_to === me && !focusSet.has(task.row_id)),
  ]
  const projectRows = allTasks.filter((task) => task.project === selectedProject)
  const personalRows = allTasks.filter((task) => task.personal_tasks_owner === personalOwner)
  const allProjects = projects.data?.data ?? []
  const projectById = new Map(allProjects.map((project) => [project.row_id, project]))
  const starredProjectIds = (projectPreferences.data?.settings?.project_ids ?? []).filter((id) => projectById.has(id))
  const starredProjectSet = new Set(starredProjectIds)
  const detailMode = detailPreferences.data?.settings?.mode ?? 'inspector'
  const people = peopleWithTaskResponsibility(users.data?.data ?? [], allTasks, me)

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['task-management'] })
  }

  async function createTask(title: string, extra: Partial<Task> = {}) {
    // @spec lightweight_project_entry
    const trimmed = title.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/save_row', {
        table: 'tasker.task',
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
        `/api/table/tasker.task/${encodeURIComponent(task.row_id)}`,
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
      // @spec focus_is_private_ordered
      // @spec focus_never_mutates_task
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

  async function saveStarredProjects(ids: string[]) {
    setError(null)
    queryClient.setQueryData(['task-management', 'project-preferences'], { settings: { project_ids: ids } })
    try {
      // @spec project_tabs_are_private_ordered
      await api.put(`/api/user_settings/${encodeURIComponent(PROJECT_SETTINGS)}`, { project_ids: ids })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update project tabs')
      await queryClient.invalidateQueries({ queryKey: ['task-management', 'project-preferences'] })
    }
  }

  async function toggleProjectStar(id: string) {
    await saveStarredProjects(starredProjectSet.has(id)
      ? starredProjectIds.filter((value) => value !== id)
      : [...starredProjectIds, id])
  }

  async function moveProjectStar(id: string, offset: -1 | 1) {
    const from = starredProjectIds.indexOf(id)
    const to = from + offset
    if (from < 0 || to < 0 || to >= starredProjectIds.length) return
    const next = [...starredProjectIds]
    ;[next[from], next[to]] = [next[to], next[from]]
    await saveStarredProjects(next)
  }

  async function setDetailMode(mode: DetailMode) {
    queryClient.setQueryData(['task-management', 'detail-preferences'], { settings: { mode } })
    try {
      // @spec task_detail_has_three_modes
      await api.put(`/api/user_settings/${encodeURIComponent(PREFERENCE_SETTINGS)}`, { mode })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save detail view')
      await queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-preferences'] })
    }
  }

  async function renameProject(project: Project, project_name: string) {
    setError(null)
    try {
      // @spec project_name_is_correctable
      await api.patch(`/api/table/tasker.project/${encodeURIComponent(project.row_id)}`, {
        project_name, updated_at: project.updated_at,
      })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename project')
      throw err
    }
  }

  async function createProject() {
    // @spec lightweight_project_entry
    const name = projectName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.post<Project>('/api/save_row', {
        table: 'tasker.project',
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
    { id: 'together', label: 'Together' },
    { id: 'projects', label: 'Projects' },
    {
      id: 'personal',
      label: 'Personal tasks',
      count: allTasks.filter((task) => task.personal_tasks_owner === me).length,
    },
  ]

  return (
    <div className="tasker-shell" data-testid="task-management-page">
      <aside className="tasker-sidebar">
        <a href="/admin" className="text-xs text-[var(--color-ink-muted)]">← Featherbase</a>
        <h1 className="mt-5 text-2xl font-semibold">Tasker</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Team workspace</p>
      <nav aria-label="Task views">
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
      </aside>
      <main className="tasker-main">
      {starredProjectIds.length > 0 && (
        <div className="tasker-project-tabs" aria-label="Starred projects">
          {starredProjectIds.map((id) => (
            <button key={id} type="button" aria-current={view === 'projects' && selectedProject === id ? 'page' : undefined}
              onClick={() => { setSelectedProject(id); setView('projects') }}>
              {projectById.get(id)?.project_name}
            </button>
          ))}
        </div>
      )}
      <p className="mb-6 text-sm text-[var(--color-ink-muted)]">Capture first. Decide where it belongs when you are ready.</p>
      {tasks.error && <p role="alert" className="mb-4">{tasks.error.message} · <a href="/admin">Back to Featherbase</a></p>}
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {selectedTask && detailMode === 'compact' && (
        <div className="tasker-compact-detail">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} />
        </div>
      )}

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

      {view === 'together' && (
        <section aria-labelledby="together-heading">
          <SectionTitle id="together-heading" title="Together" hint="Active work grouped by who has responsibility" />
          {[null, ...people.map((person) => person.row_id)].map((owner) => {
            const rows = allTasks.filter((task) => task.assigned_to === owner && !['Done', 'Cancelled'].includes(task.task_state))
            if (!rows.length) return null
            return <div key={owner ?? 'unassigned'} className="mb-7">
              <h3 className="mb-2 text-sm font-semibold">{owner ?? 'Unassigned'} <span className="font-normal text-[var(--color-ink-muted)]">{rows.length}</span></h3>
              {/* @spec together_groups_active_responsibility */}
              <TaskList tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            </div>
          })}
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
              {allProjects.map((project) => (
                <div key={project.row_id} className={`flex items-center rounded-md ${selectedProject === project.row_id ? 'bg-[var(--color-brand-tint)]' : 'hover:bg-[var(--color-subtle)]'}`}>
                  <button type="button" onClick={() => setSelectedProject(project.row_id)} className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm ${selectedProject === project.row_id ? 'font-medium text-[var(--color-brand)]' : 'text-[var(--color-ink)]'}`}>{project.project_name}</button>
                  <button type="button" aria-label={`${starredProjectSet.has(project.row_id) ? 'Unstar' : 'Star'} project ${project.project_name}`} onClick={() => void toggleProjectStar(project.row_id)} className={`px-1 text-base ${starredProjectSet.has(project.row_id) ? 'text-amber-500' : 'text-[var(--color-ink-faint)]'}`}>{starredProjectSet.has(project.row_id) ? '★' : '☆'}</button>
                  {starredProjectSet.has(project.row_id) && <>
                    <button type="button" aria-label={`Move project ${project.project_name} left`} onClick={() => void moveProjectStar(project.row_id, -1)} className="px-1 text-xs text-[var(--color-ink-muted)]">←</button>
                    <button type="button" aria-label={`Move project ${project.project_name} right`} onClick={() => void moveProjectStar(project.row_id, 1)} className="px-1 text-xs text-[var(--color-ink-muted)]">→</button>
                  </>}
                </div>
              ))}
            </div>
          </div>
          <div>
            {selectedProject && projectById.has(selectedProject) ? (
              <>
                <ProjectHeading project={projectById.get(selectedProject)!} onRename={renameProject} />
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
      </main>
      {selectedTask && detailMode === 'inspector' && (
        <aside className="tasker-inspector" aria-label="Task details">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} />
        </aside>
      )}
      {selectedTask && detailMode === 'focus' && (
        <div className="tasker-focus-detail" role="dialog" aria-label="Focused task details">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} />
        </div>
      )}
    </div>
  )
}

function SectionTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return <div className="mb-3"><h2 id={id} className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>{hint && <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p>}</div>
}

function ProjectHeading({ project, onRename }: { project: Project; onRename: (project: Project, name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.project_name)
  useEffect(() => setName(project.project_name), [project.project_name])
  if (editing) return <form className="mb-3 flex gap-2" onSubmit={async (event) => {
    event.preventDefault()
    const next = name.trim()
    if (!next) return
    try { await onRename(project, next); setEditing(false) } catch { /* parent shows error */ }
  }}>
    <label className="sr-only" htmlFor="rename-project">Project name</label>
    <input id="rename-project" aria-label="Rename project" autoFocus value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-base font-semibold" />
    <button className="fc-btn-primary" disabled={!name.trim()}>Save</button>
    <button type="button" className="fc-btn" onClick={() => { setName(project.project_name); setEditing(false) }}>Cancel</button>
  </form>
  return <div className="mb-3 flex items-start justify-between gap-3">
    <SectionTitle title={project.project_name} hint="Tasks begin unassigned; someone can take responsibility when work starts" />
    <button type="button" className="fc-btn" onClick={() => setEditing(true)}>Rename</button>
  </div>
}

function TaskDetail({ id, mode, onMode, onSaved }: {
  id: string
  mode: DetailMode
  onMode: (mode: DetailMode) => Promise<void>
  onSaved: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const task = useQuery({ queryKey: ['task-management', 'detail', id],
    queryFn: () => api.get<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`),
  })
  const taskActivity = useQuery({
    queryKey: ['task-management', 'detail-activity', id],
    queryFn: () => api.get<{ comments: TaskComment[]; versions: TaskVersion[] }>(
      `/api/activity/tasker.task/${encodeURIComponent(id)}`,
    ),
  })
  const [description, setDescription] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
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
    ...(taskActivity.data?.comments ?? []).map((entry) => ({ kind: 'comment' as const, at: entry.created_at, who: entry.created_by, content: entry.content })),
    ...(taskActivity.data?.versions ?? []).map((entry) => ({ kind: 'version' as const, at: entry.created_at, who: entry.created_by, changes: entry.data?.changed ?? [] })),
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
  const latestActivity = activity.at(-1)
  const formatValue = (value: unknown) => value == null || value === '' ? 'empty' : String(value)

  return <section className="tasker-detail" aria-label="Task detail content" onKeyDown={(event) => {
    if (event.key === 'Escape') location.hash = ''
  }}>
    <div className="tasker-detail-toolbar">
      <a href="#" className="fc-btn" autoFocus>Close</a>
      <div className="tasker-mode-switch" aria-label="Task detail view">
        {([['compact', 'Compact'], ['inspector', 'Inspector'], ['focus', 'Focus']] as [DetailMode, string][]).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => void onMode(value)}>{label}</button>)}
      </div>
    </div>
    <h2 className="my-5 text-xl font-semibold">{task.data?.task_title ?? 'Task details'}</h2>
    {task.error && <p role="alert">{task.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    {task.data && <>
      <p className="mb-5 text-sm text-[var(--color-ink-muted)]">{task.data.task_state} · {task.data.assigned_to ?? 'Unassigned'}</p>
      {mode === 'compact' ? <div className="tasker-compact-summary">
        <p className="whitespace-pre-wrap text-sm">{task.data.description || 'No description yet.'}</p>
        {latestActivity && <p className="mt-3 border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-ink-muted)]">
          Latest: {latestActivity.kind === 'comment' ? latestActivity.content : 'Task fields changed'}
        </p>}
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Open Inspector to edit or join the discussion.</p>
      </div> : <>
      <form onSubmit={async (event) => {
        event.preventDefault(); setSaving(true); setError('')
        try {
          const saved = await api.patch<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`, {
            description: description ?? task.data.description, updated_at: task.data.updated_at,
          })
          queryClient.setQueryData(['task-management', 'detail', id], saved)
          setDescription(null)
          await onSaved()
          await queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-activity', id] })
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not save') }
        finally { setSaving(false) }
      }}>
        <label className="block text-sm">Description
          <textarea className="mt-2 w-full rounded border border-[var(--color-border)] p-3" rows={7}
            value={description ?? task.data.description ?? ''} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button className="fc-btn-primary mt-3" disabled={saving}>Save description</button>
      </form>

      <div className="mt-7 border-t border-[var(--color-border)] pt-5">
        <h3 className="mb-3 text-sm font-semibold">Discussion and history</h3>
        <form className="mb-5 flex gap-2" onSubmit={async (event) => {
          event.preventDefault()
          const content = comment.trim()
          if (!content) return
          setSaving(true); setError('')
          try {
            // @spec task_activity_stays_in_tasker
            await api.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: id, content } })
            setComment('')
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-activity', id] }),
              queryClient.invalidateQueries({ queryKey: ['task-management', 'comments'] }),
            ])
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not add comment') }
          finally { setSaving(false) }
        }}>
          <label className="sr-only" htmlFor={`task-comment-${id}`}>Add comment</label>
          <input id={`task-comment-${id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment" className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm" />
          <button className="fc-btn-primary" disabled={saving || !comment.trim()}>Comment</button>
        </form>
        {!activity.length && <p className="text-xs text-[var(--color-ink-faint)]">No discussion or changes yet.</p>}
        <ol className="space-y-4" data-testid="task-activity">
          {activity.map((entry, index) => <li key={`${entry.kind}-${entry.at}-${index}`} className="border-l-2 border-[var(--color-border)] pl-3 text-sm">
            <p className="text-xs text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">{entry.who}</strong> {entry.kind === 'comment' ? 'commented' : 'edited'} · {new Date(entry.at).toLocaleString()}</p>
            {entry.kind === 'comment'
              ? <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
              : <ul className="mt-1 text-xs text-[var(--color-ink-muted)]">{entry.changes.length ? entry.changes.map(([field, from, to], changeIndex) => <li key={changeIndex}><strong>{field.replaceAll('_', ' ')}</strong>: {formatValue(from)} → {formatValue(to)}</li>) : <li>Task updated</li>}</ul>}
          </li>)}
        </ol>
        <a className="mt-6 block text-xs text-[var(--color-brand)]" href={`/admin/tasker.task/${encodeURIComponent(id)}`}>Attachments and advanced fields in Featherbase ↗</a>
      </div>
      </>}
    </>}
  </section>
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
        // @spec discussion_stays_append_only
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

  if (!tasks.length) return <Empty text="Nothing here yet." />
  return <div className="space-y-2">{tasks.map((task) => {
    const focused = focusSet.has(task.row_id)
    const inactive = ['Blocked', 'On hold', 'Cancelled'].includes(task.task_state)
    return (
      <article key={task.row_id} className={`fc-card flex items-start gap-3 px-3 py-3 ${task.is_done ? 'opacity-60' : ''}`}>
        <input aria-label={`Mark ${task.task_title} done`} type="checkbox" checked={Boolean(task.is_done)} onChange={(event) => void onPatch(task, { is_done: event.target.checked })} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`#task=${encodeURIComponent(task.row_id)}`} className={`font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)] ${task.is_done ? 'line-through' : ''}`}>{task.task_title}</a>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <select aria-label={`State for ${task.task_title}`} value={task.task_state ?? 'Not started'} onChange={(event) => { const taskState = event.target.value; void onPatch(task, { task_state: taskState }); if (['Blocked', 'On hold', 'Cancelled'].includes(taskState)) { setExplaining(task.row_id); setExplanation('') } }} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]">{STATES.map((state) => <option key={state}>{state}</option>)}</select>
            <select aria-label={`Destination for ${task.task_title}`} value={task.personal_tasks_owner ? `personal:${task.personal_tasks_owner}` : task.project ? `project:${task.project}` : ''} onChange={(event) => { const [kind, value] = event.target.value.split(':', 2); void onPatch(task, kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null }) }} className="max-w-52 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]"><option value="">Inbox</option><optgroup label="Projects">{projects.map((project) => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}</optgroup><optgroup label="Personal tasks">{users.map((user) => <option key={user.row_id} value={`personal:${user.row_id}`}>{user.row_id}</option>)}</optgroup></select>
            {/* @spec assignment_state_independent */}
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
          {/* @spec urgency_is_shared_binary */}
          <button type="button" aria-label={`${task.urgent ? 'Remove urgent flag from' : 'Mark urgent'} ${task.task_title}`} aria-pressed={task.urgent} title="Urgent is visible to the team" onClick={() => void onPatch(task, { urgent: !task.urgent })} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition ${task.urgent ? 'border-red-300 bg-red-50 text-red-700' : 'border-transparent bg-[var(--color-subtle)] text-[var(--color-ink-muted)] hover:border-red-200 hover:text-red-700'}`}>{task.urgent && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-600" />}{task.urgent ? 'Urgent' : 'Not urgent'}</button>
          <button type="button" aria-label={`${focused ? 'Remove from' : 'Add to'} My Focus: ${task.task_title}`} title="My Focus is private to you" onClick={() => void onFocus(task.row_id)} className={`rounded p-1 text-lg ${focused ? 'text-amber-500' : 'text-[var(--color-ink-faint)] hover:text-amber-500'}`}>{focused ? '★' : '☆'}</button>
          {onMove && focused && <><button type="button" aria-label={`Move ${task.task_title} up`} onClick={() => void onMove(task.row_id, -1)} className="rounded px-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]">↑</button><button type="button" aria-label={`Move ${task.task_title} down`} onClick={() => void onMove(task.row_id, 1)} className="rounded px-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]">↓</button></>}
        </div>
      </article>
    )
  })}</div>
}
