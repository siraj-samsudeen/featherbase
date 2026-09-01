// Spec 0007, BUD-R13 (review finding P0-4): a Budget Change Line may carry
// the value its author actually SAW when they proposed, separately from the
// engine's own snapshot of the live value.
//
// current_value is re-snapped on every save by design (BUD-R4), which is why
// it cannot double as the concurrency token: an editor who opened 100, was
// overtaken by a colleague's 120, and then saved a proposal for 110 had
// their observation silently replaced and lost the other edit without ever
// seeing a conflict. observed_value is written by the client once and never
// overwritten by the engine, so that lost update becomes a 409.
import { sql } from '../src/db'

export async function up() {
  const [exists] = await sql`
    select 1 from column_def
    where parent = 'Budget Change Line' and column_name = 'observed_value'`
  if (exists) return
  await sql.unsafe(
    `alter table "budget_change_line" add column if not exists "observed_value" numeric(21,9)`,
  )
  const [{ n }] = await sql`
    select count(*)::int as n from column_def where parent = 'Budget Change Line'`
  await sql`insert into column_def ${sql({
    parent: 'Budget Change Line',
    position: Number(n) + 1,
    column_name: 'observed_value',
    label: 'Observed Value',
    column_type: 'Float',
    // Deliberately writable: this is the one value on the line that the
    // CLIENT owns. The engine reads it and never assigns it.
    in_list_view: true,
  })}`
}
