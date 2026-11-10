import { TASK_STATES } from './task-states'
import { Recurrence } from './RecurrenceControls'
import { Subtasks } from './Subtasks'
import { Attention } from './Attention'
import { Discussion } from './Discussion'
import { Button, cardClasses, buttonClasses } from '@featherbase/shop-floor'
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { rowHref } from '../../../packages/shared/src/app-routes'
import { fmtDate, fmtDateTime } from '@featherbase/shop-floor'
import { ApiError, api, getSessionUser, listAllResources } from './api'
import { listVisiblePeople, peopleWithTaskResponsibility, personName, PEOPLE_LIMITED_NOTICE, type PersonOption } from './people'
import { Markdown } from './Markdown'
import { describeHistoryValue } from './history'
import { ProjectDescription } from './ProjectDescription'
import { TaskActions } from './TaskActions'
import { ClosureNotes, ProjectVerifier, ReasonForm, ToVerifyPage, VerificationPanel } from './Closure'
import { SUBMITTED, waitingFor } from './verification'
import { IssuesPage, useIssues } from './Issues'
import { StoresContext, StoresPage, TaskStoreAndDue, dueNote, storeName, useStores, type Store } from './Stores'
import { DUE_MARKS, DUE_MARK_LABELS, NO_STORE, calendarDay, dueMark, localDay } from './storeWork'
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
import { TASK_FIELDS, type Project, type Task } from './taskRows'
import { hashSavedViewId, hashTaskId, sameDocumentHash, savedViewHash } from './taskHash'

type View = 'inbox' | 'work' | 'verify' | 'issues' | 'together' | 'stores' | 'projects' | 'personal' | 'views'
type DetailMode = 'compact' | 'inspector' | 'focus'

interface TaskComment {
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

const STATES = TASK_STATES
const FOCUS_SETTINGS = 'Task Management Focus'
const PROJECT_SETTINGS = 'tasker.projects'
const PREFERENCE_SETTINGS = 'tasker.preferences'
const SAVED_VIEWS_SETTINGS = 'tasker.saved-views'

type TaskerIconName = 'inbox' | 'work' | 'verify' | 'issues' | 'together' | 'stores' | 'projects' | 'personal' | 'views'

function TaskerIcon({ name }: { name: TaskerIconName }) {
  const paths: Record<TaskerIconName, ReactNode> = {
    inbox: <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l2 2h4l2-2h4" /></>,
    work: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6" /></>,
    verify: <><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.6 2.6 5-5.4" /></>,
    issues: <><path d="M12 4 3.5 19h17z" /><path d="M12 10v4M12 16.8v.2" /></>,
    together: <><circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9" r="2" /><path d="M3.5 19c.5-3.5 2.3-5.2 5.5-5.2s5 1.7 5.5 5.2" /><path d="M14.5 14.4c3.3-.4 5.3 1.1 6 4.1" /></>,
    stores: <><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5c0 1.5 1.2 2.5 2.7 2.5S9.3 11 9.3 9.5c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.1 2.5 2.6 2.5S20 11 20 9.5" /><path d="M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5" /></>,
    projects: <><path d="M3.5 7.5h6l2-2h9v13h-17z" /><path d="M3.5 9.5h17" /></>,
    personal: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4V2.8M15 4V2.8M8.5 10h7M8.5 14h5" /></>,
    views: <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="8" cy="7" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="11" cy="17" r="1.5" /></>,
  }
  return <svg className="tasker-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

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
  people: PersonOption[]
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
  const stores = useStores()
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
      [dimension]: (setup.filters[dimension] as string[]).filter((candidate) => candidate !== value),
    })
  }

  const chips: { key: string; label: string; remove?: () => void }[] = []
  if (builtInCriterion) chips.push({ key: 'built-in', label: builtInCriterion })
  for (const state of setup.filters.states)
    chips.push({ key: `state:${state}`, label: state, remove: () => removeFilter('states', state) })
  for (const person of setup.filters.responsiblePeople)
    chips.push({ key: `person:${person}`, label: person === UNASSIGNED ? 'Unassigned' : personName(people.find(candidate => candidate.row_id === person)), remove: () => removeFilter('responsiblePeople', person) })
  for (const urgency of setup.filters.urgencies)
    chips.push({ key: `urgency:${urgency}`, label: urgency === 'urgent' ? 'Urgent' : 'Not urgent', remove: () => removeFilter('urgencies', urgency) })
  for (const projectId of setup.filters.projects)
    chips.push({ key: `project:${projectId}`, label: projects.find((project) => project.row_id === projectId)?.project_name ?? 'Unavailable project', remove: () => removeFilter('projects', projectId) })
  for (const storeId of setup.filters.stores)
    chips.push({ key: `store:${storeId}`, label: storeName(stores, storeId), remove: () => removeFilter('stores', storeId) })
  for (const mark of setup.filters.dueMarks)
    chips.push({ key: `due:${mark}`, label: DUE_MARK_LABELS[mark], remove: () => removeFilter('dueMarks', mark) })

  async function submitSavedView(event: React.FormEvent) {
    event.preventDefault()
    const scope = scopeKind === 'all' ? { kind: 'all' as const } : currentScope
    try {
      await onCreate(name, scope)
      setName('')
      setSavingAsNew(false)
    } catch { /* parent shows the failure; retain the draft */ }
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
      <Button
        ref={filterButton}
        type="button"
        className="tasker-filter-button"
        aria-expanded={filtersOpen}
        aria-controls="tasker-filter-controls"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        Filter{chips.filter((chip) => chip.remove).length ? ` (${chips.filter((chip) => chip.remove).length})` : ''}
      </Button>
      {activeSavedView && dirty && <>
        <Button type="button"  onClick={() => void onUpdate(activeSavedView)}>Update view</Button>
        <Button type="button"  onClick={onReset}>Reset</Button>
      </>}
      <Button type="button"  onClick={() => setSavingAsNew((open) => !open)}>
        {activeSavedView ? 'Save as new' : 'Save view'}
      </Button>
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
          ? <Button key={chip.key} type="button" onClick={chip.remove} aria-label={`Remove ${chip.label} filter`}>{chip.label} <span aria-hidden="true">×</span></Button>
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
        <Button type="submit" variant="primary"  disabled={!name.trim()}>Save private view</Button>
        <Button type="button"  onClick={() => { setSavingAsNew(false); setName('') }}>Cancel</Button>
      </div>
      <p>Only you can see this saved view. Tasks are not changed.</p>
    </form>}
  </div>
}

function TaskFilterControls({ filters, people, projects, showProjects, onFilters, onClear, onClose }: {
  filters: TaskViewFilters
  people: PersonOption[]
  projects: Project[]
  showProjects: boolean
  onFilters: (filters: TaskViewFilters) => void
  onClear: () => void
  onClose: () => void
}) {
  const stores = useStores()
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
    <Button type="button" className="tasker-filter-backdrop" aria-label="Close filters" onClick={onClose} />
    <div id="tasker-filter-controls" className="tasker-filter-popover" role="dialog" aria-label="Filter tasks" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }}>
      <div className="tasker-filter-heading"><strong>Filters</strong><Button type="button" aria-label="Close filters" onClick={onClose}>×</Button></div>
      <FilterGroup label="State" values={STATES} selected={filters.states} onToggle={(value) => toggle('states', value)} firstControl={firstControl} />
      <FilterGroup label="Responsible person" values={[UNASSIGNED, ...people.map((person) => person.row_id)]} labels={new Map([[UNASSIGNED, 'Unassigned'], ...people.map(person => [person.row_id, personName(person)] as [string, string])])} selected={filters.responsiblePeople} onToggle={(value) => toggle('responsiblePeople', value)} />
      <FilterGroup label="Urgency" values={['urgent', 'not_urgent']} labels={new Map([['urgent', 'Urgent'], ['not_urgent', 'Not urgent']])} selected={filters.urgencies} onToggle={(value) => toggle('urgencies', value as TaskViewFilters['urgencies'][number])} />
      {showProjects && <FilterGroup label="Project" values={projects.map((project) => project.row_id)} labels={new Map(projects.map((project) => [project.row_id, project.project_name]))} selected={filters.projects} onToggle={(value) => toggle('projects', value)} />}
      <FilterGroup label="Store" values={[...stores.map((store) => store.row_id), NO_STORE]} labels={new Map([...stores.map((store) => [store.row_id, store.store_name] as [string, string]), [NO_STORE, 'No store']])} selected={filters.stores} onToggle={(value) => toggle('stores', value)} />
      <FilterGroup label="Due" values={DUE_MARKS} labels={new Map(Object.entries(DUE_MARK_LABELS))} selected={filters.dueMarks} onToggle={(value) => toggle('dueMarks', value as TaskViewFilters['dueMarks'][number])} />
      <div className="tasker-filter-actions"><Button type="button" onClick={onClear}>Clear all</Button><Button type="button" variant="primary"  onClick={onClose}>Close</Button></div>
    </div>
  </div>
}

function FilterGroup({ label, values, labels = new Map(), selected, onToggle, firstControl }: {
  label: string
  values: readonly string[]
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

function TaskDetail({ id, mode, onMode, onSaved, people, projects, onCompleted }: {
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

function Empty({ text }: { text: string }) {
  return <div className={cardClasses("border-dashed px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]")}>{text}</div>
}

function TaskList({ tasks, openChildren, users, projects, focusSet, me, explanations, onPatch, onFocus, onMove, savedViewId }: {
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
