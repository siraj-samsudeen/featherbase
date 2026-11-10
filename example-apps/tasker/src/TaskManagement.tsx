import { Attention } from './Attention'
import { Button, cardClasses } from '@featherbase/shop-floor'
import { createElement, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getSessionUser, listAllResources } from './api'
import { listVisiblePeople, peopleWithTaskResponsibility, personName, PEOPLE_LIMITED_NOTICE, type PersonOption } from './people'
import { ProjectDescription } from './ProjectDescription'
import { ProjectVerifier, ToVerifyPage } from './Closure'
import { waitingFor } from './verification'
import { IssuesPage, useIssues } from './Issues'
import { StoresContext, StoresPage, type Store } from './Stores'
import { localDay } from './storeWork'
import {
  UNASSIGNED,
  emptyTaskViewSetup,
  filterTasks,
  parseSavedTaskViews,
  type SavedTaskView,
  type SavedTaskViewScope,
  type TaskViewSetup,
} from './taskViews'
import { TASK_FIELDS, type Project, type Task } from './taskRows'
import { hashSavedViewId, hashTaskId, sameDocumentHash, savedViewHash } from './taskHash'
import { TaskerIcon, type TaskerIconName } from './TaskerIcon'
import { Empty } from './Empty'
import { TaskDetail, type DetailMode, type TaskComment } from './TaskDetail'
import { TaskList } from './TaskList'
import { TaskViewToolbar } from './TaskViewToolbar'

type View = 'inbox' | 'work' | 'verify' | 'issues' | 'together' | 'stores' | 'projects' | 'personal' | 'views'

const FOCUS_SETTINGS = 'Task Management Focus'
const PROJECT_SETTINGS = 'tasker.projects'
const PREFERENCE_SETTINGS = 'tasker.preferences'
const SAVED_VIEWS_SETTINGS = 'tasker.saved-views'

export function TaskManagementPage() {
  const queryClient = useQueryClient()
  const me = getSessionUser()?.row_id ?? ''
  const [view, setView] = useState<View>(() => hashSavedViewId() ? 'views' : new URLSearchParams(location.hash.slice(1)).has('issue') ? 'issues' : 'work')
  const [capture, setCapture] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectTask, setProjectTask] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const personalOwner = me
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [selectedTask, setSelectedTask] = useState(hashTaskId)
  const [activeSavedViewId, setActiveSavedViewId] = useState(hashSavedViewId)
  const [taskViewSetup, setTaskViewSetup] = useState<TaskViewSetup>(emptyTaskViewSetup)
  const previousSurface = useRef('')
  const preferenceWrites = useRef(new Map<string, {
    saved: unknown; pending: number; tail: Promise<void>; uncertain: boolean
  }>())

  useEffect(() => {
    const change = () => {
      setSelectedTask(hashTaskId())
      const savedViewId = hashSavedViewId()
      setActiveSavedViewId(savedViewId)
      if (savedViewId) setView('views')
      if (new URLSearchParams(location.hash.slice(1)).has('issue')) setView('issues')
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])

  const tasks = useQuery({
    queryKey: ['task-management', 'tasks'],
    queryFn: () =>
      listAllResources<Task>('tasker.task', {
        fields: TASK_FIELDS,
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })
  const projects = useQuery({
    queryKey: ['task-management', 'projects'],
    queryFn: () =>
      listAllResources<Project>('tasker.project', {
        fields: ['row_id', 'project_name', 'description', 'default_verifier', 'updated_at'],
        order_by: 'project_name asc',
        limit_page_length: 200,
      }),
  })
  const users = useQuery({
    queryKey: ['task-management', 'users'],
    queryFn: () =>
      listVisiblePeople(() => api.get<{ data: PersonOption[] }>('/api/table_members/tasker.discussion')),
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
  const stores = useQuery({
    queryKey: ['task-management', 'stores'],
    queryFn: () =>
      listAllResources<Store>('tasker.store', {
        fields: ['row_id', 'store_name', 'store_type', 'store_manager', 'opens_at', 'closes_at', 'updated_at'],
        order_by: 'store_name asc',
        limit_page_length: 200,
      }),
  })
  const issueRows = useIssues()
  const comments = useQuery({
    queryKey: ['task-management', 'comments'],
    queryFn: () =>
      listAllResources<TaskComment>('Comment', {
        filters: [['ref_table', '=', 'tasker.task']],
        fields: ['ref_name', 'content', 'created_by', 'created_at'],
        order_by: 'created_at asc',
        limit_page_length: 500,
      }),
  })

  const storedTasks = tasks.data?.data ?? []
  const parentsById = new Map(storedTasks.map(task => [task.row_id, task]))
  const allTasks = storedTasks.map(task => {
    const parent = task.parent_task && parentsById.get(task.parent_task)
    return parent ? { ...task, project: parent.project, shared: parent.shared, store: parent.store } : task
  })
  const openChildren = new Map<string, number>()
  for (const task of allTasks) if (task.parent_task && !['Done', 'Cancelled'].includes(task.task_state))
    openChildren.set(task.parent_task, (openChildren.get(task.parent_task) ?? 0) + 1)
  const byId = new Map(allTasks.map((task) => [task.row_id, task]))
  const latestExplanation = new Map<string, string>()
  for (const comment of comments.data?.data ?? [])
    latestExplanation.set(comment.ref_name, comment.content)
  const focusIds = (focus.data?.settings?.task_ids ?? []).filter((id) => byId.has(id))
  const focusSet = new Set(focusIds)
  const inbox = allTasks.filter((task) => !task.parent_task && !task.shared && !task.project && !task.personal_tasks_owner)
  const focused = focusIds.map((id) => byId.get(id)!)
  const myWork = [
    ...focused,
    ...allTasks.filter((task) => task.assigned_to === me && !focusSet.has(task.row_id)),
  ]
  const projectRows = allTasks.filter((task) => !task.parent_task && task.project === selectedProject)
  const personalRows = allTasks.filter((task) => !task.shared && task.personal_tasks_owner === personalOwner)
  const allProjects = projects.data?.data ?? []
  const projectById = new Map(allProjects.map((project) => [project.row_id, project]))
  const projectTaskCounts = new Map(allProjects.map((project) => [
    project.row_id,
    allTasks.filter((task) => !task.parent_task && task.project === project.row_id).length,
  ]))
  const starredProjectIds = (projectPreferences.data?.settings?.project_ids ?? []).filter((id) => projectById.has(id))
  const starredProjectSet = new Set(starredProjectIds)
  const detailMode = detailPreferences.data?.settings?.mode ?? 'inspector'
  const people = peopleWithTaskResponsibility(users.data?.people ?? [], allTasks, me)
  const savedViews = parseSavedTaskViews(savedViewPreferences.data?.settings)
  const activeSavedView = savedViews.find((savedView) => savedView.id === activeSavedViewId)
  const toVerify = waitingFor(allTasks, me)
  const openIssues = (issueRows.data?.data ?? []).filter(issue => issue.issue_state !== 'Closed').length
  const nameOf = (id: string) => personName(people.find(person => person.row_id === id))
  const activeTogetherTasks = allTasks.filter((task) => task.shared && !['Done', 'Cancelled'].includes(task.task_state))

  function copySetup(setup: TaskViewSetup): TaskViewSetup {
    return {
      search: setup.search,
      filters: {
        states: [...setup.filters.states],
        responsiblePeople: [...setup.filters.responsiblePeople],
        urgencies: [...setup.filters.urgencies],
        projects: [...setup.filters.projects],
        stores: [...setup.filters.stores],
        dueMarks: [...setup.filters.dueMarks],
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

  async function patchTask(task: Task, patch: Partial<Task> & { change_reason?: string }) {
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

  async function writePreference(name: string, query: string, settings: unknown) {
    const key = ['task-management', query]
    // A read started before this write must not replace its confirmed value.
    await queryClient.cancelQueries({ queryKey: key })
    const writes = preferenceWrites.current.get(query) ?? {
      saved: queryClient.getQueryData(key) ?? { settings: null },
      pending: 0, tail: Promise.resolve(), uncertain: false,
    }
    preferenceWrites.current.set(query, writes)
    // Preserve user order at the server while showing the latest choice now.
    const previous = writes.tail
    let advance!: () => void
    writes.tail = new Promise<void>(resolve => { advance = resolve })
    writes.pending++
    const optimistic = queryClient.setQueryData(key, { settings })
    try {
      await previous
      await api.put(`/api/user_settings/${encodeURIComponent(name)}`, settings)
      writes.saved = { settings }
    } catch (err) {
      // A refusal did not persist. A lost response or server error might have.
      const refused = err instanceof ApiError && err.status !== undefined && err.status < 500
      writes.uncertain ||= !refused
      if (refused && queryClient.getQueryData(key) === optimistic) queryClient.setQueryData(key, writes.saved)
      throw err
    } finally {
      if (--writes.pending === 0) {
        preferenceWrites.current.delete(query)
        queryClient.setQueryData(key, writes.saved)
        if (writes.uncertain) await queryClient.invalidateQueries({ queryKey: key })
      }
      advance()
    }
  }

  async function saveFocus(ids: string[]) {
    setError(null)
    try {
      await writePreference(FOCUS_SETTINGS, 'focus', { task_ids: ids })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update My Focus')
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
    try {
      await writePreference(PROJECT_SETTINGS, 'project-preferences', { project_ids: ids })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update project tabs')
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
    setError(null)
    try {
      await writePreference(PREFERENCE_SETTINGS, 'detail-preferences', { mode })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save detail view')
    }
  }

  async function saveViews(next: SavedTaskView[]) {
    setError(null)
    try {
      await writePreference(SAVED_VIEWS_SETTINGS, 'saved-views', { views: next })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save task views')
      throw err
    }
  }

  async function createSavedView(name: string, scope: SavedTaskViewScope) {
    const trimmed = name.trim()
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
    if (savedViews.some((candidate) => candidate.id !== savedView.id && candidate.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setError(`A saved view named “${trimmed}” already exists`)
      return
    }
    await saveViews(savedViews.map((candidate) => candidate.id === savedView.id ? { ...candidate, name: trimmed } : candidate))
  }

  async function deleteSavedView(savedView: SavedTaskView) {
    await saveViews(savedViews.filter((candidate) => candidate.id !== savedView.id))
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
    { id: 'verify', label: 'To verify', icon: 'verify', count: toVerify.length },
    { id: 'issues', label: 'Issues', icon: 'issues', count: openIssues },
    { id: 'together', label: 'Together', icon: 'together' },
    { id: 'stores', label: 'Stores', icon: 'stores' },
    {
      id: 'personal',
      label: 'Personal tasks',
      icon: 'personal',
      count: allTasks.filter((task) => !task.shared && task.personal_tasks_owner === me).length,
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

  const allStores = stores.data?.data ?? []
  const today = localDay()

  return (
    <StoresContext.Provider value={allStores}>
    <div className="tasker-shell" data-view={view} data-testid="task-management-page">
      {createElement('featherbase-sidebar', { className: 'tasker-sidebar', 'aria-label': 'Task views' }, <>
        {primaryTabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            onClick={() => leaveSavedView(tab.id)}
            aria-current={view === tab.id ? 'page' : undefined}
            className={`tasker-nav-item tasker-nav-${tab.id}`}
          >
            <TaskerIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.count != null && <span className="tasker-count">{tab.count}</span>}
          </Button>
        ))}
        <Button type="button" onClick={() => leaveSavedView('views')} aria-current={view === 'views' ? 'page' : undefined} className="tasker-nav-item tasker-nav-views">
          <TaskerIcon name="views" />
          <span>Views</span>
          {savedViews.length > 0 && <span className="tasker-count">{savedViews.length}</span>}
        </Button>
        <Button type="button" onClick={() => leaveSavedView('projects', '')} aria-current={view === 'projects' && !selectedProject ? 'page' : undefined} className="tasker-nav-item tasker-nav-projects">
          <TaskerIcon name="projects" />
          <span>Projects</span>
        </Button>
          {allProjects.map((project) => (
              <Button key={project.row_id} type="button" data-depth="1" className="tasker-sidebar-project-name" aria-label={project.project_name} aria-current={view === 'projects' && selectedProject === project.row_id ? 'page' : undefined} onClick={() => leaveSavedView('projects', project.row_id)}>
                <span>{project.project_name}</span>
                <span className="tasker-count">{projectTaskCounts.get(project.row_id)!}</span>
              </Button>
          ))}
      </>)}
      <main className="tasker-main">
      {starredProjectIds.length > 0 && (
        <div className="tasker-project-tabs" aria-label="Starred projects">
          {starredProjectIds.map((id) => (
            <Button key={id} type="button" aria-current={view === 'projects' && selectedProject === id ? 'page' : undefined}
              onClick={() => leaveSavedView('projects', id)}>
              {projectById.get(id)?.project_name}
            </Button>
          ))}
        </div>
      )}
      {tasks.error && <p role="alert" className="mb-4">{tasks.error.message} · <a href="/featherbase/admin">Back to Featherbase</a></p>}
      {error && <p role="alert" className="mb-4 rounded-md bg-negative-tint px-3 py-2 pointer-fine:text-sm text-negative">{error}</p>}
      {users.data?.limited && <p role="status" className="mb-4 rounded-md px-3 py-2 pointer-fine:text-sm text-[var(--color-ink-muted)]">{PEOPLE_LIMITED_NOTICE}</p>}
      {selectedTask && detailMode === 'compact' && (
        <div className="tasker-compact-detail">
          <TaskDetail id={selectedTask} mode={detailMode} onMode={setDetailMode} onSaved={refresh} people={people} projects={allProjects} onCompleted={actionCompleted} />
        </div>
      )}

      {(view === 'work' || view === 'inbox') && (
          <form
            className="tasker-composer"
            onSubmit={async (event) => {
              event.preventDefault()
              const title = capture
              try {
                await createTask(title)
                setCapture('')
                setView('inbox')
              } catch { /* message is shown above */ }
            }}
          >
            <label className="sr-only" htmlFor="quick-capture">Quick capture</label>
            <input
              id="quick-capture" readOnly={saving}
              value={capture}
              onChange={(event) => setCapture(event.target.value)}
              placeholder="Capture a private task, just for you…"
              className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pointer-fine:text-sm outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action)]/15"
              autoFocus={view === 'inbox'}
            />
            <Button type="submit" variant="primary"  disabled={saving || !capture.trim()}>Add</Button>
          </form>
      )}

      {view === 'inbox' && (
        <section aria-labelledby="inbox-heading">
          <SectionTitle id="inbox-heading" title="Inbox" hint="Capture first. Decide where it belongs when you are ready." />

          {toolbarFor(inbox, filteredInbox, { kind: 'inbox' }, 'Inbox', true)}
          {filteredInbox.length
            ? <TaskList openChildren={openChildren} tasks={filteredInbox} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            : <NoTaskMatches total={inbox.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'work' && (
        <section aria-labelledby="work-heading">
          <SectionTitle id="work-heading" title="My Work" hint="Your private focus order, followed by work assigned to you" />
          <Attention tasks={allTasks} onOpen={(id, question) => { void setDetailMode('inspector'); location.hash = `task=${encodeURIComponent(id)}&question=${encodeURIComponent(question)}` }} />
          {toolbarFor(myWork, filteredMyWork, { kind: 'work' }, 'My Work', true)}
          <h3 className="mt-5 mb-3 font-semibold">My Focus</h3>
          {filteredMyWork.filter(task => focusSet.has(task.row_id)).length === 0 && <p className="text-ink-muted text-sm">Choose Focus on a task to keep it here.</p>}
          <TaskList openChildren={openChildren} tasks={filteredMyWork.filter(task => focusSet.has(task.row_id))} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} onMove={moveFocus} />
          <h3 className="mt-5 mb-3 font-semibold">Also assigned to me</h3>
          <TaskList openChildren={openChildren} tasks={filteredMyWork.filter(task => !focusSet.has(task.row_id))} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
          {!filteredMyWork.length && <NoTaskMatches total={myWork.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'issues' && <IssuesPage me={me} people={people} nameOf={nameOf} onSaved={refresh} />}

      {view === 'verify' && <ToVerifyPage tasks={toVerify} nameOf={nameOf} hrefFor={(id) => sameDocumentHash(`#task=${encodeURIComponent(id)}`)} />}

      {view === 'together' && (
        <section aria-labelledby="together-heading">
          <SectionTitle id="together-heading" title="Together" hint="Active work grouped by who has responsibility" />
          {toolbarFor(activeTogetherTasks, filteredTogether, { kind: 'together' }, 'Together', true, 'Active work only')}
          {[null, ...people.map((person) => person.row_id)].map((owner) => {
            const rows = filteredTogether.filter((task) => task.assigned_to === owner)
            if (!rows.length) return null
            return <div key={owner ?? 'unassigned'} className="mb-7">
              <h3 className="mb-2 pointer-fine:text-sm font-semibold">{owner ? personName(people.find(person => person.row_id === owner)) : 'Unassigned'} <span className="font-normal text-[var(--color-ink-muted)]">{rows.length}</span></h3>
              <TaskList openChildren={openChildren} tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            </div>
          })}
          {!filteredTogether.length && <NoTaskMatches total={activeTogetherTasks.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
        </section>
      )}

      {view === 'stores' && (
        <StoresPage
          tasks={allTasks.filter((task) => !task.parent_task)}
          today={today}
          onStoreAdded={refresh}
          renderTasks={(rows) => rows.length
            ? <TaskList openChildren={openChildren} tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
            : <Empty text="No tasks here." />}
        />
      )}

      {view === 'projects' && (
        <section aria-labelledby="projects-heading" className="tasker-project-workspace">
            {selectedProject && projectById.has(selectedProject) ? (
              <>
                <ProjectHeading
                  key={`heading:${selectedProject}`}
                  project={projectById.get(selectedProject)!}
                  starred={starredProjectSet.has(selectedProject)}
                  onRename={renameProject}
                  onToggleStar={() => toggleProjectStar(selectedProject)}
                  onMoveStar={(offset) => moveProjectStar(selectedProject, offset)}
                />
                <ProjectDescription key={selectedProject} project={projectById.get(selectedProject)!} onSaved={refresh} />
                <ProjectVerifier project={projectById.get(selectedProject)!} people={people} nameOf={nameOf} onSaved={refresh} />
                <form className="tasker-composer" onSubmit={async (event) => { event.preventDefault(); const title = projectTask; try { await createTask(title, { project: selectedProject }); setProjectTask('') } catch { /* shown above */ } }}>
                  <label className="sr-only" htmlFor="project-task">Add task to project</label>
                  <input id="project-task" readOnly={saving} value={projectTask} onChange={(event) => setProjectTask(event.target.value)} placeholder="Add a task, then press Enter" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pointer-fine:text-sm" autoFocus />
                  <Button type="submit" variant="primary"  disabled={saving || !projectTask.trim()}>Add</Button>
                </form>
                {toolbarFor(projectRows, filteredProjectRows, { kind: 'project', projectId: selectedProject }, 'This project', false)}
                {filteredProjectRows.length
                  ? <TaskList openChildren={openChildren} tasks={filteredProjectRows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
                  : <NoTaskMatches total={projectRows.length} setup={taskViewSetup} onSetup={setTaskViewSetup} />}
              </>
            ) : <>
              <SectionTitle id="projects-heading" title="Projects" hint="Choose an existing project or create a new shared workspace." />
              <form className="tasker-project-create" onSubmit={(event) => { event.preventDefault(); void createProject() }}>
                <label htmlFor="project-name">New project</label>
                <div>
                  <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" />
                  <Button type="submit" variant="primary"  disabled={creatingProject || !projectName.trim()}>Create project</Button>
                </div>
              </form>
              <div className="tasker-project-directory" aria-label="All projects">
                {allProjects.map((project) => (
                  <Button key={project.row_id} type="button" aria-label={`Open project ${project.project_name}`} onClick={() => setSelectedProject(project.row_id)} className="tasker-project-directory-item">
                    <span className="tasker-project-directory-icon" aria-hidden="true"><TaskerIcon name="projects" /></span>
                    <span>
                      <strong>{project.project_name}</strong>
                      <small>{projectTaskCounts.get(project.row_id)!} {projectTaskCounts.get(project.row_id)! === 1 ? 'task' : 'tasks'}</small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Button>
                ))}
                {!allProjects.length && <Empty text="No projects yet. Create the first one above." />}
              </div>
            </>}
        </section>
      )}

      {view === 'personal' && (
        <section aria-labelledby="personal-heading">
          <SectionTitle id="personal-heading" title="Personal tasks" hint="Your personal tasks are visible only to you" />
          <form className={cardClasses("mb-5 flex gap-2 p-3")} onSubmit={async (event) => { event.preventDefault(); const title = capture; try { await createTask(title, { personal_tasks_owner: personalOwner }); setCapture('') } catch { /* shown above */ } }}>
            <label className="sr-only" htmlFor="personal-capture">Add personal task</label>
            <input id="personal-capture" readOnly={saving} value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="Add a personal task" className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pointer-fine:text-sm" autoFocus />
            <Button type="submit" variant="primary"  disabled={saving || !capture.trim()}>Add</Button>
          </form>
          {toolbarFor(personalRows, filteredPersonalRows, { kind: 'personal', owner: personalOwner }, `${personalOwner}'s Personal tasks`, true)}
          {filteredPersonalRows.length
            ? <TaskList openChildren={openChildren} tasks={filteredPersonalRows} users={people} projects={projects.data?.data ?? []} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} />
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
                  <h3 className="mb-2 pointer-fine:text-sm font-semibold">{owner ? personName(people.find(person => person.row_id === owner)) : 'Unassigned'} <span className="font-normal text-[var(--color-ink-muted)]">{rows.length}</span></h3>
                  <TaskList openChildren={openChildren} tasks={rows} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} savedViewId={activeSavedView.id} />
                </div>
              })}
            </> : filteredSavedViewTasks.length
              ? <TaskList openChildren={openChildren} tasks={filteredSavedViewTasks} users={people} projects={allProjects} focusSet={focusSet} me={me} explanations={latestExplanation} onPatch={patchTask} onFocus={toggleFocus} savedViewId={activeSavedView.id} />
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
    </StoresContext.Provider>
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
  people: PersonOption[],
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

function NoTaskMatches({ total, setup, onSetup }: { total: number; setup: TaskViewSetup; onSetup: (setup: TaskViewSetup) => void }) {
  if (total === 0) return <Empty text="Nothing here yet." />
  return <div className={cardClasses("tasker-no-matches")}>
    <strong>No tasks match this search and filters</strong>
    <p>0 of {total} tasks. Your criteria are still applied.</p>
    <div>
      {setup.search && <Button type="button"  onClick={() => onSetup({ ...setup, search: '' })}>Clear search</Button>}
      <Button type="button"  onClick={() => onSetup({ ...setup, filters: emptyTaskViewSetup().filters })}>Clear all filters</Button>
    </div>
  </div>
}

function SavedViewDirectory({ savedViews, projects, people, onOpen, onRename, onDelete }: {
  savedViews: SavedTaskView[]
  projects: Map<string, Project>
  people: PersonOption[]
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
          try {
            await onRename(savedView, name)
            setRenaming(null)
          } catch { /* parent shows the failure; retain the draft */ }
        }}>
          <label className="sr-only" htmlFor={`rename-view-${savedView.id}`}>Rename saved view</label>
          <input id={`rename-view-${savedView.id}`} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="primary"  disabled={!name.trim()}>Save</Button>
          <Button type="button"  onClick={() => setRenaming(null)}>Cancel</Button>
        </form> : <>
          <Button type="button" className="tasker-saved-view-open" onClick={() => onOpen(savedView)}>
            <strong>{savedView.name}</strong>
            <span>{scopeLabel(savedView.scope, projects)}</span>
            {unavailable && <em>{unavailable}</em>}
          </Button>
          <div className="tasker-saved-view-actions">
            <Button type="button"  onClick={() => { setRenaming(savedView.id); setName(savedView.name) }}>Rename</Button>
            <Button type="button"  onClick={() => {
              if (window.confirm(`Delete private saved view “${savedView.name}”?`)) void onDelete(savedView)
            }}>Delete</Button>
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
  const [draft, setDraft] = useState<Project | null>(null)
  if (draft) return <form className="mb-3 flex gap-2" onSubmit={async (event) => {
    event.preventDefault()
    const next = draft.project_name.trim()
    try { await onRename(draft, next); setDraft(null) } catch { /* parent shows error */ }
  }}>
    <label className="sr-only" htmlFor="rename-project">Project name</label>
    <input id="rename-project" aria-label="Rename project" autoFocus value={draft.project_name} onChange={(event) => setDraft({ ...draft, project_name: event.target.value })} className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-base font-semibold" />
    <Button type="submit" variant="primary"  disabled={!draft.project_name.trim()}>Save</Button>
    <Button type="button"  onClick={() => setDraft(null)}>Cancel</Button>
  </form>
  return <div className="mb-3 flex items-start justify-between gap-3">
    <SectionTitle title={project.project_name} hint="Tasks begin unassigned; someone can take responsibility when work starts" />
    <div className="tasker-project-heading-actions">
      <Button type="button"  onClick={() => void onToggleStar()}>{starred ? '★ Starred tab' : '☆ Add to tabs'}</Button>
      {starred && <>
        <Button type="button"  aria-label={`Move project ${project.project_name} tab left`} onClick={() => void onMoveStar(-1)}>←</Button>
        <Button type="button"  aria-label={`Move project ${project.project_name} tab right`} onClick={() => void onMoveStar(1)}>→</Button>
      </>}
      <Button type="button"  onClick={() => setDraft({ ...project })}>Rename</Button>
    </div>
  </div>
}
