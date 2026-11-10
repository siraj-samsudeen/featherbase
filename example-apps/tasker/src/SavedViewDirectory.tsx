import { Button } from '@featherbase/shop-floor'
import { useState } from 'react'
import type { PersonOption } from './people'
import { UNASSIGNED, type SavedTaskView, type SavedTaskViewScope } from './taskViews'
import type { Project } from './taskRows'
import { Empty } from './Empty'

export function scopeLabel(scope: SavedTaskViewScope, projects: Map<string, Project>): string {
  if (scope.kind === 'all') return 'Across all tasks'
  if (scope.kind === 'project') return projects.get(scope.projectId)?.project_name ?? 'Unavailable project'
  if (scope.kind === 'work') return 'My Work'
  if (scope.kind === 'together') return 'Together'
  if (scope.kind === 'personal') return `${scope.owner}'s Personal tasks`
  return 'Inbox'
}

export function savedViewUnavailableReason(
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

export function SavedViewDirectory({ savedViews, projects, people, onOpen, onRename, onDelete }: {
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
