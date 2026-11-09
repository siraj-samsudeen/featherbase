import { renameNamingColumn, tableSlug } from 'shared'
import { sql, type TxSql } from './db'
import { AppError } from './errors'
import { assertNotSystemWritten } from './system-written'
import { renameColumnInSyncRules, renameTableInSyncRules } from './master-sync-names'
import { type TableMeta, getMeta, invalidateMeta } from './meta'
import { policyColumns } from './access-policy'
import { logAccess } from './audit'
import { asNameList } from './installed-app-ledger'
import { COLUMN_NAME_RE, quoteIdent } from './sql-identifier'
import { PLATFORM_SCHEMA, resolvedRelation, tableName } from './platform-schema'
import { RESERVED_COLUMNS, STANDARD_COLUMNS, assertNotCopyMarker, assertNotViewFilterColumn, assertTableAddressAvailable, pgType, quoteRelation, seriesKey, storedRelation, tableDefSchema, tableRelation } from './table-engine'

// #209 (issue #197): rename a column in place, keeping its data.
//
// "In one of the things floor was spelled with a G, Glor." The mistake is in
// the NAME, and the rows underneath it are fine — so the fix has to be a
// rename, not a new column beside the old one.
//
// updateTable cannot do this: it matches columns by `column_name`, so a
// changed name reads as "delete that one, add this one" — the old physical
// column is orphaned with its data and the new one arrives empty. That is a
// silent data loss, which is why this is its own operation with its own DDL.
export async function renameColumn(
  table: string,
  from: string,
  to: string,
  user = 'Administrator',
): Promise<TableMeta> {
  const meta = await getMeta(table)
  if (policyColumns(meta.access_policy).includes(from))
    throw new AppError('PermissionError', 'A column that defines mandatory access cannot be renamed')
  assertNotSystemWritten(meta, 'renamed or changed')
  if (meta.system)
    throw new AppError('ValidationError', `${meta.name} is a system table and cannot be changed`)
  await assertNotCopyMarker(meta.name, from, 'renamed')
  if (meta.kind === 'view') throw new AppError('ValidationError', `${meta.name} is a view; rename the column on ${meta.view_of}`)
  await assertNotViewFilterColumn(meta.name, from, 'renamed')
  // BV1: a bound Table's storage belongs to the source. Renaming its column
  // here would rename nothing real and desynchronise the binding.
  if (meta.data_source)
    throw new AppError(
      'ValidationError',
      `${meta.name} is bound to a data source; rename the column at the source`,
    )

  // Checked BEFORE "no such column": a standard column is not absent, it is
  // off limits, and saying so is the useful answer.
  if ((STANDARD_COLUMNS as readonly string[]).includes(from))
    throw new AppError('ValidationError', `${from} is a standard column and cannot be renamed`)
  const column = meta.columns.find((c) => c.column_name === from)
  if (!column) throw new AppError('NotFoundError', `${meta.name} has no column ${from}`)

  const target = to.trim()
  if (target === from) return meta
  if (!COLUMN_NAME_RE.test(target))
    throw new AppError('ValidationError', 'column_name must be snake_case', { to: 'snake_case' })
  if (RESERVED_COLUMNS.includes(target))
    throw new AppError('ValidationError', `${target} is a standard column name`)
  if (meta.columns.some((c) => c.column_name === target))
    throw new AppError('ValidationError', `${meta.name} already has a column ${target}`)

  const physical = tableName(meta.name)
  const relation = quoteRelation(await tableRelation(meta.name))
  const hasStorage = pgType(column.column_type) !== null && meta.kind !== 'settings'

  await sql.begin(async (tx) => {
    if (hasStorage)
      await tx.unsafe(`alter table ${relation} rename column ${quoteIdent(from)} to ${quoteIdent(target)}`)
    await tx`update column_def set column_name = ${target}
      where parent = ${meta.name} and column_name = ${from}`
    // #881: a link to a row of any Table keeps naming its Table column.
    await tx`update column_def set table_column = ${target}
      where parent = ${meta.name} and table_column = ${from}`
    await tx`update featherbase.table_copy set key_column = ${target}
      where target_table = ${meta.name} and key_column = ${from}`
    // #936: a master sync rule naming this column keeps working.
    await renameColumnInSyncRules(tx, meta.name, from, target)
    // A Sub-table's children name their column on every row, in
    // `parentfield`, and every child read filters on it (document.ts
    // loadChildren). Renaming only the column_def would leave them addressed
    // under a name nothing asks for: the parent loads an empty list, and the
    // next save of that row deletes the children it could not see.
    if (column.column_type === 'Sub-table' && column.row_table)
      await tx.unsafe(
        `update ${quoteRelation(await tableRelation(column.row_table))} set parentfield = $1
          where parenttype = $2 and parentfield = $3`,
        [target, meta.name, from],
      )
    // A unique constraint carries the old name in its own name. Postgres
    // renames the column inside it but not the constraint, so the next
    // updateTable — which builds that name from the column — would fail to
    // find it. Rename it to match.
    if (column.unique && hasStorage)
      await tx.unsafe(
        `alter table ${relation} rename constraint ${quoteIdent(`${physical}_${from}_uq`)} to ${quoteIdent(`${physical}_${target}_uq`)}`,
      )
    // The two places this Table names its own column. Left stale, the id
    // pattern would stop resolving and the list would lose its title.
    if (meta.title_column === from)
      await tx`update table_def set title_column = ${target} where name = ${meta.name}`
    // #246: and the columns its Data Scope narrows by.
    if (meta.scope_on?.includes(from))
      await tx`update table_def set scope_on = ${meta.scope_on.map((c) => c === from ? target : c)} where name = ${meta.name}`
    // The column rules (`field:<column>`, `PREFIX-{<column>}`, see
    // document.ts) name a column. Left stale one stops resolving, and every new
    // row fails with "Naming field glor is required" for a column that is gone.
    const idPattern = renameNamingColumn(meta.id_pattern, from, target)
    if (idPattern !== meta.id_pattern)
      await tx`update table_def set id_pattern = ${idPattern} where name = ${meta.name}`
    // #651: an Admin override (a relabel, a hidden flag) belongs to the
    // column, not to its old name.
    await tx`update metadata_override set column_name = ${target} where table_name = ${meta.name} and column_name = ${from}`
    await renameInGlossary(tx, meta.name, { table: meta.name, column: from }, { table: meta.name, column: target })
    await renameInImportHistory(tx, meta.name, from, target)
    await tx`update table_def set updated_at = ${new Date()} where name = ${meta.name}`
  })

  invalidateMeta(meta.name)
  await logAccess(user, `rename_column ${from} -> ${target}`, {
    table: 'Table',
    row_id: meta.name,
  }).catch(() => {})
  return getMeta(meta.name)
}

// #865: an import decides who owns a field from the row's history, the source
// values it remembers and its open conflicts, all keyed by column name. Left
// under the old name, a person's correction reads as never made and the next
// import overwrites it without a conflict.
async function renameInImportHistory(tx: TxSql, table: string, from: string, to: string) {
  await tx`update version set data = jsonb_set(data, '{changed}', (
      select jsonb_agg(case when c->>0 = ${from} then jsonb_set(c, '{0}', to_jsonb(${to}::text)) else c end order by i)
      from jsonb_array_elements(data->'changed') with ordinality as e(c, i)))
    where ref_table = ${table} and jsonb_typeof(data->'changed') = 'array'
      and jsonb_path_exists(data->'changed', '$[*] ? (@[0] == $f)', jsonb_build_object('f', ${from}::text))`
  await tx`update version set data = jsonb_set(data, '{resolution,field}', to_jsonb(${to}::text))
    where ref_table = ${table} and data->'resolution'->>'field' = ${from}`
  await tx`update featherbase.import_source set values = (values - ${from}::text) || jsonb_build_object(${to}::text, values->${from}::text)
    where ref_table = ${table} and values ? ${from}::text`
  await tx`update featherbase.import_conflict set field = ${to} where ref_table = ${table} and field = ${from}`
}

// #629: a glossary term describes Tables and columns by name, in its links
// and in the app's wording it keeps to tell a reworded term from one that is
// not. A rename carries both, or every term naming the old name would lose
// its "?" and refuse its next save.
async function renameInGlossary(tx: TxSql, table: string, from: { table: string; column?: string }, to: { table: string; column?: string }) {
  const key = from.column === undefined ? 'table' : 'column'
  const before = from.column ?? from.table
  const after = to.column ?? to.table
  if (from.column === undefined) await tx`update glossary_link set link_table = ${after} where link_table = ${before}`
  else await tx`update glossary_link set link_column = ${after} where link_table = ${table} and link_column = ${before}`
  await tx`update glossary_term set app_wording = jsonb_set(app_wording, '{describes}', (
      select jsonb_agg(case when d->>'table' = ${table} and d->>${key} = ${before}
        then jsonb_set(d, array[${key}::text], to_jsonb(${after}::text)) else d end order by n)
      from jsonb_array_elements(app_wording->'describes') with ordinality as e(d, n)))
    where jsonb_typeof(app_wording->'describes') = 'array'
      and app_wording->'describes' @> jsonb_build_array(jsonb_build_object('table', ${table}::text, ${key}::text, ${before}::text))`
}

// #651: where the platform keeps a Table's name outside its own definition,
// beyond the link columns declared Reference -> Table (swept by metadata).
const TABLE_NAME_COLUMNS: readonly [string, string][] = [
  ['custom_field', 'reference_table'], ['custom_field', 'row_table'], ['access_log', 'ref_table'],
  ['saved_view', 'ref_table'], ['user_settings', 'table_name'], ['tag_link', 'ref_table'],
  // #871: an import's memory of each row, so a re-import keeps people's edits.
  [`${PLATFORM_SCHEMA}.import_source`, 'ref_table'], [`${PLATFORM_SCHEMA}.import_conflict`, 'ref_table'],
]

// #651: rename one of an app's Tables, keeping its rows, its history, the
// links to it and its grants. Only the owning app's upgrade renames a Table:
// Admin customization never changes what an app's Table is.
export async function renameTable(from: string, to: string, ownerApp: string, user = 'Administrator'): Promise<TableMeta> {
  const meta = await getMeta(from)
  if (meta.owner_app !== ownerApp || !meta.physical_schema || !meta.physical_relation)
    throw new AppError('ValidationError', `${from} belongs to ${meta.owner_app ?? 'the platform'}; only its own app renames it`)
  if (!to.startsWith(`${ownerApp}.`) || !tableDefSchema.shape.name.safeParse(to).success)
    throw new AppError('ValidationError', `${to} is not a name for one of ${ownerApp}'s Tables`)
  const foreign = await sql<{ parent: string; column_name: string }[]>`
    select cd.parent, cd.column_name from column_def cd join table_def td on td.name = cd.parent
    where (cd.reference_table = ${from} or cd.row_table = ${from}) and td.owner_app is not null and td.owner_app <> ${ownerApp}
    order by 1, 2`
  if (foreign.length)
    throw new AppError('ValidationError', `${from} is linked from another app's ${foreign.map((f) => `${f.parent}.${f.column_name}`).join(', ')}`)
  return moveTable(meta, to, to.split('.')[1], user)
}

// #871: a System Manager renames a Table made in the builder or by an import.
// Platform Tables, app Tables and Tables bound to a data source keep their
// names: each is named by something outside this instance's Admin.
export async function renameCustomTable(from: string, input: string, user: string): Promise<TableMeta> {
  const meta = await getMeta(from)
  const to = input.trim()
  if (to === meta.name) return meta
  assertNotSystemWritten(meta, 'renamed or changed')
  if (meta.system || meta.owner_app || meta.data_source || meta.kind === 'settings')
    throw new AppError('ValidationError', `${meta.name} is not a custom Table; it cannot be renamed here`)
  // An installed app's ledger names its Tables; uninstalling acts on those names.
  const apps = await sql<{ name: string; tables: unknown }[]>`select name, tables from installed_app order by name`
  const owner = apps.find((app) => asNameList(app.tables).includes(meta.name))
  if (owner) throw new AppError('ValidationError', `${meta.name} belongs to the installed app ${owner.name}; it cannot be renamed here`)
  if (to.includes('.') || !tableDefSchema.shape.name.safeParse(to).success)
    throw new AppError('ValidationError', 'A Table name starts with a letter and has only letters, digits and spaces, up to 61 characters', {
      name: 'letters, digits and spaces',
    })
  return moveTable(meta, to, tableName(to), user)
}

// Every live pointer at a Table moves with it, history included: unlike a
// deletion, a rename keeps what history says, under the name the Table now has.
async function moveTable(meta: TableMeta, to: string, relationName: string, user: string): Promise<TableMeta> {
  const from = meta.name
  const [schemaName, fromRelation] = resolvedRelation(meta).split('.')
  const [taken] = await sql`select 1 from table_def where lower(name) = lower(${to}) and name <> ${from}`
  // A change of case alone ("Sap plant") keeps the same storage.
  // #1021: a view has no storage to move, only its definition.
  const isView = meta.kind === 'view'
  const sameRelation = relationName === fromRelation || isView
  const [clash] = relationName === fromRelation ? [] : await sql`select 1 from information_schema.tables where table_schema = ${schemaName} and table_name = ${relationName}`
  if (taken || clash) throw new AppError('ConflictError', `Table ${to} already exists`)
  const pointers = await sql<{ parent: string; column_name: string }[]>`
    select cd.parent, cd.column_name from column_def cd join table_def td on td.name = cd.parent
    where cd.column_type = 'Reference' and cd.reference_table = 'Table'
      and td.kind <> 'settings' and td.data_source is null
    order by 1, 2`
  const relations = new Map<string, string>()
  // The Table being renamed may hold such a link itself: by the time the
  // sweep runs, its rows live under the new name.
  for (const p of pointers)
    relations.set(p.parent, p.parent === from ? quoteRelation(`${schemaName}.${relationName}`) : quoteRelation(await storedRelation(p.parent)))
  const children: string[] = []
  for (const c of meta.columns)
    if (c.column_type === 'Sub-table' && c.row_table) children.push(quoteRelation(await storedRelation(c.row_table)))

  const schema = quoteIdent(schemaName)
  const relation = `${schema}.${quoteIdent(relationName)}`
  await sql.begin(async (tx) => {
    await assertTableAddressAvailable(tx, to, from)
    if (!sameRelation) {
      await tx.unsafe(`alter table ${quoteRelation(`${schemaName}.${fromRelation}`)} rename to ${quoteIdent(relationName)}`)
      // Names Postgres built from the relation (its primary key, and on 18 its
      // NOT NULL constraints): a fresh Table under the new name has them so.
      const built = await tx<{ conname: string }[]>`
        select conname from pg_constraint where conrelid = (
          select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ${schemaName} and c.relname = ${relationName})
        and starts_with(conname, ${`${fromRelation}_`})`
      for (const { conname } of built)
        await tx.unsafe(`alter table ${relation} rename constraint ${quoteIdent(conname)} to ${quoteIdent(`${relationName}_${conname.slice(fromRelation.length + 1)}`)}`)
      // Names built from the Table's own name, so the next schema change finds
      // them. A custom Table's relation IS its name: the loop above did these.
      if (tableName(from) !== fromRelation) for (const c of meta.columns)
        if (c.unique && pgType(c.column_type))
          await tx.unsafe(`alter table ${relation} rename constraint ${quoteIdent(`${tableName(from)}_${c.column_name}_uq`)} to ${quoteIdent(`${tableName(to)}_${c.column_name}_uq`)}`)
      if (meta.kind === 'sub_table')
        await tx.unsafe(`alter index ${schema}.${quoteIdent(`${tableName(from)}_parent_idx`)} rename to ${quoteIdent(`${tableName(to)}_parent_idx`)}`)
    }
    if (meta.kind !== 'sub_table' && !isView) {
      const [policy] = await tx`select 1 from pg_policies where schemaname = ${schemaName} and tablename = ${relationName} and policyname = 'fc_select'`
      if (policy) await tx.unsafe(`alter policy fc_select on ${relation} using (featherbase.fc_has_read('${to.replace(/'/g, "''")}'))`)
    }
    // column_def's key on table_def has no ON UPDATE: the definition moves.
    // A custom Table's storage follows its name; an app's is mapped.
    const [row] = await tx`select * from table_def where name = ${from}`
    await tx`insert into table_def ${tx({ ...row, name: to, ...(meta.owner_app ? { physical_relation: relationName } : {}), updated_at: new Date() } as unknown as Record<string, never>)}`
    await tx`update column_def set parent = ${to} where parent = ${from}`
    // #1021: its views stay based on it, under its new name.
    await tx`update table_def set view_of = ${to} where view_of = ${from}`
    // A copied Table's provenance follows it, before the old definition's
    // delete would cascade it away (#772: Copy again must survive a rename).
    await tx`update featherbase.table_copy set target_table = ${to} where target_table = ${from}`
    // #936: a master sync rule naming this Table as its master or link keeps working.
    await renameTableInSyncRules(tx, from, to)
    await tx`delete from table_def where name = ${from}`
    await tx`update column_def set reference_table = ${to} where reference_table = ${from}`
    // #881: a link to a row of any Table keeps allowing the Table by its new
    // name; the rows' Table half moves with every other link to Table below.
    await tx`update column_def set choices = array_to_string(array_replace(string_to_array(choices, E'\n'), ${from}::text, ${to}::text), E'\n')
             where table_column is not null and choices is not null`
    await tx`update column_def set row_table = ${to} where row_table = ${from}`
    // #855: the renamed Table carries on its own counts. Counts left by a
    // deleted Table of the new name give way first (the primary key would
    // refuse the move); skipping taken ids keeps them from mattering.
    await tx`delete from series where starts_with(name, ${seriesKey(to, '')})`
    await tx`update series set name = ${seriesKey(to, '')} || substr(name, ${seriesKey(from, '').length + 1})
             where starts_with(name, ${seriesKey(from, '')})`
    for (const child of children)
      await tx.unsafe(`update ${child} set parenttype = $1 where parenttype = $2`, [to, from])
    for (const p of pointers)
      await tx.unsafe(`update ${relations.get(p.parent)} set ${quoteIdent(p.column_name)} = $1 where ${quoteIdent(p.column_name)} = $2`, [to, from])
    for (const [table, column] of TABLE_NAME_COLUMNS)
      await tx.unsafe(`update ${table} set ${quoteIdent(column)} = $1 where ${quoteIdent(column)} = $2`, [to, from])
    await renameInGlossary(tx, from, { table: from }, { table: to })
    await tx`update home_page_link set label = ${to} where link_to = ${to} and label = ${from}`
    // Recently opened: the entries keep pointing at the Table under its new name.
    for (const kind of ['row:', 'list:'])
      await tx`update user_event set ref_key = ${kind + to} || substr(ref_key, ${kind.length + from.length + 1}),
                 label = case when label = ${from} then ${to} else label end,
                 sub_label = case when sub_label = ${from} then ${to} else sub_label end
               where starts_with(ref_key, ${kind + from}) and substr(ref_key, ${kind.length + from.length + 1}, 1) in ('/', '?')`
    const [oldPath, newPath] = [`/featherbase/admin/table/${tableSlug(from)}`, `/featherbase/admin/table/${tableSlug(to)}`]
    await tx`update user_event set path = ${newPath} || substr(path, ${oldPath.length + 1})
             where path = ${oldPath} or starts_with(path, ${oldPath + '/'}) or starts_with(path, ${oldPath + '?'})`
    if (meta.owner_app)
      await tx`update installed_app set tables = (
          select jsonb_agg(case when value = to_jsonb(${from}::text) then to_jsonb(${to}::text) else value end order by ordinality)
          from jsonb_array_elements(tables) with ordinality)
        where name = ${meta.owner_app} and jsonb_typeof(tables) = 'array' and tables ? ${from}`
    // The old name's testimony, read back by getMeta: written last, so the
    // sweep above never moves it to the new name.
    await logAccess(user, 'rename_table', { table: from, row_id: to, required: true }, tx)
  })
  invalidateMeta()
  return getMeta(to)
}
