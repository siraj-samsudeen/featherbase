// #905: archive a table. Its rows and history stay readable to whoever could
// read them; every row write is refused (system-written.ts, the same gate as
// a system-written Table); it leaves the menus, the command bar and the table
// pickers. Deleting it stays a separate, later step. #1041: an installed app's
// unused table too; the app's own reads and people's scope carry on, and an
// upgrade leaves the mark alone, since it never names these columns.
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta, type TableMeta } from './meta'
import { logAccess } from './audit'
import { SECURITY_TABLES } from './security-tables'
import { tableRelation } from './table-engine'

const NOTE_LIMIT = 500

/** A table people write, custom or (#1041) an installed app's: never the
 *  platform's, a settings table or a sub-table (it goes with its parent). */
async function assertArchivable(meta: TableMeta): Promise<void> {
  const refuse = (why: string) => new AppError('ValidationError', `${meta.name} cannot be archived: ${why}`)
  if (meta.system || meta.system_written) throw refuse('it is a platform table')
  if (meta.kind === 'settings') throw refuse('it holds settings')
  if (meta.kind === 'sub_table') throw refuse('it is a sub-table; archive the table it belongs to')
  const decidesAccess = meta.decides_scope || SECURITY_TABLES.has(meta.name)
  if (!meta.owner_app) {
    if (decidesAccess) throw refuse('it decides who can see or do what')
    return
  }
  // The app opens from it and checks people's access against it.
  const [app] = await sql`select manifest->>'entryTable' as entry_table from installed_app where name = ${meta.owner_app}`
  if (app?.entry_table === meta.name) throw refuse(`it is the entry table of the ${meta.owner_app} app`)
  // An empty one decides nothing yet, and archiving keeps it empty. One with
  // rows may be deciding someone's access, which must stay visible and editable.
  if (decidesAccess) {
    const [row] = await sql`select 1 from ${sql(await tableRelation(meta.name))} limit 1`
    if (row) throw refuse('it decides who can see or do what, and it holds rows')
  }
}

export async function archiveTable(name: string, actor: string, note: unknown): Promise<TableMeta> {
  if (note != null && typeof note !== 'string') throw new AppError('ValidationError', 'The note must be text')
  const text = note?.trim() || null
  if (text && text.length > NOTE_LIMIT) throw new AppError('ValidationError', `Keep the note under ${NOTE_LIMIT} characters`)
  const meta = await getMeta(name)
  await assertArchivable(meta)
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
