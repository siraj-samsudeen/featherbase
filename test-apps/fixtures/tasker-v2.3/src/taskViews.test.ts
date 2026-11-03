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

  it('keeps unavailable person and project criteria restrictive', () => {
    const missingPerson = emptyTaskViewSetup()
    missingPerson.filters.responsiblePeople = ['Former teammate']
    expect(filterTasks(tasks, missingPerson)).toEqual([])

    const missingProject = emptyTaskViewSetup()
    missingProject.filters.projects = ['deleted-project']
    expect(filterTasks(tasks, missingProject)).toEqual([])
  })
})
