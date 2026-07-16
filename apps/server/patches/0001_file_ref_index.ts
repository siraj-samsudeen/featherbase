import type { Sql } from 'postgres'

// Speeds attachment lookups (FILE-002/003 filter tab_file by the document a
// file is attached to). Idempotent DDL, but the patch log guarantees it also
// only ever runs once.
export async function up(tx: Sql): Promise<void> {
  await tx.unsafe(
    'create index if not exists tab_file_ref_idx on tab_file (ref_doctype, ref_name)',
  )
}
