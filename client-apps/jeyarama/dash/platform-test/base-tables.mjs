// The core Tables as production holds them, for this app's tests and the made-up seed: only the
// columns Dash touches, and made-up rows only. Cluster is here for Site to point at; Dash never
// reads it, so it isn't one of the linked Tables.
const data = column_name => ({ column_name, column_type: 'Data' })
const ref = (column_name, reference_table) => ({ column_name, column_type: 'Reference', reference_table })
const date = column_name => ({ column_name, column_type: 'Date' })
const check = column_name => ({ column_name, column_type: 'Check' })
const choice = (column_name, ...choices) => ({ column_name, column_type: 'Choice', choices: choices.join('\n') })
export const JOBS = ['Staff', 'Team Leader', 'Department Manager', 'Floor Manager', 'Store Manager', 'Cluster Manager', 'Chief Operating Officer', 'Director', 'Managing Director', 'Head office staff']
export const BASE_TABLES = [
  { name: 'Cluster', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name')] },
  { name: 'Site', module: 'Organisation', id_pattern: 'field:code', title_column: 'name', columns: [data('code'), data('name'), check('is_store'), ref('cluster', 'Cluster')] },
  { name: 'Plant', module: 'Organisation', id_pattern: 'field:plant_code', title_column: 'plant_code', columns: [data('plant_code'), choice('plant_type', 'Store', 'Shop-in-shop', 'Warehouse', 'E-commerce fulfilment'), ref('site', 'Site'), data('plant_name')] },
  { name: 'Subcategory', module: 'Merchandising', id_pattern: 'prompt', title_column: 'subcategory', columns: [data('subcategory'), data('division'), data('subdivision'), data('category'), choice('subcategory_type', 'Merchandise', 'Consumable', 'Service')] },
  { name: 'Employee', module: 'People', id_pattern: 'field:employee_code', title_column: 'name', columns: [data('employee_code'), data('name'), ref('person', 'Person'), choice('status', 'Current', 'Left', 'Test record')] },
  { name: 'Store Floor', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name', columns: [data('name'), ref('site', 'Site')] },
  { name: 'Section', module: 'Store Layout', id_pattern: 'prompt', title_column: 'name', columns: [data('name'), ref('site', 'Site'), ref('floor', 'Store Floor'), choice('status', 'Active', 'Inactive')] },
  { name: 'Section Subcategory', module: 'Store Layout', id_pattern: 'field:section_subcategory_id', title_column: 'section_subcategory_id', track_changes: true, columns: [data('section_subcategory_id'), ref('store', 'Site'), ref('section', 'Section'), ref('subcategory', 'Subcategory'), date('starts_on'), date('ends_on'), data('source_key')] },
  { name: 'Job Assignment', module: 'People', id_pattern: 'field:assignment_id', title_column: 'assignment_id', track_changes: true, columns: [data('assignment_id'), ref('employee', 'Employee'), choice('job', ...JOBS), ref('site', 'Site'), ref('floor', 'Store Floor'), ref('section', 'Section'), ref('reports_to', 'Employee'), check('acting'), date('starts_on'), date('ends_on'), data('source_key')] },
]
/** What the instance's `dash.linked_tables` setting lists: the manifest's `baseTables.read`. */
export const LINKED_TABLES = BASE_TABLES.map(table => table.name).filter(name => name !== 'Cluster')

/** The three made-up Dives, each taking a different shape of filters. No Dive of these ids exists. */
export const REPORT_ROWS = [
  { report_key: 'sales', report_name: 'Sales versus target', dive_id: 'made-up-sales-dive', filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end', ready_signal: false, quick_view: 'Sales target' },
  { report_key: 'store_target', report_name: 'Store target month to date', dive_id: 'made-up-store-target-dive', filter_shape: 'Whole stores', store_key: 'plant_codes' },
  { report_key: 'vendor_sales', report_name: 'Vendor sales by city', dive_id: 'made-up-vendor-sales-dive', filter_shape: 'Stores and subcategories', store_key: 'store_reach' },
]

/** #1046: each made-up report given to everyone holding Dash Reader, so the tests' readers reach them. */
export const ACCESS_ROWS = REPORT_ROWS.map(row => ({ report: row.report_key, role: 'Dash Reader' }))
