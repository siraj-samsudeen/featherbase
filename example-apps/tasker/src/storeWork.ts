// Dates are calendar days as 'YYYY-MM-DD', so plain string comparison orders them.
export const NO_STORE = '__no_store__'

export type DueMark = 'overdue' | 'due_today' | 'scheduled'
export const DUE_MARKS: readonly DueMark[] = ['overdue', 'due_today', 'scheduled']
export const DUE_MARK_LABELS: Record<DueMark, string> = { overdue: 'Overdue', due_today: 'Due today', scheduled: 'Scheduled' }

export interface DatedTask {
  task_state: string
  start_date?: string | null
  due_date?: string | null
}

export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function settled(task: DatedTask) {
  return task.task_state === 'Done' || task.task_state === 'Cancelled'
}

export function dueMark(task: DatedTask, today: string): DueMark | null {
  if (settled(task)) return null
  if (task.due_date && task.due_date < today) return 'overdue'
  if (task.due_date === today) return 'due_today'
  if (task.start_date && task.start_date > today) return 'scheduled'
  return null
}

export type StoreBucket = 'completed' | 'overdue' | 'scheduled' | 'ongoing'
export const STORE_BUCKETS: readonly StoreBucket[] = ['ongoing', 'completed', 'overdue', 'scheduled']

/** The one summary column a task counts in, or null for a cancelled task, which counts nowhere. */
export function storeBucket(task: DatedTask, today: string): StoreBucket | null {
  if (task.task_state === 'Cancelled') return null
  if (task.task_state === 'Done') return 'completed'
  const mark = dueMark(task, today)
  return mark === 'overdue' || mark === 'scheduled' ? mark : 'ongoing'
}

export interface StoreSummaryRow {
  store: string
  total: number
  completed: number
  overdue: number
  scheduled: number
  ongoing: number
}

function emptyRow(store: string): StoreSummaryRow {
  return { store, total: 0, completed: 0, overdue: 0, scheduled: 0, ongoing: 0 }
}

export function taskStore(task: { store?: string | null }, storeIds: ReadonlySet<string>): string {
  return task.store && storeIds.has(task.store) ? task.store : NO_STORE
}

export function summarizeByStore<T extends DatedTask & { store?: string | null }>(
  tasks: T[], storeIds: string[], today: string,
): { rows: StoreSummaryRow[]; total: StoreSummaryRow } {
  const known = new Set(storeIds)
  const rows = new Map([...storeIds, NO_STORE].map((id) => [id, emptyRow(id)]))
  const total = emptyRow('')
  for (const task of tasks) {
    const bucket = storeBucket(task, today)
    if (!bucket) continue
    for (const row of [rows.get(taskStore(task, known))!, total]) {
      row[bucket] += 1
      row.total += 1
    }
  }
  return { rows: [...rows.values()], total }
}
