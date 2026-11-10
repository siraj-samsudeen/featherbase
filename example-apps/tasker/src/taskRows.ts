export interface Task {
  row_id: string
  task_title: string
  shared: boolean
  created_by: string
  parent_task: string | null
  recurrence: string | null
  description: string | null
  task_state: string
  is_done: boolean
  urgent: boolean
  project: string | null
  personal_tasks_owner: string | null
  assigned_to: string | null
  store: string | null
  start_date: string | null
  due_date: string | null
  verifier: string | null
  acknowledged_at: string | null
  evidence_note: string | null
  evidence_photo: string | null
  submitted_by: string | null
  submitted_at: string | null
  verified_by: string | null
  verified_at: string | null
  return_reason: string | null
  return_count: number | null
  original_due_date: string | null
  extension_count: number | null
  cancel_reason: string | null
  updated_at: string
}

export interface Project {
  row_id: string
  project_name: string
  description: string | null
  default_verifier: string | null
  updated_at: string
}

export const TASK_FIELDS = [
  'row_id',
  'task_title',
  'shared',
  'created_by',
  'parent_task',
  'recurrence',
  'description',
  'task_state',
  'is_done',
  'urgent',
  'project',
  'personal_tasks_owner',
  'assigned_to',
  'store',
  'start_date',
  'due_date',
  'verifier',
  'acknowledged_at',
  'evidence_note',
  'evidence_photo',
  'submitted_by',
  'submitted_at',
  'verified_by',
  'verified_at',
  'return_reason',
  'return_count',
  'original_due_date',
  'extension_count',
  'cancel_reason',
  'created_at',
  'updated_at',
]
