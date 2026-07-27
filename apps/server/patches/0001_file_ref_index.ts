import type { Sql } from 'postgres'

// Speeds attachment lookups (FILE-002/003 filter file by the row a file is
// attached to). Idempotent DDL, but the patch log guarantees it also only
// ever runs once.
export async function up(tx: Sql): Promise<void> {
  await tx.unsafe(
    'create index if not exists file_ref_idx on file (ref_table, ref_name)',
  )
}
