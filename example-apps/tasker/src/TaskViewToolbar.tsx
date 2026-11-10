import { STATES } from './task-states'
import { Button } from '@featherbase/shop-floor'
import { useEffect, useRef, useState } from 'react'
import { personName, type PersonOption } from './people'
import { storeName, useStores } from './Stores'
import { DUE_MARKS, DUE_MARK_LABELS, NO_STORE } from './storeWork'
import {
  UNASSIGNED,
  emptyTaskViewSetup,
  taskViewSetupEquals,
  type SavedTaskView,
  type SavedTaskViewScope,
  type TaskViewFilters,
  type TaskViewSetup,
} from './taskViews'
import type { Project } from './taskRows'

export function TaskViewToolbar({
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
