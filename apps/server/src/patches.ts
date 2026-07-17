import type { Sql } from 'postgres'
import { sql } from './db'

// PLAT-003: ordered, recorded patches. Distinct from the doctype-seed
// migrations (which need the engine's own transactions): a patch is a one-off
// schema/data change that must run EXACTLY ONCE per database, in order, each
// inside a single transaction so a failure rolls back both its changes and its
// log entry. The run aborts on the first failing patch, leaving every prior
// patch applied and the failing one un-recorded (so it retries next run).

export interface Patch {
  name: string
  up: (tx: Sql) => Promise<void>
}

export async function ensurePatchLog(): Promise<void> {
  await sql`create table if not exists patch_log (
    patch text primary key,
    applied_at timestamptz not null default now()
  )`
}

export async function appliedPatches(): Promise<Set<string>> {
  await ensurePatchLog()
  const rows = await sql`select patch from patch_log`
  return new Set(rows.map((r) => r.patch as string))
}

// Applies every not-yet-recorded patch in the given order. Returns the names
// that were newly applied. Throws (aborting the run) on the first failure.
export async function runPatches(patches: Patch[]): Promise<string[]> {
  const done = await appliedPatches()
  const newly: string[] = []
  for (const p of patches) {
    if (done.has(p.name)) continue
    // The patch body and the log insert commit together or not at all.
    await sql.begin(async (tx) => {
      await p.up(tx as unknown as Sql)
      await tx`insert into patch_log (patch) values (${p.name})`
    })
    newly.push(p.name)
  }
  return newly
}
