// The core Tables as production holds them, for this app's tests and the made-up seed: only the
// columns Dash touches, and made-up rows only. Cluster, Operating Region and the merchandise tree
// above Subcategory are here for links to point at; Dash never reads them, so they aren't linked Tables.
const data = column_name => ({ column_name, column_type: 'Data' })
const ref = (column_name, reference_table) => ({ column_name, column_type: 'Reference', reference_table })
const date = column_name => ({ column_name, column_type: 'Date' })
const check = column_name => ({ column_name, column_type: 'Check' })
const choice = (column_name, ...choices) => ({ column_name, column_type: 'Choice', choices: choices.join('\n') })
export const JOBS = ['Staff', 'Team Leader', 'Department Manager', 'Floor Manager', 'Store Manager', 'Cluster Manager', 'Chief Operating Officer', 'Director', 'Managing Director', 'Head office staff']
export const BASE_TABLES = [
  { name: 'Cluster', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Operating Region', module: 'Organisation', id_pattern: 'field:region', title_column: 'region', columns: [data('region')] },
  { name: 'Site', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name'), check('is_store'), ref('cluster', 'Cluster'), ref('operating_region', 'Operating Region')] },
  { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', title_column: 'plant_code', columns: [data('plant_code'), choice('plant_type', 'Store', 'Shop-in-shop', 'Warehouse', 'E-commerce fulfilment'), ref('site', 'Site'), data('plant_name')] },
  { name: 'Division', module: 'Organisation', id_pattern: 'field:division', title_column: 'division', columns: [data('division')] },
  { name: 'Subdivision', module: 'Organisation', id_pattern: 'field:subdivision', title_column: 'subdivision', columns: [data('subdivision'), ref('division', 'Division')] },
  { name: 'Category', module: 'Organisation', id_pattern: 'field:category', title_column: 'category', columns: [data('category'), ref('subdivision', 'Subdivision')] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [data('subcategory'), ref('category', 'Category'), ref('subdivision', 'Subdivision'), ref('division', 'Division'), choice('subcategory_type', 'Merchandise', 'Consumable', 'Service')] },
  { name: 'Employee', module: 'People', id_pattern: 'field:employee_code', title_column: 'name', columns: [data('employee_code'), data('name'), ref('person', 'Person'), choice('status', 'Current', 'Left', 'Test record')] },
  { name: 'Store Floor', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name', columns: [data('name'), ref('site', 'Site')] },
  { name: 'Section', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name', columns: [data('name'), ref('site', 'Site'), ref('floor', 'Store Floor'), choice('status', 'Active', 'Inactive')] },
  // #1195: a store's departments, each a named group of sections with one manager, both dated.
  { name: 'Department', module: 'Store Layout', id_pattern: 'field:department_id', title_column: 'name', track_changes: true, columns: [data('department_id'), ref('store', 'Site'), data('name'), ref('manager', 'Employee'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Department Section', module: 'Store Layout', id_pattern: 'field:department_section_id', title_column: 'department_section_id', track_changes: true, columns: [data('department_section_id'), ref('store', 'Site'), ref('department', 'Department'), ref('section', 'Section'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Section Subcategory', module: 'Store Layout', id_pattern: 'field:section_subcategory_id', title_column: 'section_subcategory_id', track_changes: true, columns: [data('section_subcategory_id'), ref('store', 'Site'), ref('section', 'Section'), ref('subcategory', 'Subcategory'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Job Assignment', module: 'People', id_pattern: 'field:assignment_id', title_column: 'assignment_id', track_changes: true, columns: [data('assignment_id'), ref('employee', 'Employee'), choice('job', ...JOBS), ref('site', 'Site'), ref('floor', 'Store Floor'), ref('section', 'Section'), ref('reports_to', 'Employee'), check('acting'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Merchandise Assignment', module: 'Organisation', id_pattern: 'field:assignment_id', title_column: 'assignment_id', columns: [data('assignment_id'), ref('employee', 'Employee'),
    choice('responsibility', 'Buyer', 'Category head', 'Subdivision head', 'Division head', 'Merchandising head'), ref('division', 'Division'), ref('subdivision', 'Subdivision'),
    ref('category', 'Category'), ref('subcategory', 'Subcategory'), ref('operating_region', 'Operating Region'), date('starts_on'), date('ends_on'), data('source_key')] },
]
const NOT_LINKED = new Set(['Cluster', 'Operating Region', 'Division', 'Subdivision', 'Category'])
/** What the instance's `dash.linked_tables` setting lists: the manifest's `baseTables.read`. */
export const LINKED_TABLES = BASE_TABLES.map(table => table.name).filter(name => !NOT_LINKED.has(name))

/** The three made-up Dives, each taking a different shape of filters. No Dive of these ids exists. */
export const REPORT_ROWS = [
  { report_key: 'sales', report_name: 'Sales versus target', dive_id: 'made-up-sales-dive', filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end', ready_signal: false, quick_view: 'Sales target' },
  { report_key: 'store_target', report_name: 'Store target month to date', dive_id: 'made-up-store-target-dive', filter_shape: 'Whole stores', store_key: 'plant_codes' },
  { report_key: 'vendor_sales', report_name: 'Vendor sales by city', dive_id: 'made-up-vendor-sales-dive', filter_shape: 'Stores and subcategories', store_key: 'store_reach' },
]

/** #1046: each made-up report given to everyone holding Dash Reader, so the tests' readers reach them. */
export const ACCESS_ROWS = REPORT_ROWS.map(row => ({ report: row.report_key, role: 'Dash Reader' }))
