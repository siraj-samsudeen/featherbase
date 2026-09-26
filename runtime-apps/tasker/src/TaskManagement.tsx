import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser, listResource } from './api'
import { Markdown } from './Markdown'
import { ProjectDescription } from './ProjectDescription'
import { TaskActions } from './TaskActions'
import {
  UNASSIGNED,
  emptyTaskViewSetup,
  filterTasks,
  parseSavedTaskViews,
  taskViewSetupEquals,
  type SavedTaskView,
  type SavedTaskViewScope,
  type TaskViewFilters,
  type TaskViewSetup,
} from './taskViews'

type View = 'inbox' | 'work' | 'together' | 'projects' | 'personal' | 'views'
type DetailMode = 'compact' | 'inspector' | 'focus'

interface Task {
  row_id: string
  task_title: string
  description: string | null
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
  description: string | null
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
  'description',
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
const SAVED_VIEWS_SETTINGS = 'tasker.saved-views'

function hashTaskId() {
  return new URLSearchParams(location.hash.slice(1)).get('task')
}

function hashSavedViewId() {
  return new URLSearchParams(location.hash.slice(1)).get('view')
}

function savedViewHash(viewId: string, taskId?: string) {
  const params = new URLSearchParams({ view: viewId })
  if (taskId) params.set('task', taskId)
  return `#${params}`
}

type TaskerIconName = 'inbox' | 'work' | 'together' | 'projects' | 'personal' | 'views'

function TaskerIcon({ name }: { name: TaskerIconName }) {
  const paths: Record<TaskerIconName, ReactNode> = {
    inbox: <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l2 2h4l2-2h4" /></>,
    work: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6" /></>,
    together: <><circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9" r="2" /><path d="M3.5 19c.5-3.5 2.3-5.2 5.5-5.2s5 1.7 5.5 5.2" /><path d="M14.5 14.4c3.3-.4 5.3 1.1 6 4.1" /></>,
    projects: <><path d="M3.5 7.5h6l2-2h9v13h-17z" /><path d="M3.5 9.5h17" /></>,
    personal: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4V2.8M15 4V2.8M8.5 10h7M8.5 14h5" /></>,
    views: <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="8" cy="7" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="11" cy="17" r="1.5" /></>,
  }
  return <svg className="tasker-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
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
  const [view, setView] = useState<View>(() => hashSavedViewId() ? 'views' : 'inbox')
  const [capture, setCapture] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectTask, setProjectTask] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [personalOwner, setPersonalOwner] = useState(me)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [selectedTask, setSelectedTask] = useState(hashTaskId)
  const [activeSavedViewId, setActiveSavedViewId] = useState(hashSavedViewId)
  const [taskViewSetup, setTaskViewSetup] = useState<TaskViewSetup>(emptyTaskViewSetup)
  const previousSurface = useRef('')

  useEffect(() => {
    const change = () => {
      setSelectedTask(hashTaskId())
      const savedViewId = hashSavedViewId()
      setActiveSavedViewId(savedViewId)
      if (savedViewId) setView('views')
    }
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
        fields: ['row_id', 'project_name', 'description', 'updated_at'],
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
  const savedViewPreferences = useQuery({
    queryKey: ['task-management', 'saved-views'],
    queryFn: () => api.get<{ settings: { views?: unknown[] } | null }>(
      `/api/user_settings/${encodeURIComponent(SAVED_VIEWS_SETTINGS)}`,
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
  const allProjects = projects.data?.data ?? []
  const projectById = new Map(allProjects.map((project) => [project.row_id, project]))
  const projectTaskCounts = new Map(allProjects.map((project) => [
    project.row_id,
    allTasks.filter((task) => task.project === project.row_id).length,
  ]))
  const starredProjectIds = (projectPreferences.data?.settings?.project_ids ?? []).filter((id) => projectById.has(id))
  const starredProjectSet = new Set(starredProjectIds)
  const detailMode = detailPreferences.data?.settings?.mode ?? 'inspector'
  const people = peopleWithTaskResponsibility(users.data?.data ?? [], allTasks, me)
  const savedViews = parseSavedTaskViews(savedViewPreferences.data?.settings)
  const activeSavedView = savedViews.find((savedView) => savedView.id === activeSavedViewId)
  const activeTogetherTasks = allTasks.filter((task) => !['Done', 'Cancelled'].includes(task.task_state))

  function copySetup(setup: TaskViewSetup): TaskViewSetup {
    return {
      search: setup.search,
      filters: {
        states: [...setup.filters.states],
        responsiblePeople: [...setup.filters.responsiblePeople],
        urgencies: [...setup.filters.urgencies],
        projects: [...setup.filters.projects],
      },
    }
  }

  function tasksForScope(scope: SavedTaskViewScope): Task[] {
    if (scope.kind === 'all') return allTasks
    if (scope.kind === 'project') return allTasks.filter((task) => task.project === scope.projectId)
    if (scope.kind === 'inbox') return inbox
    if (scope.kind === 'work') return myWork
    if (scope.kind === 'together') return activeTogetherTasks
    return allTasks.filter((task) => task.personal_tasks_owner === scope.owner)
  }

  function openSavedView(savedView: SavedTaskView) {
    setTaskViewSetup(copySetup(savedView.setup))
    setActiveSavedViewId(savedView.id)
    setView('views')
    location.hash = savedViewHash(savedView.id)
  }

  function leaveSavedView(nextView: View, projectId?: string) {
    if (projectId !== undefined) setSelectedProject(projectId)
    setActiveSavedViewId(null)
    setTaskViewSetup(emptyTaskViewSetup())
    setView(nextView)
    location.hash = ''
  }

  useEffect(() => {
    if (!activeSavedView) return
    setTaskViewSetup(copySetup(activeSavedView.setup))
  }, [activeSavedViewId, savedViewPreferences.data])

  const surfaceKey = view === 'projects'
    ? `projects:${selectedProject}`
    : view === 'personal'
      ? `personal:${personalOwner}`
      : view
  useEffect(() => {
    if (!previousSurface.current) {
      previousSurface.current = surfaceKey
      return
    }
    if (previousSurface.current !== surfaceKey && view !== 'views') {
      setTaskViewSetup(emptyTaskViewSetup())
      previousSurface.current = surfaceKey
    }
  }, [surfaceKey, view])

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['task-management'] })
  }

  async function actionCompleted(projectId?: string) {
    location.hash = ''
    setSelectedTask(null)
    if (projectId) { setSelectedProject(projectId); setView('projects') }
    await refresh()
  }

  async function createTask(title: string, extra: Partial<Task> = {}) {
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
      await api.put(`/api/user_settings/${encodeURIComponent(PREFERENCE_SETTINGS)}`, { mode })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save detail view')
      await queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-preferences'] })
    }
  }

  async function saveViews(next: SavedTaskView[]) {
    setError(null)
    queryClient.setQueryData(['task-management', 'saved-views'], { settings: { views: next } })
    try {
      await api.put(`/api/user_settings/${encodeURIComponent(SAVED_VIEWS_SETTINGS)}`, { views: next })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save task views')
      await queryClient.invalidateQueries({ queryKey: ['task-management', 'saved-views'] })
      throw err
    }
  }

  async function createSavedView(name: string, scope: SavedTaskViewScope) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (savedViews.some((savedView) => savedView.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setError(`A saved view named “${trimmed}” already exists`)
      return
    }
    const savedView: SavedTaskView = {
      id: crypto.randomUUID(),
      name: trimmed,
      scope,
      setup: copySetup(taskViewSetup),
    }
    await saveViews([...savedViews, savedView])
    openSavedView(savedView)
  }

  async function updateSavedView(savedView: SavedTaskView) {
    const next = { ...savedView, setup: copySetup(taskViewSetup) }
    await saveViews(savedViews.map((candidate) => candidate.id === savedView.id ? next : candidate))
    setTaskViewSetup(copySetup(next.setup))
  }

  async function renameSavedView(savedView: SavedTaskView, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (savedViews.some((candidate) => candidate.id !== savedView.id && candidate.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setError(`A saved view named “${trimmed}” already exists`)
      return
    }
    await saveViews(savedViews.map((candidate) => candidate.id === savedView.id ? { ...candidate, name: trimmed } : candidate))
  }

  async function deleteSavedView(savedView: SavedTaskView) {
    await saveViews(savedViews.filter((candidate) => candidate.id !== savedView.id))
    if (activeSavedViewId === savedView.id) {
      setActiveSavedViewId(null)
      setTaskViewSetup(emptyTaskViewSetup())
      location.hash = ''
    }
  }

  async function renameProject(project: Project, project_name: string) {
    setError(null)
    try {
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
    const name = projectName.trim()
    if (!name) return
    setCreatingProject(true)
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
      setCreatingProject(false)
    }
  }

  const primaryTabs: { id: View; label: string; icon: TaskerIconName; count?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: 'inbox', count: inbox.length },
    { id: 'work', label: 'My Work', icon: 'work', count: myWork.length },
    { id: 'together', label: 'Together', icon: 'together' },
    {
      id: 'personal',
      label: 'Personal tasks',
      icon: 'personal',
      count: allTasks.filter((task) => task.personal_tasks_owner === me).length,
    },
  ]
  const filteredInbox = filterTasks(inbox, taskViewSetup)
  const filteredMyWork = filterTasks(myWork, taskViewSetup)
  const filteredTogether = filterTasks(activeTogetherTasks, taskViewSetup)
  const filteredProjectRows = filterTasks(projectRows, taskViewSetup)
  const filteredPersonalRows = filterTasks(personalRows, taskViewSetup)
  const savedViewBaseTasks = activeSavedView ? tasksForScope(activeSavedView.scope) : []
  const filteredSavedViewTasks = filterTasks(savedViewBaseTasks, taskViewSetup)

  function toolbarFor(
    baseTasks: Task[],
    matchedTasks: Task[],
    scope: SavedTaskViewScope,
    scopeLabel: string,
    showProjects: boolean,
    builtInCriterion?: string,
    selectedSavedView?: SavedTaskView,
  ) {
    return <TaskViewToolbar
      setup={taskViewSetup}
      onSetup={setTaskViewSetup}
      total={baseTasks.length}
      matched={matchedTasks.length}
      people={people}
      projects={allProjects}
      showProjects={showProjects}
      builtInCriterion={builtInCriterion}
      savedViews={savedViews}
      activeSavedView={selectedSavedView}
      currentScope={scope}
      currentScopeLabel={scopeLabel}
      onOpenSaved={openSavedView}
      onDefault={() => {
        setActiveSavedViewId(null)
        setTaskViewSetup(emptyTaskViewSetup())
        if (view === 'views') location.hash = ''
      }}
      onCreate={createSavedView}
      onUpdate={updateSavedView}
      onReset={() => selectedSavedView && setTaskViewSetup(copySetup(selectedSavedView.setup))}
    />
  }

  return (
    <div className="tasker-shell" data-view={view} data-testid="task-management-page">
      <aside className="tasker-sidebar">
        <a href="/featherbase/admin" className="tasker-back-link">← Featherbase</a>
        <h1 className="tasker-brand">Tasker</h1>
        <p className="tasker-brand-subtitle">Team workspace</p>
      <nav aria-label="Task views" className="tasker-primary-nav">
        {primaryTabs.slice(0, 3).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => leaveSavedView(tab.id)}
            aria-current={view === tab.id ? 'page' : undefined}
            className={`tasker-nav-item tasker-nav-${tab.id}`}
          >
            <TaskerIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.count != null && <span className="tasker-count">{tab.count}</span>}
          </button>
        ))}
        {primaryTabs.slice(3).map((tab) => (
          <button key={tab.id} type="button" onClick={() => leaveSavedView(tab.id)} aria-current={view === tab.id ? 'page' : undefined} className={`tasker-nav-item tasker-nav-${tab.id}`}>
            <TaskerIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.count != null && <span className="tasker-count">{tab.count}</span>}
          </button>
        ))}
        <button type="button" onClick={() => leaveSavedView('views')} aria-current={view === 'views' ? 'page' : undefined} className="tasker-nav-item tasker-nav-views">
          <TaskerIcon name="views" />
          <span>Views</span>
          {savedViews.length > 0 && <span className="tasker-count">{savedViews.length}</span>}
        </button>
        <button type="button" onClick={() => leaveSavedView('projects', '')} aria-current={view === 'projects' ? 'page' : undefined} className="tasker-nav-item tasker-nav-projects">
          <TaskerIcon name="projects" />
          <span>Projects</span>
        </button>
        <div className="tasker-sidebar-projects" aria-label="Projects">
          {allProjects.map((project) => (
            <div key={project.row_id} className={`tasker-sidebar-project ${view === 'projects' && selectedProject === project.row_id ? 'is-selected' : ''}`}>
              <button type="button" className="tasker-sidebar-project-name" aria-label={project.project_name} onClick={() => leaveSavedView('projects', project.row_id)}>
                <span>{project.project_name}</span>
                <span className="tasker-count">{projectTaskCounts.get(project.row_id) ?? 0}</span>
              </button>
            </div>
          ))}
        </div>
      </nav>
      </aside>
      <main className="tasker-main">
      {starredProjectIds.length > 0 && (
        <div className="tasker-project-tabs" aria-label="Starred projects">
          {starredProjectIds.map((id) => (
            <button key={id} type="button" aria-current={view === 'projects' && selectedProject === id ? 'page' : undefined}
              onClick={() => leaveSavedView('projects', id)}>
              {projectById.get(id)?.project_name}
            </button>
          ))}
        </div>
      )}
      {tasks.error && <p role="alert" className="mb-4">{tasks.error.message} · <a href="/featherbase/admin">Back to Featherbase</a></p>}
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {selectedTask && detailMode === 'compact' && (
        <div className="tasker-compact-detail">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} people={people} projects={allProjects} onCompleted={actionCompleted} />
        </div>
      )}

      {view === 'inbox' && (
        <section aria-labelledby="inbox-heading">
          <SectionTitle id="inbox-heading" title="Inbox" hint="Capture first. Decide where it belongs when you are ready." />
          <form
            className="tasker-composer"
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
          {toolbarFor(inbox, filteredInbox, { kind: 'inbox' }, 'Inbox', true)}
          {filteredInbox.length
            ? <TaskList tasks={filteredInbox} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            : <NoTaskMatches total={inbox.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'work' && (
        <section aria-labelledby="work-heading">
          <SectionTitle id="work-heading" title="My Work" hint="Your private focus order, followed by work assigned to you" />
          {toolbarFor(myWork, filteredMyWork, { kind: 'work' }, 'My Work', true)}
          {filteredMyWork.length
            ? <TaskList tasks={filteredMyWork} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} onMove={moveFocus} />
            : <NoTaskMatches total={myWork.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'together' && (
        <section aria-labelledby="together-heading">
          <SectionTitle id="together-heading" title="Together" hint="Active work grouped by who has responsibility" />
          {toolbarFor(activeTogetherTasks, filteredTogether, { kind: 'together' }, 'Together', true, 'Active work only')}
          {[null, ...people.map((person) => person.row_id)].map((owner) => {
            const rows = filteredTogether.filter((task) => task.assigned_to === owner)
            if (!rows.length) return null
            return <div key={owner ?? 'unassigned'} className="mb-7">
              <h3 className="mb-2 text-sm font-semibold">{owner ?? 'Unassigned'} <span className="font-normal text-[var(--color-ink-muted)]">{rows.length}</span></h3>
              <TaskList tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            </div>
          })}
          {!filteredTogether.length && <NoTaskMatches total={activeTogetherTasks.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'projects' && (
        <section aria-labelledby="projects-heading" className="tasker-project-workspace">
            {selectedProject && projectById.has(selectedProject) ? (
              <>
                <ProjectHeading
                  project={projectById.get(selectedProject)!}
                  starred={starredProjectSet.has(selectedProject)}
                  onRename={renameProject}
                  onToggleStar={() => toggleProjectStar(selectedProject)}
                  onMoveStar={(offset) => moveProjectStar(selectedProject, offset)}
                />
                <ProjectDescription key={selectedProject} project={projectById.get(selectedProject)!} onSaved={refresh} />
                <form className="tasker-composer" onSubmit={async (event) => { event.preventDefault(); const title = projectTask; try { await createTask(title, { project: selectedProject }); setProjectTask('') } catch { /* shown above */ } }}>
                  <label className="sr-only" htmlFor="project-task">Add task to project</label>
                  <input id="project-task" value={projectTask} onChange={(event) => setProjectTask(event.target.value)} placeholder="Add a task, then press Enter" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" autoFocus />
                  <button className="fc-btn-primary" disabled={saving || !projectTask.trim()}>Add</button>
                </form>
                {toolbarFor(projectRows, filteredProjectRows, { kind: 'project', projectId: selectedProject }, 'This project', false)}
                {filteredProjectRows.length
                  ? <TaskList tasks={filteredProjectRows} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
                  : <NoTaskMatches total={projectRows.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
              </>
            ) : <>
              <SectionTitle id="projects-heading" title="Projects" hint="Choose an existing project or create a new shared workspace." />
              <form className="tasker-project-create" onSubmit={(event) => { event.preventDefault(); void createProject() }}>
                <label htmlFor="project-name">New project</label>
                <div>
                  <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" />
                  <button className="fc-btn-primary" disabled={creatingProject || !projectName.trim()}>Create project</button>
                </div>
              </form>
              <div className="tasker-project-directory" aria-label="All projects">
                {allProjects.map((project) => (
                  <button key={project.row_id} type="button" aria-label={`Open project ${project.project_name}`} onClick={() => setSelectedProject(project.row_id)} className="tasker-project-directory-item">
                    <span className="tasker-project-directory-icon" aria-hidden="true"><TaskerIcon name="projects" /></span>
                    <span>
                      <strong>{project.project_name}</strong>
                      <small>{projectTaskCounts.get(project.row_id) ?? 0} {(projectTaskCounts.get(project.row_id) ?? 0) === 1 ? 'task' : 'tasks'}</small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </button>
                ))}
                {!allProjects.length && <Empty text="No projects yet. Create the first one above." />}
              </div>
            </>}
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
          {toolbarFor(personalRows, filteredPersonalRows, { kind: 'personal', owner: personalOwner }, `${personalOwner}'s Personal tasks`, true)}
          {filteredPersonalRows.length
            ? <TaskList tasks={filteredPersonalRows} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            : <NoTaskMatches total={personalRows.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'views' && (
        <section aria-labelledby="views-heading">
          {activeSavedView ? <>
            <SectionTitle id="views-heading" title={activeSavedView.name} hint={`Private saved view · ${scopeLabel(activeSavedView.scope, projectById)}`} />
            {savedViewUnavailableReason(activeSavedView, projectById, people) && (
              <p role="status" className="tasker-view-warning">{savedViewUnavailableReason(activeSavedView, projectById, people)}. The saved criteria remain unchanged.</p>
            )}
            {toolbarFor(
              savedViewBaseTasks,
              filteredSavedViewTasks,
              activeSavedView.scope,
              scopeLabel(activeSavedView.scope, projectById),
              activeSavedView.scope.kind !== 'project',
              activeSavedView.scope.kind === 'together' ? 'Active work only' : undefined,
              activeSavedView,
            )}
            {activeSavedView.scope.kind === 'together' ? <>
              {[null, ...people.map((person) => person.row_id)].map((owner) => {
                const rows = filteredSavedViewTasks.filter((task) => task.assigned_to === owner)
                if (!rows.length) return null
                return <div key={owner ?? 'unassigned'} className="mb-7">
                  <h3 className="mb-2 text-sm font-semibold">{owner ?? 'Unassigned'} <span className="font-normal text-[var(--color-ink-muted)]">{rows.length}</span></h3>
                  <TaskList tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} savedViewId={activeSavedView.id} />
                </div>
              })}
            </> : filteredSavedViewTasks.length
              ? <TaskList tasks={filteredSavedViewTasks} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} savedViewId={activeSavedView.id} />
              : null}
            {!filteredSavedViewTasks.length && <NoTaskMatches total={savedViewBaseTasks.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
          </> : <>
            <SectionTitle id="views-heading" title="Views" hint="Your private saved ways of finding work" />
            {activeSavedViewId && <p role="status" className="tasker-view-warning">This private saved view is unavailable. It may have been deleted in another session.</p>}
            <SavedViewDirectory
              savedViews={savedViews}
              projects={projectById}
              people={people}
              onOpen={openSavedView}
              onRename={renameSavedView}
              onDelete={deleteSavedView}
            />
          </>}
        </section>
      )}
      </main>
      {selectedTask && detailMode === 'inspector' && (
        <aside className="tasker-inspector" aria-label="Task details">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} people={people} projects={allProjects} onCompleted={actionCompleted} />
        </aside>
      )}
      {selectedTask && detailMode === 'focus' && (
        <div className="tasker-focus-detail" role="dialog" aria-label="Focused task details">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} people={people} projects={allProjects} onCompleted={actionCompleted} />
        </div>
      )}
    </div>
  )
}

function scopeLabel(scope: SavedTaskViewScope, projects: Map<string, Project>): string {
  if (scope.kind === 'all') return 'Across all tasks'
  if (scope.kind === 'project') return projects.get(scope.projectId)?.project_name ?? 'Unavailable project'
  if (scope.kind === 'work') return 'My Work'
  if (scope.kind === 'together') return 'Together'
  if (scope.kind === 'personal') return `${scope.owner}'s Personal tasks`
  return 'Inbox'
}

function savedViewUnavailableReason(
  savedView: SavedTaskView,
  projects: Map<string, Project>,
  people: { row_id: string }[],
): string | null {
  if (savedView.scope.kind === 'project' && !projects.has(savedView.scope.projectId)) return 'Project unavailable'
  if (savedView.scope.kind === 'personal') {
    const owner = savedView.scope.owner
    if (!people.some((person) => person.row_id === owner)) return 'Person unavailable'
  }
  if (savedView.setup.filters.projects.some((projectId) => !projects.has(projectId))) return 'One or more projects are unavailable'
  if (savedView.setup.filters.responsiblePeople.some((personId) => personId !== UNASSIGNED && !people.some((person) => person.row_id === personId))) return 'One or more people are unavailable'
  return null
}

function TaskViewToolbar({
  setup,
  onSetup,
  total,
  matched,
  people,
  projects,
  showProjects,
  builtInCriterion,
  savedViews,
  activeSavedView,
  currentScope,
  currentScopeLabel,
  onOpenSaved,
  onDefault,
  onCreate,
  onUpdate,
  onReset,
}: {
  setup: TaskViewSetup
  onSetup: (setup: TaskViewSetup) => void
  total: number
  matched: number
  people: { row_id: string }[]
  projects: Project[]
  showProjects: boolean
  builtInCriterion?: string
  savedViews: SavedTaskView[]
  activeSavedView?: SavedTaskView
  currentScope: SavedTaskViewScope
  currentScopeLabel: string
  onOpenSaved: (savedView: SavedTaskView) => void
  onDefault: () => void
  onCreate: (name: string, scope: SavedTaskViewScope) => Promise<void>
  onUpdate: (savedView: SavedTaskView) => Promise<void>
  onReset: () => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const [savingAsNew, setSavingAsNew] = useState(false)
  const [name, setName] = useState('')
  const [scopeKind, setScopeKind] = useState<'current' | 'all'>('current')
  const dirty = Boolean(activeSavedView && !taskViewSetupEquals(activeSavedView.setup, setup))

  const setFilters = (filters: TaskViewFilters) => onSetup({ ...setup, filters })
  const clearFilters = () => setFilters(emptyTaskViewSetup().filters)

  function closeFilters() {
    setFiltersOpen(false)
    requestAnimationFrame(() => filterButton.current?.focus())
  }

  function removeFilter(dimension: keyof TaskViewFilters, value: string) {
    setFilters({
      ...setup.filters,
      [dimension]: setup.filters[dimension].filter((candidate) => candidate !== value),
    })
  }

  const chips: { key: string; label: string; remove?: () => void }[] = []
  if (builtInCriterion) chips.push({ key: 'built-in', label: builtInCriterion })
  for (const state of setup.filters.states)
    chips.push({ key: `state:${state}`, label: state, remove: () => removeFilter('states', state) })
  for (const person of setup.filters.responsiblePeople)
    chips.push({ key: `person:${person}`, label: person === UNASSIGNED ? 'Unassigned' : person, remove: () => removeFilter('responsiblePeople', person) })
  for (const urgency of setup.filters.urgencies)
    chips.push({ key: `urgency:${urgency}`, label: urgency === 'urgent' ? 'Urgent' : 'Not urgent', remove: () => removeFilter('urgencies', urgency) })
  for (const projectId of setup.filters.projects)
    chips.push({ key: `project:${projectId}`, label: projects.find((project) => project.row_id === projectId)?.project_name ?? 'Unavailable project', remove: () => removeFilter('projects', projectId) })

  async function submitSavedView(event: React.FormEvent) {
    event.preventDefault()
    const scope = scopeKind === 'all' ? { kind: 'all' as const } : currentScope
    await onCreate(name, scope)
    setName('')
    setSavingAsNew(false)
  }

  return <div className="tasker-view-controls">
    <div className="tasker-view-toolbar">
      <label className="tasker-view-select-label">
        <span className="sr-only">Task view</span>
        <select
          aria-label="Task view"
          value={activeSavedView?.id ?? ''}
          onChange={(event) => {
            if (!event.target.value) onDefault()
            else {
              const savedView = savedViews.find((candidate) => candidate.id === event.target.value)
              if (savedView) onOpenSaved(savedView)
            }
          }}
        >
          <option value="">Default view</option>
          {savedViews.map((savedView) => <option key={savedView.id} value={savedView.id}>{savedView.name}</option>)}
        </select>
      </label>
      <label className="tasker-search">
        <span className="sr-only">Search task titles and descriptions</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={setup.search}
          onChange={(event) => onSetup({ ...setup, search: event.target.value })}
          placeholder="Search tasks"
        />
      </label>
      <button
        ref={filterButton}
        type="button"
        className="fc-btn tasker-filter-button"
        aria-expanded={filtersOpen}
        aria-controls="tasker-filter-controls"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        Filter{chips.filter((chip) => chip.remove).length ? ` (${chips.filter((chip) => chip.remove).length})` : ''}
      </button>
      {activeSavedView && dirty && <>
        <button type="button" className="fc-btn" onClick={() => void onUpdate(activeSavedView)}>Update view</button>
        <button type="button" className="fc-btn" onClick={onReset}>Reset</button>
      </>}
      <button type="button" className="fc-btn" onClick={() => setSavingAsNew((open) => !open)}>
        {activeSavedView ? 'Save as new' : 'Save view'}
      </button>
    </div>
    {filtersOpen && <TaskFilterControls
      filters={setup.filters}
      people={people}
      projects={projects}
      showProjects={showProjects}
      onFilters={setFilters}
      onClear={clearFilters}
      onClose={closeFilters}
    />}
    {(chips.length > 0 || setup.search || total > 0) && <div className="tasker-active-criteria">
      <div className="tasker-filter-chips">
        {chips.map((chip) => chip.remove
          ? <button key={chip.key} type="button" onClick={chip.remove} aria-label={`Remove ${chip.label} filter`}>{chip.label} <span aria-hidden="true">×</span></button>
          : <span key={chip.key}>{chip.label}</span>)}
      </div>
      <span className="tasker-match-count" aria-live="polite">{matched} of {total} {total === 1 ? 'task' : 'tasks'}</span>
    </div>}
    {savingAsNew && <form className="tasker-save-view" onSubmit={(event) => void submitSavedView(event)}>
      <label>View name
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. My blocked work" />
      </label>
      <fieldset>
        <legend>Task boundary</legend>
        <label><input type="radio" name="view-scope" checked={scopeKind === 'current'} onChange={() => setScopeKind('current')} /> {currentScopeLabel}</label>
        {currentScope.kind !== 'all' && <label><input type="radio" name="view-scope" checked={scopeKind === 'all'} onChange={() => setScopeKind('all')} /> Across all tasks</label>}
      </fieldset>
      <div>
        <button className="fc-btn-primary" disabled={!name.trim()}>Save private view</button>
        <button type="button" className="fc-btn" onClick={() => { setSavingAsNew(false); setName('') }}>Cancel</button>
      </div>
      <p>Only you can see this saved view. Tasks are not changed.</p>
    </form>}
  </div>
}

function TaskFilterControls({ filters, people, projects, showProjects, onFilters, onClear, onClose }: {
  filters: TaskViewFilters
  people: { row_id: string }[]
  projects: Project[]
  showProjects: boolean
  onFilters: (filters: TaskViewFilters) => void
  onClear: () => void
  onClose: () => void
}) {
  const firstControl = useRef<HTMLInputElement>(null)
  useEffect(() => firstControl.current?.focus(), [])

  function toggle<K extends keyof TaskViewFilters>(dimension: K, value: TaskViewFilters[K][number]) {
    const selected = filters[dimension] as readonly string[]
    onFilters({
      ...filters,
      [dimension]: selected.includes(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value],
    } as TaskViewFilters)
  }

  return <div className="tasker-filter-layer">
    <button type="button" className="tasker-filter-backdrop" aria-label="Close filters" onClick={onClose} />
    <div id="tasker-filter-controls" className="tasker-filter-popover" role="dialog" aria-label="Filter tasks" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }}>
      <div className="tasker-filter-heading"><strong>Filters</strong><button type="button" aria-label="Close filters" onClick={onClose}>×</button></div>
      <FilterGroup label="State" values={STATES} selected={filters.states} onToggle={(value) => toggle('states', value)} firstControl={firstControl} />
      <FilterGroup label="Responsible person" values={[UNASSIGNED, ...people.map((person) => person.row_id)]} labels={new Map([[UNASSIGNED, 'Unassigned']])} selected={filters.responsiblePeople} onToggle={(value) => toggle('responsiblePeople', value)} />
      <FilterGroup label="Urgency" values={['urgent', 'not_urgent']} labels={new Map([['urgent', 'Urgent'], ['not_urgent', 'Not urgent']])} selected={filters.urgencies} onToggle={(value) => toggle('urgencies', value as TaskViewFilters['urgencies'][number])} />
      {showProjects && <FilterGroup label="Project" values={projects.map((project) => project.row_id)} labels={new Map(projects.map((project) => [project.row_id, project.project_name]))} selected={filters.projects} onToggle={(value) => toggle('projects', value)} />}
      <div className="tasker-filter-actions"><button type="button" onClick={onClear}>Clear all</button><button type="button" className="fc-btn-primary" onClick={onClose}>Close</button></div>
    </div>
  </div>
}

function FilterGroup({ label, values, labels = new Map(), selected, onToggle, firstControl }: {
  label: string
  values: string[]
  labels?: Map<string, string>
  selected: readonly string[]
  onToggle: (value: string) => void
  firstControl?: React.RefObject<HTMLInputElement | null>
}) {
  return <fieldset className="tasker-filter-group">
    <legend>{label}</legend>
    {values.map((value, index) => <label key={value}>
      <input ref={index === 0 ? firstControl : undefined} type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
      <span>{labels.get(value) ?? value}</span>
    </label>)}
  </fieldset>
}

function NoTaskMatches({ total, setup, onSetup }: { total: number; setup: TaskViewSetup; onSetup: (setup: TaskViewSetup) => void }) {
  if (total === 0) return <Empty text="Nothing here yet." />
  return <div className="fc-card tasker-no-matches">
    <strong>No tasks match this search and filters</strong>
    <p>0 of {total} tasks. Your criteria are still applied.</p>
    <div>
      {setup.search && <button type="button" className="fc-btn" onClick={() => onSetup({ ...setup, search: '' })}>Clear search</button>}
      <button type="button" className="fc-btn" onClick={() => onSetup({ ...setup, filters: emptyTaskViewSetup().filters })}>Clear all filters</button>
    </div>
  </div>
}

function SavedViewDirectory({ savedViews, projects, people, onOpen, onRename, onDelete }: {
  savedViews: SavedTaskView[]
  projects: Map<string, Project>
  people: { row_id: string }[]
  onOpen: (savedView: SavedTaskView) => void
  onRename: (savedView: SavedTaskView, name: string) => Promise<void>
  onDelete: (savedView: SavedTaskView) => Promise<void>
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  if (!savedViews.length) return <Empty text="No saved views yet. Filter any task list, then choose Save view." />
  return <div className="tasker-saved-view-directory">
    {savedViews.map((savedView) => {
      const unavailable = savedViewUnavailableReason(savedView, projects, people)
      return <article key={savedView.id}>
        {renaming === savedView.id ? <form onSubmit={async (event) => {
          event.preventDefault()
          await onRename(savedView, name)
          setRenaming(null)
        }}>
          <label className="sr-only" htmlFor={`rename-view-${savedView.id}`}>Rename saved view</label>
          <input id={`rename-view-${savedView.id}`} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          <button className="fc-btn-primary" disabled={!name.trim()}>Save</button>
          <button type="button" className="fc-btn" onClick={() => setRenaming(null)}>Cancel</button>
        </form> : <>
          <button type="button" className="tasker-saved-view-open" onClick={() => onOpen(savedView)}>
            <strong>{savedView.name}</strong>
            <span>{scopeLabel(savedView.scope, projects)}</span>
            {unavailable && <em>{unavailable}</em>}
          </button>
          <div className="tasker-saved-view-actions">
            <button type="button" className="fc-btn" onClick={() => { setRenaming(savedView.id); setName(savedView.name) }}>Rename</button>
            <button type="button" className="fc-btn" onClick={() => {
              if (window.confirm(`Delete private saved view “${savedView.name}”?`)) void onDelete(savedView)
            }}>Delete</button>
          </div>
        </>}
      </article>
    })}
  </div>
}

function SectionTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return <div className="tasker-section-title"><h2 id={id}>{title}</h2>{hint && <p>{hint}</p>}</div>
}

function ProjectHeading({ project, starred, onRename, onToggleStar, onMoveStar }: {
  project: Project
  starred: boolean
  onRename: (project: Project, name: string) => Promise<void>
  onToggleStar: () => Promise<void>
  onMoveStar: (offset: -1 | 1) => Promise<void>
}) {
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
    <div className="tasker-project-heading-actions">
      <button type="button" className="fc-btn" onClick={() => void onToggleStar()}>{starred ? '★ Starred tab' : '☆ Add to tabs'}</button>
      {starred && <>
        <button type="button" className="fc-btn" aria-label={`Move project ${project.project_name} tab left`} onClick={() => void onMoveStar(-1)}>←</button>
        <button type="button" className="fc-btn" aria-label={`Move project ${project.project_name} tab right`} onClick={() => void onMoveStar(1)}>→</button>
      </>}
      <button type="button" className="fc-btn" onClick={() => setEditing(true)}>Rename</button>
    </div>
  </div>
}

function TaskDetail({ id, mode, onMode, onSaved, people, projects, onCompleted }: {
  id: string
  mode: DetailMode
  onMode: (mode: DetailMode) => Promise<void>
  onSaved: () => Promise<void>
  people: { row_id: string }[]
  projects: Project[]
  onCompleted: (projectId?: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const task = useQuery({ queryKey: ['task-management', 'detail', id],
    queryFn: () => api.get<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`),
    retry: false,
  })
  const taskActivity = useQuery({
    queryKey: ['task-management', 'detail-activity', id],
    queryFn: () => api.get<{ comments: TaskComment[]; versions: TaskVersion[] }>(
      `/api/activity/tasker.task/${encodeURIComponent(id)}`,
    ),
  })
  const [draft, setDraft] = useState<{ task_title: string; description: string; updated_at: string } | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const detail = useRef<HTMLElement>(null)
  const me = getSessionUser()?.row_id ?? ''
  function cancelDraft() {
    setDraft(null); setError('')
    requestAnimationFrame(() => editButton.current?.focus())
  }
  async function patch(patch: Partial<Task>) {
    if (!task.data) return
    setSaving(true); setError('')
    try {
      await api.patch(`/api/table/tasker.task/${encodeURIComponent(id)}`, { ...patch, updated_at: task.data.updated_at })
      await onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update task') }
    finally { setSaving(false) }
  }
  useEffect(() => {
    setDraft(null)
    setComment('')
    setError('')
  }, [id])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
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
    ...(taskActivity.data?.comments ?? []).map((entry) => ({ kind: 'comment' as const, at: entry.created_at, who: entry.created_by, content: entry.content })),
    ...(taskActivity.data?.versions ?? []).map((entry) => ({ kind: 'version' as const, at: entry.created_at, who: entry.created_by, changes: entry.data?.changed ?? [] })),
  ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
  const latestActivity = activity.at(-1)
  const formatValue = (value: unknown) => value == null || value === '' ? 'empty' : String(value)

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
      <a href={hashSavedViewId() ? savedViewHash(hashSavedViewId()!) : '#'} className="fc-btn" autoFocus>Close</a>
      <div className="tasker-mode-switch" aria-label="Task detail view">
        {([['compact', 'Compact'], ['inspector', 'Inspector'], ['focus', 'Focus']] as [DetailMode, string][]).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => void onMode(value)}>{label}</button>)}
      </div>
    </div>
    <h2 className="my-5 text-xl font-semibold">{task.data?.task_title ?? 'Task details'}</h2>
    {task.error && <p role="alert">{task.error.message}</p>}
    {task.isPending && <p role="status">Loading task…</p>}
    {error && <p role="alert">{error}</p>}
    <TaskActions key={id} task={task.data ?? { row_id: id, updated_at: '' }} disabled={!task.data || Boolean(task.error) || saving || Boolean(draft)} onCompleted={onCompleted} />
    {task.data && !task.error && <>
      <fieldset className="tasker-detail-controls" disabled={saving || Boolean(draft)}>
        <legend className="sr-only">Task workflow</legend>
        <label>State<select aria-label="Task state" value={task.data.task_state} onChange={(event) => void patch({ task_state: event.target.value })}>{STATES.map(state => <option key={state}>{state}</option>)}</select></label>
        <label>Responsibility<select aria-label="Task responsibility" value={task.data.assigned_to ?? ''} onChange={(event) => void patch({ assigned_to: event.target.value || null })}>
          <option value="">Unassigned</option>{people.map(user => <option key={user.row_id}>{user.row_id}</option>)}
        </select></label>
        <label>Destination<select aria-label="Task destination" value={task.data.personal_tasks_owner ? `personal:${task.data.personal_tasks_owner}` : task.data.project ? `project:${task.data.project}` : ''} onChange={(event) => {
          const [kind, value] = event.target.value.split(':', 2)
          void patch(kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null })
        }}><option value="">Inbox</option>{projects.map(project => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}
          {people.map(user => <option key={user.row_id} value={`personal:${user.row_id}`}>Personal: {user.row_id}</option>)}
        </select></label>
        <div className="tasker-detail-signals">
          {!task.data.assigned_to && <button type="button" className="fc-btn" onClick={() => void patch({ assigned_to: me })}>Take it</button>}
          <button type="button" className="fc-btn" aria-pressed={task.data.urgent} onClick={() => void patch({ urgent: !task.data.urgent })}>{task.data.urgent ? 'Urgent' : 'Not urgent'}</button>
          <button type="button" className="fc-btn" onClick={() => void patch({ is_done: !task.data.is_done })}>{task.data.is_done ? 'Undo Done' : 'Mark Done'}</button>
        </div>
      </fieldset>
      {mode === 'compact' ? <div className="tasker-compact-summary">
        <Markdown>{task.data.description || 'No description yet.'}</Markdown>
        {latestActivity && <p className="mt-3 border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-ink-muted)]">
          Latest: {latestActivity.kind === 'comment' ? latestActivity.content : 'Task fields changed'}
        </p>}
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Open Inspector to edit or join the discussion.</p>
      </div> : <>
      {draft ? <form className="tasker-description-editor" onSubmit={async (event) => {
        // Keep the draft's original revision even if another action refetches this row.
        event.preventDefault(); setSaving(true); setError('')
        if (!draft?.task_title.trim()) { setSaving(false); return }
        try {
          const saved = await api.patch<Task & { description: string }>(`/api/table/tasker.task/${encodeURIComponent(id)}`, {
            ...draft, task_title: draft.task_title.trim(),
          })
          queryClient.setQueryData(['task-management', 'detail', id], saved)
          cancelDraft()
          await onSaved()
          await queryClient.invalidateQueries({ queryKey: ['task-management', 'detail-activity', id] })
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not save') }
        finally { setSaving(false) }
      }}>
        <label className="block text-sm mb-3">Task title
          <input autoFocus className="mt-2 w-full rounded border border-[var(--color-border)] p-3"
            disabled={saving} value={draft?.task_title ?? task.data.task_title}
            onChange={(event) => setDraft({ ...draft, task_title: event.target.value })} />
        </label>
        <label className="block text-sm">Description
          <textarea className="mt-2 w-full rounded border border-[var(--color-border)] p-3" rows={4} disabled={saving}
            value={draft?.description ?? task.data.description ?? ''}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <div className="mt-3 flex gap-2">
          <button className="fc-btn-primary" disabled={saving || !draft?.task_title.trim()}>Save task</button>
          <button type="button" className="fc-btn" disabled={saving || !draft} onClick={cancelDraft}>Cancel changes</button>
        </div>
      </form> : <div className="tasker-description-read">
        <div className="tasker-description-heading"><h3>Description</h3>
          <button ref={editButton} type="button" className="fc-btn" onClick={() => setDraft({ task_title: task.data.task_title, description: task.data.description ?? '', updated_at: task.data.updated_at })}>Edit task</button>
        </div>
        <Markdown>{task.data.description || 'No description yet. Add context when it helps.'}</Markdown>
      </div>}

      <div className="mt-7 border-t border-[var(--color-border)] pt-5">
        <h3 className="mb-3 text-sm font-semibold">Discussion and history</h3>
        {taskActivity.error && <p role="alert">Could not load discussion and history: {taskActivity.error.message}</p>}
        <form className="mb-5 flex gap-2" onSubmit={async (event) => {
          event.preventDefault()
          const content = comment.trim()
          if (!content) return
          setSaving(true); setError('')
          try {
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
        <a className="mt-6 block text-xs text-[var(--color-brand)]" href={`/featherbase/admin/tasker.task/${encodeURIComponent(id)}`}>Attachments and advanced fields in Featherbase ↗</a>
      </div>
      </>}
    </>}
  </section>
}

function Empty({ text }: { text: string }) {
  return <div className="fc-card border-dashed px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">{text}</div>
}

function TaskList({ tasks, users, projects, focusSet, me, explanations, onPatch, onFocus, onMove, savedViewId }: {
  tasks: Task[]
  users: { row_id: string }[]
  projects: Project[]
  focusSet: Set<string>
  me: string
  explanations: Map<string, string>
  onPatch: (task: Task, patch: Partial<Task>) => Promise<void>
  onFocus: (id: string) => Promise<void>
  onMove?: (id: string, offset: -1 | 1) => Promise<void>
  savedViewId?: string
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
  return <div className="tasker-task-list">
    <div className="tasker-task-guide" aria-hidden="true">
      <span />
      <span>Task</span>
      <div className="tasker-task-metadata"><span>State</span><span>Destination</span><span>Responsibility</span></div>
      <span>Signals</span>
    </div>
    {tasks.map((task) => {
    const focused = focusSet.has(task.row_id)
    const inactive = ['Blocked', 'On hold', 'Cancelled'].includes(task.task_state)
    return (
      <article key={task.row_id} className={`tasker-task-row ${task.is_done ? 'is-done' : ''}`}>
        <input aria-label={`Mark ${task.task_title} done`} type="checkbox" checked={Boolean(task.is_done)} onChange={(event) => void onPatch(task, { is_done: event.target.checked })} className="tasker-task-checkbox" />
        <div className="tasker-task-copy">
          <a href={savedViewId ? savedViewHash(savedViewId, task.row_id) : `#task=${encodeURIComponent(task.row_id)}`} className={task.is_done ? 'line-through' : ''}>{task.task_title}</a>
          {explaining === task.row_id && (
            <form className="tasker-explanation-form" onSubmit={(event) => { event.preventDefault(); void addExplanation(task) }}>
              <label className="sr-only" htmlFor={`explain-${task.row_id}`}>Optional explanation</label>
              <input id={`explain-${task.row_id}`} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Optional explanation" autoFocus className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs" />
              <button className="fc-btn-primary" disabled={posting}>Save note</button>
              <button type="button" className="fc-btn" onClick={() => { setExplanation(''); setExplaining(null) }}>Skip</button>
            </form>
          )}
          {explaining !== task.row_id && inactive && explanations.get(task.row_id) && (
            <p className="tasker-task-explanation"><span>{task.task_state}:</span> {explanations.get(task.row_id)}</p>
          )}
        </div>
        <div className="tasker-task-metadata">
          <select data-state={task.task_state} aria-label={`State for ${task.task_title}`} value={task.task_state ?? 'Not started'} onChange={(event) => { const taskState = event.target.value; void onPatch(task, { task_state: taskState }); if (['Blocked', 'On hold', 'Cancelled'].includes(taskState)) { setExplaining(task.row_id); setExplanation('') } }}>{STATES.map((state) => <option key={state}>{state}</option>)}</select>
          <select aria-label={`Destination for ${task.task_title}`} value={task.personal_tasks_owner ? `personal:${task.personal_tasks_owner}` : task.project ? `project:${task.project}` : ''} onChange={(event) => { const [kind, value] = event.target.value.split(':', 2); void onPatch(task, kind === 'project' ? { project: value, personal_tasks_owner: null } : kind === 'personal' ? { project: null, personal_tasks_owner: value } : { project: null, personal_tasks_owner: null }) }}><option value="">Inbox</option><optgroup label="Projects">{projects.map((project) => <option key={project.row_id} value={`project:${project.row_id}`}>{project.project_name}</option>)}</optgroup><optgroup label="Personal tasks">{users.map((user) => <option key={user.row_id} value={`personal:${user.row_id}`}>{user.row_id}</option>)}</optgroup></select>
          <div className="tasker-responsibility">
            <select aria-label={`Assign ${task.task_title}`} value={task.assigned_to ?? ''} onChange={(event) => void onPatch(task, { assigned_to: event.target.value || null })}><option value="">Unassigned</option>{users.map((user) => <option key={user.row_id} value={user.row_id}>{user.row_id}</option>)}</select>
            {!task.assigned_to && me && <button type="button" onClick={() => void onPatch(task, { assigned_to: me })} className="tasker-take-button">Take it</button>}
          </div>
        </div>
        <div className="tasker-task-signals">
          <button type="button" aria-label={`${task.urgent ? 'Remove urgent flag from' : 'Mark urgent'} ${task.task_title}`} aria-pressed={task.urgent} title="Urgent is visible to the team" onClick={() => void onPatch(task, { urgent: !task.urgent })} className={`tasker-urgent ${task.urgent ? 'is-urgent' : ''}`}>{task.urgent && <span aria-hidden="true" />}{task.urgent ? 'Urgent' : 'Not urgent'}</button>
          <button type="button" aria-label={`${focused ? 'Remove from' : 'Add to'} My Focus: ${task.task_title}`} title="My Focus is private to you" onClick={() => void onFocus(task.row_id)} className={`tasker-focus-star ${focused ? 'is-focused' : ''}`}>{focused ? '★' : '☆'}</button>
          {onMove && focused && <div className="tasker-focus-order"><button type="button" aria-label={`Move ${task.task_title} up`} onClick={() => void onMove(task.row_id, -1)}>↑</button><button type="button" aria-label={`Move ${task.task_title} down`} onClick={() => void onMove(task.row_id, 1)}>↓</button></div>}
        </div>
      </article>
    )
  })}
  </div>
}
