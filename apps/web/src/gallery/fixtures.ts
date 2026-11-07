import type { ColumnDef, TableMeta } from '../lib/meta'

// Synthetic metadata only. Nothing here reads an instance or external account.
const stamp = { created_by: 'Administrator', updated_by: 'Administrator', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', submission_status: 'draft' }
function table(name: string, fields: { column_name: string; label: string; column_type: string; choices?: string; reference_table?: string }[]): TableMeta {
  return {
    ...stamp, name, module: 'UI Lab', kind: 'table', is_submittable: false, id_pattern: 'hash', title_column: 'name',
    sort_column: 'name', sort_order: 'asc', track_changes: false, description: 'Synthetic UI Lab example', custom: true, system: false, position: 0,
    columns: fields.map((field, position): ColumnDef => ({
      ...stamp, row_id: `${name}-${field.column_name}`, parent: name, position, reference_table: null,
      choices: null, row_table: null, reqd: field.column_name === 'name', unique: false, default_value: null,
      read_only: false, hidden: false, in_list_view: true, tier: 'basic', ...field,
    })),
  }
}

export const labTables = [
  table('Lab Project', [
    { column_name: 'name', label: 'Name', column_type: 'Data' },
    { column_name: 'region', label: 'Region', column_type: 'Data' },
    { column_name: 'enabled', label: 'Enabled', column_type: 'Check' },
  ]),
  table('Lab Task', [
    { column_name: 'name', label: 'Name', column_type: 'Data' },
    { column_name: 'project', label: 'Project', column_type: 'Reference', reference_table: 'Lab Project' },
    { column_name: 'review_project', label: 'Review project', column_type: 'Reference', reference_table: 'Lab Project' },
    { column_name: 'state', label: 'State', column_type: 'Choice', choices: 'Open\nDone' },
  ]),
]

export function initialLabRows(): Record<string, Record<string, unknown>[]> {
  return {
    'Lab Project': [
      { ...stamp, row_id: 'lab-north', name: 'North workshop', region: 'North', enabled: true },
      { ...stamp, row_id: 'lab-south', name: 'South studio', region: 'South', enabled: false },
    ],
    'Lab Task': [
      { ...stamp, row_id: 'lab-task-1', name: 'Prepare workshop', project: 'lab-north', state: 'Open' },
      { ...stamp, row_id: 'lab-task-2', name: 'Review materials', project: 'lab-north', state: 'Done' },
    ],
  }
}

export const labScenarios = ['populated', 'empty', 'loading', 'error', 'permission-limited'] as const
export type LabScenario = typeof labScenarios[number]
