import manifest from '../featherbase.json'

const columns: { column_name: string; choices?: string }[] = manifest.tables.find(table => table.name === 'tasker.task')!.columns
export const TASK_STATES = columns.find(column => column.column_name === 'task_state')!.choices!.split('\n')
export const STATES = TASK_STATES
