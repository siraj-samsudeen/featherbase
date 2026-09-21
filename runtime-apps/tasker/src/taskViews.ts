export const UNASSIGNED = '__unassigned__'

export interface TaskViewFilters {
  states: string[]
  responsiblePeople: string[]
  urgencies: ('urgent' | 'not_urgent')[]
  projects: string[]
}

export interface TaskViewSetup {
  search: string
  filters: TaskViewFilters
}

export type SavedTaskViewScope =
  | { kind: 'all' }
  | { kind: 'project'; projectId: string }
  | { kind: 'inbox' }
  | { kind: 'work' }
  | { kind: 'together' }
  | { kind: 'personal'; owner: string }

export interface SavedTaskView {
  id: string
  name: string
  scope: SavedTaskViewScope
  setup: TaskViewSetup
}

export interface FilterableTask {
  task_title: string
  description?: string | null
  task_state: string
  urgent: boolean
  assigned_to: string | null
  project: string | null
}

export function emptyTaskViewSetup(): TaskViewSetup {
  return {
    search: '',
    filters: { states: [], responsiblePeople: [], urgencies: [], projects: [] },
  }
}

function selectedOrAll<T>(selected: T[], value: T): boolean {
  return selected.length === 0 || selected.includes(value)
}

// @spec task_filters_combine_dimensions
// @spec task_search_stays_in_scope
export function filterTasks<T extends FilterableTask>(tasks: T[], setup: TaskViewSetup): T[] {
  const query = setup.search.trim().toLocaleLowerCase()
  const { states, responsiblePeople, urgencies, projects } = setup.filters
  return tasks.filter((task) => {
    const textMatches = !query
      || task.task_title.toLocaleLowerCase().includes(query)
      || (task.description ?? '').toLocaleLowerCase().includes(query)
    const responsiblePerson = task.assigned_to ?? UNASSIGNED
    const urgency = task.urgent ? 'urgent' : 'not_urgent'
    return textMatches
      && selectedOrAll(states, task.task_state)
      && selectedOrAll(responsiblePeople, responsiblePerson)
      && selectedOrAll(urgencies, urgency)
      && selectedOrAll(projects, task.project ?? '')
  })
}

export function taskViewSetupEquals(left: TaskViewSetup, right: TaskViewSetup): boolean {
  const normalized = (values: string[]) => [...values].sort().join('\u0000')
  return left.search === right.search
    && normalized(left.filters.states) === normalized(right.filters.states)
    && normalized(left.filters.responsiblePeople) === normalized(right.filters.responsiblePeople)
    && normalized(left.filters.urgencies) === normalized(right.filters.urgencies)
    && normalized(left.filters.projects) === normalized(right.filters.projects)
}

export function parseSavedTaskViews(value: unknown): SavedTaskView[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { views?: unknown }).views)) return []
  return (value as { views: unknown[] }).views.filter(isSavedTaskView)
}

function isSavedTaskView(value: unknown): value is SavedTaskView {
  if (!value || typeof value !== 'object') return false
  const view = value as Partial<SavedTaskView>
  const scope = view.scope as Partial<SavedTaskViewScope> | undefined
  const setup = view.setup as Partial<TaskViewSetup> | undefined
  const filters = setup?.filters as Partial<TaskViewFilters> | undefined
  const validScope = scope?.kind === 'all'
    || scope?.kind === 'inbox'
    || scope?.kind === 'work'
    || scope?.kind === 'together'
    || (scope?.kind === 'project' && typeof scope.projectId === 'string')
    || (scope?.kind === 'personal' && typeof scope.owner === 'string')
  return typeof view.id === 'string'
    && typeof view.name === 'string'
    && view.name.trim().length > 0
    && validScope
    && typeof setup?.search === 'string'
    && Array.isArray(filters?.states)
    && Array.isArray(filters?.responsiblePeople)
    && Array.isArray(filters?.urgencies)
    && Array.isArray(filters?.projects)
}
