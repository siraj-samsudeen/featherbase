import { sql } from './db'
import { getDoc } from './document'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { AppError } from './errors'
import { PLATFORM_SCHEMA } from './platform-schema'

// Platform records that name one row by its id in plain text, beside a column
// naming its Table: its timeline, attachments, shares, assignments, tags,
// notifications, emails, access entries and row-level data scopes. No
// foreign key ties them to the row, so renaming carries them along here.
// test/document-activity.test.ts holds this list equal to the person
// registry's conditional ids, so a new such column cannot be missed.
export const ROW_ID_HOLDERS = [
  { relation: 'access_log', tableColumn: 'ref_table', nameColumn: 'reference_name' },
  { relation: 'comment', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'data_scope', tableColumn: 'allow_table', nameColumn: 'for_value' },
  { relation: 'email_queue', tableColumn: 'ref_table', nameColumn: 'reference_name' },
  { relation: 'file', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'import_source', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'import_conflict', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'notification_log', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'share', tableColumn: 'share_table', nameColumn: 'share_name' },
  { relation: 'tag_link', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'todo', tableColumn: 'ref_table', nameColumn: 'reference_name' },
  { relation: 'version', tableColumn: 'ref_table', nameColumn: 'ref_name' },
  { relation: 'workflow_action', tableColumn: 'ref_table', nameColumn: 'ref_name' },
] as const

/** Repoint every platform record naming `table` row `oldId` to `newId`.
 *  The caller holds the renamed row's lock inside its transaction. */
export async function repointRowActivity(tx: typeof sql, table: string, oldId: string, newId: string) {
  // A tag the target id already carries (left by an earlier row of that id)
  // would collide on tag_link's key; the row keeps one copy of it.
  await tx`
    delete from ${tx(`${PLATFORM_SCHEMA}.tag_link`)} old
    where old.ref_table = ${table} and old.ref_name = ${oldId}
      and exists (select 1 from ${tx(`${PLATFORM_SCHEMA}.tag_link`)} t
                  where t.ref_table = ${table} and t.ref_name = ${newId} and t.tag = old.tag)`
  for (const { relation, tableColumn, nameColumn } of ROW_ID_HOLDERS)
    await tx`
      update ${tx(`${PLATFORM_SCHEMA}.${relation}`)} set ${tx(nameColumn)} = ${newId}
      where ${tx(tableColumn)} = ${table} and ${tx(nameColumn)} = ${oldId}`
}

// Internal callers must authorize and lock the source row first. Counts may
// include hidden activity, but never expose its values or another row's ID.
// A row with any of these is refused deletion, so no one's work is lost
// (#321; app rows have always been).
export async function retainedActivityCounts(tx: typeof sql, table: string, rowId: string) {
  const [counts] = await tx`
    select (select count(*)::int from comment where ref_table = ${table} and ref_name = ${rowId}) as comments,
           (select count(*)::int from version where ref_table = ${table} and ref_name = ${rowId}) as versions,
           (select count(*)::int from file where ref_table = ${table} and ref_name = ${rowId}) as files,
           (select count(*)::int from share where share_table = ${table} and share_name = ${rowId}) as shares`
  return { comments: Number(counts.comments), versions: Number(counts.versions),
    files: Number(counts.files), shares: Number(counts.shares) }
}

const KINDS: Record<string, [string, string]> = {
  comments: ['comment', 'comments'], versions: ['history entry', 'history entries'],
  files: ['attachment', 'attachments'], shares: ['share', 'shares'],
  references: ['row linking to it', 'rows linking to it'],
}

/** Refuse a delete while the row has retained activity, naming each kind and
 *  its count, e.g. "it has 2 comments and 1 history entry". */
export function assertNothingRetained(table: string, rowId: string, counts: Record<string, number>): void {
  const held = Object.entries(counts).filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${KINDS[kind]?.[n === 1 ? 0 : 1] ?? kind}`)
  if (!held.length) return
  const list = held.length === 1 ? held[0] : `${held.slice(0, -1).join(', ')} and ${held.at(-1)}`
  throw new AppError('ValidationError', `${table} ${rowId} cannot be deleted: it has ${list}`,
    Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, String(count)])))
}

export async function retainedDocumentCounts(tx: typeof sql, table: string, rowId: string) {
  const activity = await retainedActivityCounts(tx, table, rowId)
  let references = 0
  const columns = await tx`select parent, column_name from column_def where column_type = 'Reference' and reference_table = ${table}`
  for (const column of columns) {
    const meta = await getMeta(String(column.parent))
    if (meta.data_source || meta.kind === 'settings') throw new AppError('ValidationError', 'Deletion cannot prove references from nonlocal Tables')
    const [count] = await tx`select count(*)::int as n from ${tx(await tableRelation(meta.name))} where ${tx(String(column.column_name))} = ${rowId}`
    references += Number(count.n)
  }
  return { comments: activity.comments, versions: activity.versions, references,
    files: activity.files, shares: activity.shares }
}

export async function documentActivity(table: string, name: string, user: string) {
  const visibleDoc = await getDoc(table, name, user)
  const visibleFields = new Set(Object.keys(visibleDoc))
  const [comments, versions] = await Promise.all([
    sql`select row_id, content, created_by, created_at from comment
        where ref_table = ${table} and ref_name = ${name} order by created_at asc`,
    sql`select data, created_by, created_at from version
        where ref_table = ${table} and ref_name = ${name} order by created_at asc`,
  ])
  const visibleVersions = versions.map((version) => {
    const data = version.data as { changed?: [string, unknown, unknown][]; import_run?: string; resolution?: { field: string; decision: string; incoming: unknown } } | null
    return {
      ...version,
      data: {
        ...(data?.import_run ? { import_run: data.import_run } : {}),
        ...(data?.resolution && visibleFields.has(data.resolution.field) ? { resolution: data.resolution } : {}),
        changed: (data?.changed ?? []).filter(([field]) => visibleFields.has(field)),
      },
    }
  })
  return { comments, versions: visibleVersions }
}
