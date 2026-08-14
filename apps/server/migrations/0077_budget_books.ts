// Spec 0007 (Budget Books, M1): the grain-agnostic budget engine tables.
// A Budget Book binds an ordinary Table and declares which of its columns
// are the grain (key columns) and which are budgeted amounts (measure
// columns). Baselining freezes v0 into Budget Version / Budget Version Line;
// from then on every mutation of the bound table rides an approved Budget
// Change. The engine never interprets the grain (BUD-R1).
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

// Guard per table, not per migration: a partially-failed earlier run must
// converge, never conflict.
async function ensure(def: Parameters<typeof createTable>[0] & { name: string }) {
  const [exists] = await sql`select 1 from table_def where name = ${def.name}`
  if (!exists) await createTable(def)
}

const ENGINE_TABLES = [
  'Budget Book', 'Budget Book Key Column', 'Budget Book Measure Column',
  'Budget Change', 'Budget Change Line', 'Budget Version', 'Budget Version Line',
]

export async function up() {
  // Child: the bound table's identity columns — opaque to the engine.
  await ensure({
    name: 'Budget Book Key Column',
    module: 'Core',
    system: true,
    kind: 'sub_table',
    columns: [
      { column_name: 'column_name', column_type: 'Data', reqd: true, in_list_view: true },
    ],
  })

  // Child: the bound table's amount columns, ordered (position is the
  // period order BUD-R8's "forward" follows), each with a period label.
  await ensure({
    name: 'Budget Book Measure Column',
    module: 'Core',
    system: true,
    kind: 'sub_table',
    columns: [
      { column_name: 'column_name', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'period_label', column_type: 'Data', in_list_view: true },
    ],
  })

  await ensure({
    name: 'Budget Book',
    module: 'Core',
    system: true,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'fiscal_year', column_type: 'Data', in_list_view: true },
      // Engine-written lifecycle (BUD-R2): working → active → closed.
      // ('status' is the platform's reserved submittable column.)
      { column_name: 'lifecycle', column_type: 'Choice', choices: 'working\nactive\nclosed', default_value: 'working', read_only: true, in_list_view: true },
      // Optional: which bound column names a line's owner (BUD-R4
      // crosses_owner; absent → crosses_owner is always false).
      { column_name: 'owner_column', column_type: 'Data' },
      { column_name: 'key_columns', column_type: 'Sub-table', row_table: 'Budget Book Key Column' },
      { column_name: 'measure_columns', column_type: 'Sub-table', row_table: 'Budget Book Measure Column' },
    ],
  })

  // Child: one proposed cell (or, for new_line / discontinue, one target
  // row) of a Budget Change.
  await ensure({
    name: 'Budget Change Line',
    module: 'Core',
    system: true,
    kind: 'sub_table',
    columns: [
      { column_name: 'line_ref', column_type: 'Data', in_list_view: true },
      { column_name: 'measure_column', column_type: 'Data', in_list_view: true },
      // current_value and delta are engine-computed on every save (the
      // budget-change controller overwrites whatever the client sent), but
      // deliberately NOT read_only: the save lifecycle strips read_only
      // values from child-row writes, which would drop the computed snap.
      { column_name: 'current_value', column_type: 'Float', in_list_view: true },
      { column_name: 'proposed_value', column_type: 'Float', in_list_view: true },
      { column_name: 'delta', column_type: 'Float', in_list_view: true },
      // new_line only: the complete key of the row to be born (BUD-R7).
      { column_name: 'new_line_key', column_type: 'JSON' },
    ],
  })

  // The change request: submittable — approval IS the submit transition
  // (directly or via a Workflow whose state targets 'submitted'), and the
  // apply happens in that same transaction (BUD-R5).
  await ensure({
    name: 'Budget Change',
    module: 'Core',
    system: true,
    is_submittable: true,
    id_pattern: 'BCR-.####',
    columns: [
      { column_name: 'book', column_type: 'Reference', reference_table: 'Budget Book', reqd: true, in_list_view: true },
      { column_name: 'change_type', column_type: 'Choice', choices: 'revise\ntransfer\nnew_line\ndiscontinue', default_value: 'revise', reqd: true, in_list_view: true },
      { column_name: 'reason', column_type: 'Text', reqd: true },
      // discontinue only: first measure column (declaration order) to zero.
      { column_name: 'effective_from', column_type: 'Data' },
      { column_name: 'total_delta', column_type: 'Float', read_only: true, in_list_view: true },
      { column_name: 'crosses_owner', column_type: 'Check', read_only: true },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Budget Change Line' },
    ],
  })

  // Snapshot header. v0 ("baseline") is written by :baseline; later ones by
  // the :snapshot action.
  await ensure({
    name: 'Budget Version',
    module: 'Core',
    system: true,
    columns: [
      { column_name: 'book', column_type: 'Reference', reference_table: 'Budget Book', reqd: true, in_list_view: true },
      { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'kind', column_type: 'Choice', choices: 'baseline\nreforecast\nadhoc', default_value: 'baseline', in_list_view: true },
      { column_name: 'line_count', column_type: 'Int', read_only: true, in_list_view: true },
    ],
  })

  // Snapshot body: one row per bound row, data = declared key + measure
  // (+ owner) values as JSON (BUD-R10). A plain table, not a sub-table —
  // written in bulk by the snapshot action, never through saveChildren's
  // replace-set semantics.
  await ensure({
    name: 'Budget Version Line',
    module: 'Core',
    system: true,
    columns: [
      { column_name: 'version', column_type: 'Reference', reference_table: 'Budget Version', reqd: true, in_list_view: true },
      { column_name: 'ref_name', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'data', column_type: 'JSON' },
    ],
  })

  // Converge databases where an earlier run of this migration created the
  // tables before system: true was part of the definitions.
  await sql`update table_def set system = true
    where name = any(${ENGINE_TABLES}) and system = false`
}
