import { Button, fmtDate } from '@featherbase/shop-floor'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { ApiError, api } from './api'
import {
  NO_STORE,
  calendarDay,
  dueMark,
  storeBucket,
  summarizeByStore,
  taskStore,
  type DatedTask,
  type StoreBucket,
  type StoreSummaryRow,
} from './storeWork'

export interface Store {
  row_id: string
  store_name: string
  store_type: 'Store' | 'Warehouse'
}

/** The group's stores, shared by every task list without threading them through each one. */
export const StoresContext = createContext<Store[]>([])

export function useStores() {
  return useContext(StoresContext)
}

export function storeName(stores: Store[], id: string) {
  return id === NO_STORE ? 'No store' : stores.find((store) => store.row_id === id)?.store_name ?? 'Unavailable store'
}

function shortDay(day: string) {
  return fmtDate(day)
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** The short mark on a task row, or null when the task has nothing to say about its dates. */
export function dueChip(task: DatedTask, today: string): { mark: string; label: string } | null {
  const due = calendarDay(task.due_date), start = calendarDay(task.start_date)
  const mark = dueMark(task, today)
  if (mark === 'overdue') return { mark, label: `Overdue · ${shortDay(due!)}` }
  if (mark === 'due_today') return { mark, label: 'Due today' }
  if (mark === 'scheduled') return { mark, label: `Scheduled · starts ${shortDay(start!)}` }
  if (due && !['Done', 'Cancelled'].includes(task.task_state)) return { mark: 'due', label: `Due ${shortDay(due)}` }
  return null
}

/** The longer sentence in task details. */
export function dueNote(task: DatedTask, today: string): string | null {
  const due = calendarDay(task.due_date), start = calendarDay(task.start_date)
  const mark = dueMark(task, today)
  if (mark === 'overdue') {
    const late = daysBetween(due!, today)
    return `Overdue by ${late} ${late === 1 ? 'day' : 'days'}`
  }
  if (mark === 'due_today') return 'Due today'
  if (mark === 'scheduled') return `Scheduled · starts ${shortDay(start!)}`
  return null
}

export function TaskStoreAndDue({ task, today }: { task: DatedTask & { store?: string | null }; today: string }) {
  const stores = useStores()
  const chip = dueChip(task, today)
  if (!task.store && !chip) return null
  return <p className="tasker-task-meta">
    {task.store && <span className="tasker-store-chip">{storeName(stores, task.store)}</span>}
    {chip && <span className="tasker-due-chip" data-mark={chip.mark}>{chip.label}</span>}
  </p>
}

const COLUMNS: { bucket: StoreBucket | 'total'; label: string; noun: string }[] = [
  { bucket: 'total', label: 'Total', noun: '' },
  { bucket: 'ongoing', label: 'Ongoing', noun: 'ongoing ' },
  { bucket: 'completed', label: 'Completed', noun: 'completed ' },
  { bucket: 'overdue', label: 'Overdue', noun: 'overdue ' },
  { bucket: 'scheduled', label: 'Scheduled', noun: 'scheduled ' },
]

type Selection = { store: string; bucket: StoreBucket | 'total' }
const ALL_STORES = ''

export function StoresPage<T extends DatedTask & { store?: string | null }>({ tasks, today, onStoreAdded, renderTasks }: {
  tasks: T[]
  today: string
  onStoreAdded: () => Promise<void>
  renderTasks: (tasks: T[]) => ReactNode
}) {
  const stores = useStores()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<Store['store_type']>('Store')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const summary = summarizeByStore(tasks, stores.map((store) => store.row_id), today)
  const known = new Set(stores.map((store) => store.row_id))

  async function addStore(event: React.FormEvent) {
    event.preventDefault()
    setAdding(true); setError('')
    try {
      await api.post('/api/save_row', { table: 'tasker.store', row: { store_name: name.trim(), store_type: type } })
      setName('')
      await onStoreAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the store')
    } finally {
      setAdding(false)
    }
  }

  function rowFor(row: StoreSummaryRow, label: string, store: string, total = false) {
    return <tr key={store || 'all'} className={total ? 'is-total' : undefined}>
      <th scope="row">{label}</th>
      {COLUMNS.map(({ bucket, noun }) => {
        const count = bucket === 'total' ? row.total : row[bucket]
        const selected = selection?.store === store && selection.bucket === bucket
        return <td key={bucket} data-bucket={bucket}>
          {count > 0
            ? <Button type="button" aria-pressed={selected} aria-label={`${label}: ${count} ${noun}${count === 1 ? 'task' : 'tasks'}`} onClick={() => setSelection(selected ? null : { store, bucket })}>{count}</Button>
            : <span className="tasker-store-zero">0</span>}
        </td>
      })}
    </tr>
  }

  const selectedLabel = selection && `${selection.store === ALL_STORES ? 'All stores' : storeName(stores, selection.store)} · ${
    selection.bucket === 'total' ? 'All tasks' : COLUMNS.find((column) => column.bucket === selection.bucket)!.label}`
  const selectedTasks = selection ? tasks.filter((task) =>
    (selection.store === ALL_STORES || taskStore(task, known) === selection.store)
    && (selection.bucket === 'total' ? storeBucket(task, today) !== null : storeBucket(task, today) === selection.bucket),
  ) : []

  return <section aria-labelledby="stores-heading" className="tasker-stores">
    <div className="tasker-section-title"><h2 id="stores-heading">Stores</h2><p>Work in each store and warehouse. Cancelled tasks aren’t counted.</p></div>
    <div className="tasker-store-table-wrap">
      <table className="tasker-store-table" aria-label="Work by store">
        <thead><tr><th scope="col">Store</th>{COLUMNS.map((column) => <th key={column.bucket} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>
          {summary.rows.map((row) => rowFor(row, storeName(stores, row.store), row.store))}
          {rowFor(summary.total, 'All stores', ALL_STORES, true)}
        </tbody>
      </table>
    </div>
    {selection && <section className="tasker-store-drilldown" aria-label={selectedLabel!}>
      <h3>{selectedLabel} <span>{selectedTasks.length}</span></h3>
      {renderTasks(selectedTasks)}
    </section>}
    <form className="tasker-store-create" onSubmit={(event) => void addStore(event)}>
      <label htmlFor="new-store">New store</label>
      <div>
        <input id="new-store" value={name} onChange={(event) => setName(event.target.value)} placeholder="Store or warehouse name" />
        <select aria-label="Store type" value={type} onChange={(event) => setType(event.target.value as Store['store_type'])}>
          <option>Store</option>
          <option>Warehouse</option>
        </select>
        <Button type="submit" disabled={adding || !name.trim()}>Add store</Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}
