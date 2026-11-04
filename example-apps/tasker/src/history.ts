import type { PersonOption } from './people'

const PERSON_FIELDS = new Set(['assigned_to', 'personal_tasks_owner'])

/** A value in a task's activity history, as a person reads it: names, never record ids. */
export function describeHistoryValue(field: string, value: unknown,
  { people, projects }: { people: PersonOption[]; projects: { row_id: string; project_name: string }[] }) {
  if (value == null || value === '') return 'empty'
  if (PERSON_FIELDS.has(field)) return people.find(person => person.row_id === value)?.full_name || 'Former member'
  if (field === 'project') return projects.find(project => project.row_id === value)?.project_name ?? 'Project not available'
  return String(value)
}
