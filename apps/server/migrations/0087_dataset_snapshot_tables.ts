// The dataset-snapshot registry becomes two system Tables.
//
// 0085 created `dataset_snapshot` and `dataset_miss` as raw SQL, deliberately
// outside `table_def`, because the snapshot ROWS hold every store's figures and
// generic row scoping is fail-open for a principal with no data_scope rows
// (#246). That reasoning covers the rows table, `sales_target_snapshot_row`,
// which stays raw and app-internal. It never covered the registry: a Dataset
// Snapshot row is a dataset name, a state, a row count and some timings — no
// business figure — and keeping it out of `table_def` only meant nobody could
// see it. Without Permission rows, only System Managers can read a Table, which
// is exactly the audience.
//
// As Tables they gain what every Table gets: the generic list and form, filters,
// the Admin sidebar under System, and Version history. Alongside the move, the
// registry records what each build cost — fetch and load times, bytes on disk —
// and what caused it (the job's trigger), which is the "how long is the sync
// taking, how many MB" question in the same list view as "is it fresh".
//
// The lifecycle column is `state`, not `status`: every Table already carries a
// reserved `status` (draft/submitted/cancelled), and the snapshot lifecycle is a
// different thing.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { createTable } from '../src/table-engine'

async function tableExists(name: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from information_schema.tables
    where table_schema = current_schema() and table_name = ${name}`
  return Boolean(row)
}

export async function up() {
  const [snapshotDef] = await sql`select 1 from table_def where name = 'Dataset Snapshot'`
  if (!snapshotDef) {
    // 0085's raw table occupies the physical name; move it aside, create the
    // Table, carry the rows across, re-point the rows table's FK, drop the old.
    const raw = await tableExists('dataset_snapshot')
    if (raw) {
      await sql.unsafe(`drop index if exists dataset_snapshot_one_active`)
      await sql.unsafe(`drop index if exists dataset_snapshot_dataset_status`)
      await sql.unsafe(`alter table dataset_snapshot rename to dataset_snapshot_raw`)
    }
    await createTable({
      name: 'Dataset Snapshot',
      module: 'Core',
      system: true,
      sort_column: 'built_at',
      sort_order: 'desc',
      columns: [
        { column_name: 'dataset', column_type: 'Data', reqd: true, in_list_view: true },
        {
          column_name: 'state',
          column_type: 'Choice',
          choices: 'building\nactive\nsuperseded\nfailed',
          reqd: true,
          default_value: 'building',
          in_list_view: true,
        },
        { column_name: 'definition_version', column_type: 'Data' },
        // The warehouse's own as-of, never the build time (honest staleness).
        { column_name: 'source_as_of', column_type: 'Date', in_list_view: true },
        { column_name: 'built_at', column_type: 'Datetime', in_list_view: true },
        { column_name: 'activated_at', column_type: 'Datetime', in_list_view: true },
        { column_name: 'row_count', column_type: 'Int', in_list_view: true },
        { column_name: 'bytes', column_type: 'Int', label: 'Bytes on disk', in_list_view: true },
        { column_name: 'fetch_ms', column_type: 'Int', label: 'Fetch (ms)', in_list_view: true },
        { column_name: 'load_ms', column_type: 'Int', label: 'Load (ms)', in_list_view: true },
        // The trigger of the job that built it (schedule | demand | manual |
        // retry), or 'script' for a build run by hand.
        { column_name: 'triggered_by', column_type: 'Data', in_list_view: true },
        { column_name: 'error', column_type: 'Text' },
      ],
    })
    if (raw) {
      await sql.unsafe(`
        insert into dataset_snapshot
          (row_id, created_at, updated_at, dataset, state, definition_version,
           source_as_of, built_at, activated_at, row_count, error)
        select row_id, built_at, coalesce(activated_at, built_at), dataset, status, definition_version,
               source_as_of, built_at, activated_at, row_count, error
        from dataset_snapshot_raw`)
      if (await tableExists('sales_target_snapshot_row')) {
        await sql.unsafe(`
          alter table sales_target_snapshot_row
            drop constraint if exists sales_target_snapshot_row_snapshot_id_fkey`)
        await sql.unsafe(`
          alter table sales_target_snapshot_row
            add constraint sales_target_snapshot_row_snapshot_id_fkey
            foreign key (snapshot_id) references dataset_snapshot(row_id) on delete cascade`)
      }
      await sql.unsafe(`drop table dataset_snapshot_raw`)
    }
    // One active snapshot per dataset is a database fact, not a convention.
    await sql.unsafe(`
      create unique index if not exists dataset_snapshot_one_active
        on dataset_snapshot (dataset) where state = 'active'`)
    await sql.unsafe(`
      create index if not exists dataset_snapshot_dataset_state on dataset_snapshot (dataset, state)`)
  }

  const [missDef] = await sql`select 1 from table_def where name = 'Dataset Miss'`
  if (!missDef) {
    const raw = await tableExists('dataset_miss')
    if (raw) {
      await sql.unsafe(`drop index if exists dataset_miss_dataset`)
      await sql.unsafe(`alter table dataset_miss rename to dataset_miss_raw`)
    }
    await createTable({
      name: 'Dataset Miss',
      module: 'Core',
      system: true,
      sort_column: 'last_seen',
      sort_order: 'desc',
      columns: [
        { column_name: 'dataset', column_type: 'Data', reqd: true, unique: true, in_list_view: true },
        { column_name: 'first_seen', column_type: 'Datetime', in_list_view: true },
        { column_name: 'last_seen', column_type: 'Datetime', in_list_view: true },
        { column_name: 'hits', column_type: 'Int', in_list_view: true },
      ],
    })
    if (raw) {
      await sql.unsafe(`
        insert into dataset_miss (row_id, created_at, updated_at, dataset, first_seen, last_seen, hits)
        select row_id, first_seen, last_seen, dataset, first_seen, last_seen, hits from dataset_miss_raw`)
      await sql.unsafe(`drop table dataset_miss_raw`)
    }
  }
  invalidateMeta()
}
