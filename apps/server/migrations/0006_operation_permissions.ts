// #462; number reserved on #566. One operation and explicit metadata Column
// references replace the flag/Tier permission representation. The baseline is
// immutable; both fresh installs and existing local databases take this step.
import { randomUUID } from 'node:crypto'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { createTable, updateTable } from '../src/table-engine'

const flags = {
  read: 'can_read', update: 'can_write', create: 'can_create', delete: 'can_delete',
  submit: 'can_submit', cancel: 'can_cancel', amend: 'can_amend',
} as const

export async function up() {
  const previous = await sql`select * from permission`
  await createTable({
    name: 'Permission Column', kind: 'sub_table', system: true,
    columns: [{ column_name: 'target_column', column_type: 'Reference', reference_table: 'Column', reqd: true }],
  })
  const permission = await getMeta('Permission')
  const retired = ['tier', 'own_rows_only', ...Object.values(flags)]
  await updateTable('Permission', {
    ...permission,
    columns: [
      ...permission.columns.filter((column) => !retired.includes(column.column_name)),
      { column_name: 'operation', column_type: 'Choice', choices: 'create\nread\nupdate\ndelete\nsubmit\ncancel\namend\napprove\nread_identifiers', reqd: true },
      { column_name: 'scope_mode', column_type: 'Choice', choices: 'all\ncreator', reqd: true },
      { column_name: 'parent_permission', column_type: 'Reference', reference_table: 'Permission' },
      { column_name: 'parent_column', column_type: 'Reference', reference_table: 'Column' },
      { column_name: 'requires_permission', column_type: 'Reference', reference_table: 'Permission' },
      { column_name: 'columns', column_type: 'Sub-table', row_table: 'Permission Column' },
    ],
  }, { remove_columns: retired })
  const role = await getMeta('Role')
  if (!role.columns.some((column) => column.column_name === 'description'))
    await updateTable('Role', { ...role, columns: [...role.columns, { column_name: 'description', column_type: 'Text' }] })

  // Keep each old contribution's provenance and creator restriction. In
  // particular, never combine a scoped basic grant with a wider restricted
  // grant into a single unrestricted permission.
  const replacements = new Map(previous.map((old) => [String(old.row_id), [] as string[]]))
  const bases: { id: string; old: (typeof previous)[number]; operation: string }[] = []
  const converted: typeof bases = []
  async function convert(old: (typeof previous)[number], operation: string, required?: string) {
    const ids = replacements.get(String(old.row_id))!
    const id = ids.length === 0 ? String(old.row_id) : randomUUID()
    ids.push(id)
    const meta = await getMeta(String(old.ref_table))
    await sql`insert into permission ${sql({
      row_id: id, created_by: old.created_by, created_at: old.created_at,
      updated_by: old.updated_by, updated_at: old.updated_at,
      ref_table: old.ref_table, role: old.role, owner_app: old.owner_app,
      operation, scope_mode: old.own_rows_only ? 'creator' : 'all', requires_permission: required ?? null,
    })}`
    if (['create', 'read', 'update'].includes(operation)) {
      const columns = meta.columns.filter((column) => old.tier === 'restricted' || column.tier === 'basic')
      for (const [position, column] of columns.entries()) {
        await sql`insert into featherbase.permission_column ${sql({
          row_id: randomUUID(), parent: id, parenttype: 'Permission', parentfield: 'columns',
          position: position + 1, target_column: column.row_id,
        })}`
      }
    }
    converted.push({ id, old, operation })
    return id
  }
  await sql`delete from permission`
  for (const old of previous.filter((row) => row.tier === 'basic')) {
    for (const [operation, flag] of Object.entries(flags)) {
      if (old[flag]) bases.push({ id: await convert(old, operation), old, operation })
    }
  }
  // Restricted grants previously supplied Columns, not independent Row
  // access. Preserve that dependency, including when the two roles differ.
  // A create grant previously also admitted the holder's writable Columns.
  for (const old of previous.filter((row) => row.tier === 'restricted')) {
    // Identifier sensitivity formerly used Person's restricted read level.
    // Keep it as a distinct read capability, never as identifier-edit power.
    if (old.ref_table === 'Person' && old.can_read) await convert(old, 'read_identifiers')
    for (const base of bases.filter((base) => base.old.ref_table === old.ref_table)) {
      const flag = flags[base.operation as keyof typeof flags]
      if (['read', 'update', 'create'].includes(base.operation) &&
        (old[flag] || (base.operation === 'create' && old.can_write)))
        await convert(old, base.operation, base.id)
    }
  }
  // Child values used to inherit their parent's effective levels. Materialise
  // that reach now, with the parent contribution as an explicit prerequisite.
  // An independent restricted child grant may extend a readable parent's child
  // Columns, but must retain its own role and app ownership.
  async function inherit(parentId: string, table: string, old: (typeof previous)[number], operation: string, path: Set<string>) {
    if (path.has(table)) throw new Error(`Cyclic legacy child metadata at ${table}`)
    const next = new Set([...path, table])
    const meta = await getMeta(table)
    for (const link of meta.columns.filter((column) => column.column_type === 'Sub-table' &&
      (old.tier === 'restricted' || column.tier === 'basic'))) {
      const child = await getMeta(link.row_table!)
      const flag = flags[operation as keyof typeof flags]
      const contributors = [old, ...previous.filter((row) => row.ref_table === child.name && row.tier === 'restricted' &&
        (row[flag] || (operation === 'create' && row.can_write)))]
      for (const contributor of contributors) {
        const id = randomUUID()
        replacements.get(String(contributor.row_id))!.push(id)
        await sql`insert into permission ${sql({
          row_id: id, ref_table: child.name, role: contributor.role, owner_app: contributor.owner_app,
          operation, scope_mode: contributor.own_rows_only ? 'creator' : 'all', parent_permission: parentId, parent_column: link.row_id,
          created_by: contributor.created_by, updated_by: contributor.updated_by,
          created_at: contributor.created_at, updated_at: contributor.updated_at,
        })}`
        const columns = child.columns.filter((column) => contributor.tier === 'restricted' || column.tier === 'basic')
        for (const [position, column] of columns.entries())
          await sql`insert into featherbase.permission_column ${sql({
            row_id: randomUUID(), parent: id, parenttype: 'Permission', parentfield: 'columns',
            position: position + 1, target_column: column.row_id,
          })}`
        await inherit(id, child.name, contributor, operation, next)
      }
    }
  }
  for (const grant of converted)
    if (['read', 'create', 'update'].includes(grant.operation))
      await inherit(grant.id, String(grant.old.ref_table), grant.old, grant.operation, new Set())
  // The install ledger owns every contribution made by an app, including
  // the additional operation Rows produced from its old multi-flag Row.
  for (const app of await sql`select name, perms from installed_app`) {
    if (!Array.isArray(app.perms)) continue
    const ids = (app.perms as string[]).flatMap((id) => replacements.get(id) ?? [id])
    await sql`update installed_app set perms = ${sql.json(ids)} where name = ${app.name}`
  }
  // Raw metadata/app teardown also removes grants. Database dependencies
  // keep their selections and inherited contributions from outliving them.
  await sql.unsafe(`
    alter table featherbase.permission_column
      add constraint permission_column_grant_fk foreign key (parent) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_column_metadata_fk foreign key (target_column) references featherbase.column_def(row_id) on delete cascade;
    alter table featherbase.permission
      add constraint permission_parent_fk foreign key (parent_permission) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_prerequisite_fk foreign key (requires_permission) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_parent_column_fk foreign key (parent_column) references featherbase.column_def(row_id) on delete cascade;
  `)
  // Native SQL cannot redact Columns or run app membership/availability
  // resolvers. Keep only complete unrestricted local-table reads here;
  // granular and app-owned access must use the public server operations.
  await sql.unsafe(`create or replace function featherbase.fc_has_read(tbl text) returns boolean
    language sql stable security definer set search_path to pg_catalog as $$
      with recursive required(table_name, path, ancestors) as (
        select tbl, array[]::text[], array[tbl]::text[]
        union all
        select c.row_table::text, r.path || c.row_id::text, r.ancestors || c.row_table::text
        from required r join featherbase.column_def c on c.parent = r.table_name
        where c.column_type = 'Sub-table' and not c.row_table = any(r.ancestors)
      ), eligible as (
        select p.* from featherbase.permission p
        where p.operation = 'read' and p.scope_mode = 'all' and p.owner_app is null
          and p.requires_permission is null and exists (
            select 1 from featherbase.has_role hr where hr.role = p.role
              and hr.parenttype in ('Person', 'Service Account') and hr.parent = featherbase.fc_session_user())
      ), granted(row_id, table_name, path, seen) as (
        select p.row_id, p.ref_table, array[]::text[], array[p.row_id::text] from eligible p
        where p.ref_table = tbl and p.parent_permission is null
        union all
        select p.row_id, p.ref_table, g.path || c.row_id::text, g.seen || p.row_id::text
        from granted g join eligible p on p.parent_permission = g.row_id
        join featherbase.column_def c on c.row_id = p.parent_column and c.parent = g.table_name
          and c.column_type = 'Sub-table' and c.row_table = p.ref_table
        join featherbase.permission_column selected on selected.parent = g.row_id and selected.target_column = c.row_id
        where not p.row_id::text = any(g.seen)
      )
      select exists (select 1 from featherbase.table_def where name = tbl)
        and not exists (select 1 from required r join featherbase.table_def t on t.name = r.table_name where t.owner_app is not null)
        and (featherbase.fc_session_user() = 'Administrator' or (
          (exists (select 1 from featherbase.person where row_id = featherbase.fc_session_user() and enabled)
            or exists (select 1 from featherbase.service_account where row_id = featherbase.fc_session_user() and enabled))
          and not exists (select 1 from required r join featherbase.table_def t on t.name = r.table_name where t.system or t.system_written)
          and not exists (select 1 from featherbase.data_scope where person = featherbase.fc_session_user() or service_account = featherbase.fc_session_user())
          and exists (select 1 from granted where path = array[]::text[])
          and not exists (select 1 from required r join featherbase.column_def c on c.parent = r.table_name
            where c.column_type = 'Sub-table' and c.row_table = any(r.ancestors))
          and not exists (
            select 1 from required r join featherbase.column_def c on c.parent = r.table_name
            where not exists (select 1 from granted g join featherbase.permission_column pc on pc.parent = g.row_id
              where g.path = r.path and g.table_name = r.table_name and pc.target_column = c.row_id))
        ))
    $$`)
  // Drop only after conversion and the dependent function have changed.
  for (const column of retired) await sql`alter table permission drop column ${sql(column)}`
}
