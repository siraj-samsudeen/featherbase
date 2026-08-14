// EDS-2: FK-aware reflection. A reflected column that carries a foreign key
// on its source records the RAW source-level target here — schema, table,
// column — so reflection can converge in ANY order: whichever side reflects
// second, reflect.ts resolves the recorded edges against the tables now
// present and upgrades matching columns to Reference. Metadata only, no DDL
// against any source (BV1).
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  await sql.unsafe(`
    alter table column_def
      add column if not exists source_fk_schema text,
      add column if not exists source_fk_table text,
      add column if not exists source_fk_column text`)
  invalidateMeta()
}
