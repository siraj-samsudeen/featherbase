// #905: archive a table. Its rows and history stay readable to whoever could
// read them; every row write is refused (system-written.ts, the same gate as
// a system-written Table); it leaves the menus, the command bar and the table
// pickers. Deleting it stays a separate, later step.
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta, type TableMeta } from './meta'
import { logAccess } from './audit'

const NOTE_LIMIT = 500

/** Only a custom table people write: never the platform's, a settings
 *  table, a sub-table (it goes with its parent) or an installed app's. */
function assertArchivable(meta: TableMeta): void {
  const why = meta.system || meta.system_written ? 'it is a platform table'
    : meta.kind === 'settings' ? 'it holds settings'
    : meta.kind === 'sub_table' ? 'it is a sub-table; archive the table it belongs to'
    : meta.owner_app ? `it belongs to the ${meta.owner_app} app`
    : null
  if (why) throw new AppError('ValidationError', `${meta.name} cannot be archived: ${why}`)
}

export async function archiveTable(name: string, actor: string, note: unknown): Promise<TableMeta> {
  if (note != null && typeof note !== 'string') throw new AppError('ValidationError', 'The note must be text')
  const text = note?.trim() || null
  if (text && text.length > NOTE_LIMIT) throw new AppError('ValidationError', `Keep the note under ${NOTE_LIMIT} characters`)
  const meta = await getMeta(name)
  assertArchivable(meta)
  if (meta.archived_at) throw new AppError('ValidationError', `${meta.name} is already archived`)
  await sql.begin(async (tx) => {
    await tx`update table_def set archived_at = now(), archived_by = ${actor}, archived_note = ${text}, updated_at = now(), updated_by = ${actor}
      where name = ${meta.name}`
    await logAccess(actor, 'archive_table', { table: meta.name, required: true }, tx)
  })
  invalidateMeta(meta.name)
  return getMeta(meta.name)
}

export async function unarchiveTable(name: string, actor: string): Promise<TableMeta> {
  const meta = await getMeta(name)
  if (!meta.archived_at) throw new AppError('ValidationError', `${meta.name} is not archived`)
  await sql.begin(async (tx) => {
    await tx`update table_def set archived_at = null, archived_by = null, archived_note = null, updated_at = now(), updated_by = ${actor}
      where name = ${meta.name}`
    await logAccess(actor, 'unarchive_table', { table: meta.name, required: true }, tx)
  })
  invalidateMeta(meta.name)
  return getMeta(meta.name)
}
