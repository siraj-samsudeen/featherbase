// The base Tables as staging holds them (read live 05-Nov-2026), for this app's tests and the
// made-up seed: only the columns Your sections touches, and made-up rows only.
const data = column_name => ({ column_name, column_type: 'Data' })
const ref = (column_name, reference_table) => ({ column_name, column_type: 'Reference', reference_table })
const date = column_name => ({ column_name, column_type: 'Date' })
const check = column_name => ({ column_name, column_type: 'Check' })
export const BASE_TABLES = [
  { name: 'Site Master', module: 'Organisation', id_pattern: 'field:site_code', title_column: 'site_name', columns: [data('site_code'), data('site_name'), check('is_store')] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [data('subcategory'), check('is_merchandise'), check('deleted_at_source')] },
  { name: 'Employee', module: 'People', id_pattern: 'field:employee_id', title_column: 'employee_name', columns: [data('employee_id'), data('employee_name'), ref('person', 'Person'), { column_name: 'employee_status', column_type: 'Choice', choices: 'Current\nLeft\nTest record' }] },
  { name: 'Store Floor', module: 'Store Layout', id_pattern: 'field:floor_id', title_column: 'floor_name', columns: [data('floor_id'), data('floor_name'), ref('site', 'Site Master')] },
  { name: 'Section', module: 'Store Layout', id_pattern: 'field:section_id', title_column: 'section_name', columns: [data('section_id'), data('section_name'), ref('site', 'Site Master'), ref('floor', 'Store Floor'), { column_name: 'section_status', column_type: 'Choice', choices: 'Active\nInactive' }] },
  { name: 'Section Subcategory', module: 'Store Layout', id_pattern: 'field:placement_id', title_column: 'placement_id', track_changes: true, columns: [data('placement_id'), ref('site', 'Site Master'), ref('subcategory', 'Subcategory'), ref('section', 'Section'), date('starts_on'), date('ends_on'), data('source')] },
  { name: 'Job Assignment', module: 'People', id_pattern: 'field:assignment_id', title_column: 'assignment_id', track_changes: true, columns: [data('assignment_id'), ref('employee', 'Employee'), { column_name: 'job', column_type: 'Choice', choices: 'Staff\nTeam Leader\nDepartment Manager\nFloor Manager\nStore Manager\nCluster Manager\nHead office staff' }, ref('site', 'Site Master'), ref('floor', 'Store Floor'), ref('section', 'Section'), ref('reports_to', 'Employee'), date('starts_on'), date('ends_on'), data('source')] },
]
export const LINKED_TABLES = BASE_TABLES.map(table => table.name)
