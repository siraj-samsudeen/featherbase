// Spec 0007, BUD-R14/R15/R16 — owner decisions of 2026-09-01 (Q7, Q8, Q9).
//
// A Budget Book can now govern one of two shapes:
//
//   mutate_rows      — approval replaces values in the bound table (today).
//   append_decisions — the bound table is a READ-ONLY model, and approval
//                      appends one immutable Budget Decision beside it.
//
// Append mode is what an overlay ledger needs: model numbers stay untouched,
// two decisions may address the same scope (the application derives which is
// in force), and a superseded decision stays readable for grading — none of
// which a mutating engine can express, since it overwrites the number and
// BUD-R7 refuses a colliding key outright.
//
// A decision may address a ROW or a SCOPE. A scope decision is stored once,
// with nullable dimensions meaning "all", and the engine never expands it:
// one push across a region is one decision, counted once at its node. (The
// alternative — expanding to leaves — changes both the arithmetic and the
// audit meaning, which is why the line cap was never the thing to raise.)
//
// The ledger is deliberately NATIVE, in the same database as the Budget
// Change: approval and append then commit in one transaction. Model tables
// stay reflected and read-only (Q9) — BUD-R1's data_source guard stands.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

async function ensure(def: Parameters<typeof createTable>[0] & { name: string }) {
  const [exists] = await sql`select 1 from table_def where name = ${def.name}`
  if (!exists) await createTable(def)
}

async function ensureColumn(
  table: string,
  column: string,
  pgType: string,
  def: Record<string, unknown>,
) {
  const [exists] = await sql`
    select 1 from column_def where parent = ${table} and column_name = ${column}`
  if (exists) return
  const physical = table.toLowerCase().replace(/ /g, '_')
  const defaultSql =
    pgType === 'boolean' ? ' not null default false'
    : def.default_value != null ? ` not null default '${String(def.default_value)}'`
    : ''
  await sql.unsafe(
    `alter table "${physical}" add column if not exists "${column}" ${pgType}${defaultSql}`,
  )
  const [{ n }] = await sql`
    select count(*)::int as n from column_def where parent = ${table}`
  await sql`insert into column_def ${sql({
    parent: table,
    position: Number(n) + 1,
    column_name: column,
    ...def,
  })}`
}

export async function up() {
  // The ledger. Immutable by controller (BUD-R16): no update, no delete —
  // the road back is another decision, exactly as BUD-R9 for changes.
  await ensure({
    name: 'Budget Decision',
    module: 'Core',
    system: true,
    id_pattern: 'BDC-.#####',
    columns: [
      { column_name: 'book', column_type: 'Reference', reference_table: 'Budget Book', reqd: true, in_list_view: true },
      // Provenance: the approval that appended this decision.
      { column_name: 'change', column_type: 'Reference', reference_table: 'Budget Change', reqd: true, in_list_view: true },
      { column_name: 'target_kind', column_type: 'Choice', choices: 'row\nscope', default_value: 'row', reqd: true, in_list_view: true },
      // target_kind row: the bound row this decision is about.
      { column_name: 'line_ref', column_type: 'Data', in_list_view: true },
      // target_kind scope: declared key columns → value, absent/null = "all".
      // Stored once and never expanded (BUD-R15).
      { column_name: 'scope', column_type: 'JSON' },
      { column_name: 'measure', column_type: 'Data', reqd: true, in_list_view: true },
      // 'set' states the number; 'delta' moves it. A scope 'delta' is the
      // node-level push; the engine never divides it across leaves.
      { column_name: 'basis', column_type: 'Choice', choices: 'set\ndelta', default_value: 'set', reqd: true },
      { column_name: 'value', column_type: 'Float', reqd: true, in_list_view: true },
      // The application's own typed fields, carried as ONE document rather
      // than smuggled in as extra scalar lines. Opaque to the engine.
      { column_name: 'payload', column_type: 'JSON' },
      // The model run this judgment was made against, so a later reader can
      // ask "which numbers was this human looking at?".
      { column_name: 'model_version', column_type: 'Data', in_list_view: true },
      { column_name: 'reason', column_type: 'Text', reqd: true },
      // Server-derived, never client-supplied: who decided, and as what.
      { column_name: 'decided_by', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'decided_role', column_type: 'Data' },
      { column_name: 'decided_at', column_type: 'Datetime', reqd: true },
    ],
  })

  await ensureColumn('Budget Book', 'mode', 'text', {
    label: 'Mode',
    column_type: 'Choice',
    choices: 'mutate_rows\nappend_decisions',
    default_value: 'mutate_rows',
    in_list_view: true,
  })
  // The model run a book's decisions are being made against (append mode).
  await ensureColumn('Budget Book', 'model_version', 'text', { label: 'Model Version', column_type: 'Data' })

  // A change line can now address a scope instead of a row, and carry the
  // application's typed payload.
  await ensureColumn('Budget Change Line', 'target_kind', 'text', {
    label: 'Target Kind',
    column_type: 'Choice',
    choices: 'row\nscope',
    default_value: 'row',
  })
  await ensureColumn('Budget Change Line', 'scope', 'jsonb', { label: 'Scope', column_type: 'JSON' })
  await ensureColumn('Budget Change Line', 'payload', 'jsonb', { label: 'Payload', column_type: 'JSON' })
  await ensureColumn('Budget Change Line', 'basis', 'text', {
    label: 'Basis',
    column_type: 'Choice',
    choices: 'set\ndelta',
    default_value: 'set',
  })
}
