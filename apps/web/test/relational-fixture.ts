// Made-up master data for relational navigation (#910): regions, sites,
// plants and profit centres, each linked to the one before.
import type { renderApp } from './pg-test'

export type Admin = Parameters<typeof renderApp>[1]

export const REGION = 'Nv Region'
export const SITE = 'Nv Site'
export const PLANT = 'Nv Plant'
export const PROFIT = 'Nv Profit Centre'

export const LONG_NOTE = 'The site sits beside the old canal road. Deliveries come in by the north gate before nine in the morning; the south gate is for staff only. The cold room is shared with the bakery next door and is checked twice a day. Fire drills happen on the first Monday of each month.'

export async function seedSites(admin: Admin, opts: { profitCentres?: number } = {}) {
  await admin.post('/api/table_def', {
    name: REGION, id_pattern: 'prompt', title_column: 'region_name',
    columns: [{ column_name: 'region_name', column_type: 'Data', label: 'Region name', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: SITE, id_pattern: 'prompt', title_column: 'site_name',
    columns: [
      { column_name: 'site_name', column_type: 'Data', label: 'Site name', in_list_view: true },
      { column_name: 'region', column_type: 'Reference', reference_table: REGION, label: 'Region', in_list_view: true },
      { column_name: 'opened_on', column_type: 'Date', label: 'Opened on', in_list_view: true },
      { column_name: 'rent', column_type: 'Currency', label: 'Rent' },
      { column_name: 'note', column_type: 'Long Text', label: 'Note' },
      { column_name: 'phone', column_type: 'Data', label: 'Phone' },
      { column_name: 'email', column_type: 'Data', label: 'Email' },
    ],
  })
  await admin.post('/api/table_def', {
    name: PLANT, id_pattern: 'prompt', title_column: 'plant_name',
    columns: [
      { column_name: 'plant_name', column_type: 'Data', label: 'Plant name', in_list_view: true },
      { column_name: 'site', column_type: 'Reference', reference_table: SITE, label: 'Site', in_list_view: true },
      { column_name: 'format', column_type: 'Data', label: 'Format', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', {
    name: PROFIT, id_pattern: 'hash', title_column: 'centre_name',
    columns: [
      { column_name: 'centre_name', column_type: 'Data', label: 'Centre name', in_list_view: true },
      { column_name: 'plant', column_type: 'Reference', reference_table: PLANT, label: 'Plant', in_list_view: true },
    ],
  })
  for (const [row_id, region_name] of [['KL', 'Kerala'], ['TN', 'Tamil Nadu']])
    await admin.post('/api/save_row', { table: REGION, row: { row_id, region_name } })
  for (const [row_id, site_name, region, extra] of [
    ['ENK', 'Enchakkal', 'KL', { opened_on: '2019-02-05', rent: 1245000, note: LONG_NOTE }],
    ['TCR', 'Thrissur', 'KL', {}],
    ['MDU', 'Madurai', 'TN', {}],
  ] as const)
    await admin.post('/api/save_row', { table: SITE, row: { row_id, site_name, region, ...extra } })
  for (const [row_id, plant_name, site] of [
    ['1503', 'Enchakkal Supermarket', 'ENK'],
    ['1504', 'Enchakkal Textiles', 'ENK'],
    ['1505', 'Enchakkal Jewellery', 'ENK'],
    ['1601', 'Thrissur Supermarket', 'TCR'],
  ])
    await admin.post('/api/save_row', { table: PLANT, row: { row_id, plant_name, site, format: 'Retail' } })
  for (let i = 1; i <= (opts.profitCentres ?? 2); i++)
    await admin.post('/api/save_row', { table: PROFIT, row: { centre_name: `EKL - Retail ${String(i).padStart(2, '0')}`, plant: '1503' } })
}
