// #1409 (design D2, D8): where one dataset of an installed app is served from
// in this instance. A `Dataset Binding` row, named `<app>.<dataset>`, says
// Warehouse (the declared query, refreshed on a schedule) or Stand-in (rows
// loaded from a file until the warehouse has them). No row means Warehouse.
// The binding decides what may fill the dataset; whether an answer is marked
// is read from the snapshot that served it (dataset-snapshot.ts `stand_in`).
import { sql } from './db'
import { currentEnvironment } from './env'

export const WAREHOUSE = 'Warehouse'
export const STAND_IN = 'Stand-in'

export interface DatasetBinding {
  row_id: string
  served_from: typeof WAREHOUSE | typeof STAND_IN
  note: string | null
  /** The day the real data is expected, as YYYY-MM-DD. */
  expected_by: string | null
  allowed_on_production: boolean
  updated_at: string
}

/** The binding of `<app>.<dataset>`, or null when it has none (Warehouse). */
export async function datasetBinding(key: string): Promise<DatasetBinding | null> {
  const [row] = await sql`select row_id, served_from, note, expected_by::text as expected_by, allowed_on_production, updated_at
    from dataset_binding where row_id = ${key}`
  return row ? { ...(row as unknown as DatasetBinding), updated_at: new Date(row.updated_at as Date).toISOString() } : null
}

/** A dataset bound to a stand-in is not refreshed from the warehouse and does
 *  not need its Data Source. */
export async function boundToStandIn(key: string): Promise<boolean> {
  return (await datasetBinding(key))?.served_from === STAND_IN
}

/** D8: a stand-in is served everywhere but production, and there only while a
 *  System Manager has allowed one for this dataset. */
export function standInAllowedHere(binding: Pick<DatasetBinding, 'allowed_on_production'> | null): boolean {
  return currentEnvironment() !== 'production' || binding?.allowed_on_production === true
}
