// The public demo's core Tables (#1123), laid out as production's are (docs/dash-wiring-decisions.md,
// D9 to D11): the names, keys and columns only. The nine Dash reads keep the ids and columns of
// dash/platform-test/base-tables.mjs; the rest add what a visitor browsing the group expects to see.
// Financial Tables (Legal Company, Rent Contract, cost centres and the like) stay out on purpose.
const data = (column_name, extra = {}) => ({ column_name, column_type: 'Data', ...extra })
const ref = (column_name, reference_table, extra = {}) => ({ column_name, column_type: 'Reference', reference_table, ...extra })
const date = column_name => ({ column_name, column_type: 'Date' })
const check = column_name => ({ column_name, column_type: 'Check' })
const choice = (column_name, choices) => ({ column_name, column_type: 'Choice', choices: choices.join('\n') })

export const JOBS = ['Staff', 'Team Leader', 'Department Manager', 'Floor Manager', 'Store Manager', 'Cluster Manager',
  'Chief Operating Officer', 'Director', 'Managing Director', 'Head office staff']

/** In load order: a Table comes after every Table it points at. */
export const DEMO_TABLES = [
  { name: 'State', module: 'Organisation', id_pattern: 'field:state', title_column: 'state', columns: [data('state'), data('gst_code')] },
  { name: 'Operating Region', module: 'Organisation', id_pattern: 'field:region', title_column: 'region',
    columns: [data('region'), data('sales_org_code_sap'), data('note')] },
  { name: 'City', module: 'Organisation', id_pattern: 'field:city', title_column: 'city',
    columns: [data('city'), ref('state', 'State'), data('district')] },
  { name: 'Cluster', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Site', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [
    data('code'), data('name'), choice('status', ['Active', 'Opening soon', 'Closed']), check('is_store'), date('opened_on'),
    ref('operating_region', 'Operating Region'), ref('cluster', 'Cluster'), ref('state', 'State'), ref('city', 'City'),
    data('postal_code'), data('note')] },
  { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', title_column: 'plant_code',
    columns: [data('plant_code'), choice('plant_type', ['Store', 'Warehouse', 'E-commerce']), ref('site', 'Site')] },
  { name: 'Store Floor', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name', columns: [data('name'), ref('site', 'Site')] },
  { name: 'Section', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name',
    columns: [data('name'), ref('site', 'Site'), ref('floor', 'Store Floor'), choice('status', ['Active', 'Inactive'])] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [
    data('subcategory'), data('category'), data('subdivision'), data('division'),
    choice('subcategory_type', ['Merchandise', 'Consumable', 'Service'])] },
  { name: 'Section Subcategory', module: 'Store Layout', id_pattern: 'field:section_subcategory_id', title_column: 'section_subcategory_id',
    track_changes: true, columns: [data('section_subcategory_id'), ref('store', 'Site'), ref('section', 'Section'),
      ref('subcategory', 'Subcategory'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Department', module: 'People', id_pattern: 'field:department', title_column: 'department', columns: [data('department'), data('note')] },
  { name: 'Designation', module: 'People', id_pattern: 'field:designation', title_column: 'designation',
    columns: [data('designation'), ref('department', 'Department'), check('active')] },
  { name: 'Employee', module: 'People', id_pattern: 'field:employee_code', title_column: 'name', columns: [
    data('employee_code'), data('name'), ref('person', 'Person'), data('work_email'), data('mobile'),
    choice('status', ['Current', 'Left', 'Test record'])] },
  { name: 'Employment', module: 'People', id_pattern: 'field:employment_id', title_column: 'employment_id', track_changes: true, columns: [
    data('employment_id'), ref('employee', 'Employee'), ref('designation', 'Designation'), ref('department', 'Department'),
    ref('site', 'Site'), date('joined_on'), date('left_on'), choice('status', ['Current', 'Left'])] },
  { name: 'Job Assignment', module: 'People', id_pattern: 'field:assignment_id', title_column: 'assignment_id', track_changes: true, columns: [
    data('assignment_id'), ref('employee', 'Employee'), choice('job', JOBS), ref('site', 'Site'), ref('floor', 'Store Floor'),
    ref('section', 'Section'), ref('reports_to', 'Employee'), check('acting'), date('starts_on'), date('ends_on'), data('source_key')] },
]

/** The Tables Dash reads, for its `dash.linked_tables` setting. */
export const LINKED_TABLES = ['Site', 'Plant', 'Subcategory', 'Employee', 'Store Floor', 'Section', 'Section Subcategory', 'Job Assignment']
