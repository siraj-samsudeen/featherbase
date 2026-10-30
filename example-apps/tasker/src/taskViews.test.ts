import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED,
  emptyTaskViewSetup,
  filterTasks,
  parseSavedTaskViews,
  taskViewSetupEquals,
  type FilterableTask,
} from './taskViews'

const tasks: (FilterableTask & { id: string })[] = [
  { id: 'a', task_title: 'Reconcile first variance', description: 'Check warehouse transfer', task_state: 'In progress', urgent: true, assigned_to: 'Shahul', project: 'stock' },
  { id: 'b', task_title: 'Photograph receiving bay', description: null, task_state: 'Not started', urgent: false, assigned_to: null, project: 'stock' },
  { id: 'c', task_title: 'Confirm inspection', description: 'Warehouse certificate', task_state: 'Blocked', urgent: true, assigned_to: 'Shahul', project: 'opening' },
  { id: 'd', task_title: 'Archive checklist', description: 'Warehouse launch record', task_state: 'Done', urgent: true, assigned_to: 'Asha', project: 'opening' },
]

describe('task view criteria', () => {
  it('searches title and current description without adding tasks outside the supplied scope', () => {
    const setup = emptyTaskViewSetup()
    setup.search = 'warehouse'
    expect(filterTasks(tasks.slice(0, 2), setup).map((task) => task.id)).toEqual(['a'])
    expect(filterTasks(tasks, setup).map((task) => task.id)).toEqual(['a', 'c', 'd'])
  })

  it('uses OR within one dimension and AND between dimensions', () => {
    const setup = emptyTaskViewSetup()
    setup.filters.states = ['Not started', 'In progress']
    setup.filters.responsiblePeople = ['Shahul', UNASSIGNED]
    setup.filters.urgencies = ['urgent']
    setup.filters.projects = ['stock', 'opening']
    expect(filterTasks(tasks, setup).map((task) => task.id)).toEqual(['a'])
  })

  it('accepts complete saved definitions and rejects malformed preference entries', () => {
    const setup = emptyTaskViewSetup()
    setup.filters.states = ['Blocked']
    const valid = { id: 'view-1', name: 'My blocked work', scope: { kind: 'work' }, setup }
    expect(parseSavedTaskViews({ views: [valid, { id: 'broken' }, null] })).toEqual([valid])
  })

  it('detects meaningful changes without depending on checkbox selection order', () => {
    const saved = emptyTaskViewSetup()
    saved.filters.states = ['Blocked', 'In progress']
    const reordered = emptyTaskViewSetup()
    reordered.filters.states = ['In progress', 'Blocked']
    expect(taskViewSetupEquals(saved, reordered)).toBe(true)
    reordered.search = 'supplier'
    expect(taskViewSetupEquals(saved, reordered)).toBe(false)
  })

  it.each(['states', 'responsiblePeople', 'urgencies', 'projects'] as const)(
    'detects a changed %s filter without modifying the saved setup', (dimension) => {
      const saved = emptyTaskViewSetup()
      saved.filters = {
        states: ['Blocked', 'In progress'], responsiblePeople: ['Shahul', 'Asha'],
        urgencies: ['urgent', 'not_urgent'], projects: ['stock', 'opening'],
      }
      const before = structuredClone(saved)
      const changed = structuredClone(saved)
      changed.filters[dimension].reverse()
      expect(taskViewSetupEquals(saved, changed)).toBe(true)
      changed.filters[dimension].pop()
      expect(taskViewSetupEquals(saved, changed)).toBe(false)
      expect(saved).toEqual(before)
    },
  )

  it('combines search with unassigned, non-urgent and project filters', () => {
    const setup = emptyTaskViewSetup()
    setup.search = '  PHOTOGRAPH  '
    setup.filters.responsiblePeople = [UNASSIGNED]
    setup.filters.urgencies = ['not_urgent']
    setup.filters.projects = ['stock']
    expect(filterTasks(tasks, setup).map((task) => task.id)).toEqual(['b'])
    setup.filters.projects = ['opening']
    expect(filterTasks(tasks, setup)).toEqual([])
    expect(filterTasks(tasks, emptyTaskViewSetup())).toEqual(tasks)
  })

  it('restores every saved-view scope but not an incomplete project or personal scope', () => {
    const scopes = [
      { kind: 'all' }, { kind: 'inbox' }, { kind: 'work' }, { kind: 'together' },
      { kind: 'project', projectId: 'stock' }, { kind: 'personal', owner: 'Asha' },
    ]
    const views = scopes.map((scope, index) => ({
      id: `view-${index}`, name: `View ${index}`, scope, setup: emptyTaskViewSetup(),
    }))
    expect(parseSavedTaskViews({ views: [...views,
      { ...views[0], scope: { kind: 'project' } },
      { ...views[0], scope: { kind: 'personal' } },
      { ...views[0], name: '   ' },
    ] })).toEqual(views)
    expect(parseSavedTaskViews(null)).toEqual([])
    expect(parseSavedTaskViews({ views: {} })).toEqual([])
  })

  it('keeps unavailable person and project criteria restrictive', () => {
    const missingPerson = emptyTaskViewSetup()
    missingPerson.filters.responsiblePeople = ['Former teammate']
    expect(filterTasks(tasks, missingPerson)).toEqual([])

    const missingProject = emptyTaskViewSetup()
    missingProject.filters.projects = ['deleted-project']
    expect(filterTasks(tasks, missingProject)).toEqual([])
  })
})
