// #917 (piece A of #462). One Permission row per operation replaces the
// flag/level representation; which Columns a grant reaches is its column
// rule. Every converted grant reaches exactly what it reached before, now and
// after later metadata changes: a basic-level grant keeps following the
// basic-level Columns. The baseline is immutable; fresh installs and existing
// databases both take this step.
import { randomUUID } from 'node:crypto'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { createTable, updateTable } from '../src/table-engine'
import { readLegacyPermission } from '../src/app-permission-format'

const flags = {
  read: 'can_read', update: 'can_write', create: 'can_create', delete: 'can_delete',
  submit: 'can_submit', cancel: 'can_cancel', amend: 'can_amend',
} as const
const COLUMN_OPERATIONS = ['create', 'read', 'update']

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
      { column_name: 'operation', column_type: 'Choice', reqd: true, in_list_view: true,
        choices: 'create\nread\nupdate\ndelete\nsubmit\ncancel\namend\nread_identifiers',
        choice_labels: { create: 'Create', read: 'Read', update: 'Update', delete: 'Delete', submit: 'Submit',
          cancel: 'Cancel', amend: 'Amend', read_identifiers: 'Read identifiers' } },
      { column_name: 'scope_mode', label: 'Rows', column_type: 'Choice', reqd: true, in_list_view: true, default_value: 'all',
        choices: 'all\ncreator', choice_labels: { all: 'All rows', creator: 'Rows the person created' } },
      { column_name: 'column_rule', label: 'Columns', column_type: 'Choice', reqd: true, in_list_view: true, default_value: 'basic',
        choices: 'basic\nevery\nlisted',
        choice_labels: { basic: 'Every basic-level column', every: 'Every column', listed: 'Only the columns listed' } },
      { column_name: 'parent_permission', column_type: 'Reference', reference_table: 'Permission' },
      { column_name: 'parent_column', column_type: 'Reference', reference_table: 'Column' },
      { column_name: 'requires_permission', column_type: 'Reference', reference_table: 'Permission' },
      { column_name: 'columns', label: 'Listed columns', column_type: 'Sub-table', row_table: 'Permission Column' },
    ],
  }, { remove_columns: retired })

  // Keep each old contribution's provenance and creator restriction. A
  // restricted-level Row granted Columns, not Row access: it becomes a grant
  // of every Column that requires the matching basic-level grant, so a scoped
  // basic grant is never combined with a wider restricted one.
  const replacements = new Map(previous.map((old) => [String(old.row_id), [] as string[]]))
  async function convert(old: (typeof previous)[number], operation: string, rule: 'basic' | 'every', required?: string) {
    const ids = replacements.get(String(old.row_id))!
    const id = ids.length === 0 ? String(old.row_id) : randomUUID()
    ids.push(id)
    await sql`insert into permission ${sql({
      row_id: id, created_by: old.created_by, created_at: old.created_at,
      updated_by: old.updated_by, updated_at: old.updated_at,
      ref_table: old.ref_table, role: old.role, owner_app: old.owner_app, operation,
      scope_mode: old.own_rows_only ? 'creator' : 'all', column_rule: rule, requires_permission: required ?? null,
    })}`
    return id
  }
  await sql`delete from permission`
  const bases: { id: string; old: (typeof previous)[number]; operation: string }[] = []
  for (const old of previous.filter((row) => (row.tier ?? 'basic') === 'basic')) {
    for (const [operation, flag] of Object.entries(flags))
      if (old[flag]) bases.push({ id: await convert(old, operation, 'basic'), old, operation })
  }
  // A line-item Table cannot be saved directly, and what a new line may hold
  // came from the parent's reach and the line items' edit flag, never their
  // create flag: that flag alone must not become Column reach.
  const lineItemTables = new Set((await sql`select name from table_def where kind = 'sub_table'`).map((row) => String(row.name)))
  for (const old of previous.filter((row) => row.tier === 'restricted')) {
    // Identifier sensitivity formerly used Person's restricted read level.
    // Keep it as a distinct read capability, never as identifier-edit power.
    if (old.ref_table === 'Person' && old.can_read) await convert(old, 'read_identifiers', 'every')
    // A create grant previously also admitted the holder's writable Columns.
    for (const base of bases.filter((base) => base.old.ref_table === old.ref_table && COLUMN_OPERATIONS.includes(base.operation))) {
      if (base.operation === 'create' && lineItemTables.has(String(old.ref_table))) continue
      const flag = flags[base.operation as keyof typeof flags]
      if (old[flag] || (base.operation === 'create' && old.can_write)) await convert(old, base.operation, 'every', base.id)
    }
  }
  // A restricted row on a line-item Table widened those line items' Columns
  // wherever the parent row was reached; it needed no basic grant of its own
  // Table. Keep that as a line-item grant under each basic parent grant of
  // the same operation that reaches the link, with the restricted row's role.
  const links = await sql`select c.row_id, c.parent, c.row_table, coalesce(c.tier, 'basic') as tier
    from column_def c where c.column_type = 'Sub-table'`
  for (const old of previous.filter((row) => row.tier === 'restricted')) {
    for (const link of links.filter((link) => link.row_table === old.ref_table)) {
      for (const base of bases.filter((base) => base.old.ref_table === link.parent && COLUMN_OPERATIONS.includes(base.operation))) {
        // Editing line items reaches a new line's Columns; their create flag does not.
        if (!old[base.operation === 'create' ? 'can_write' : flags[base.operation as keyof typeof flags]]) continue
        const id = randomUUID()
        replacements.get(String(old.row_id))!.push(id)
        await sql`insert into permission ${sql({
          row_id: id, created_by: old.created_by, created_at: old.created_at,
          updated_by: old.updated_by, updated_at: old.updated_at,
          ref_table: old.ref_table, role: old.role, owner_app: old.owner_app, operation: base.operation,
          scope_mode: old.own_rows_only ? 'creator' : 'all', column_rule: 'every',
          parent_permission: base.id, parent_column: link.row_id,
        })}`
      }
    }
  }
  // The install ledger owns every contribution made by an app, including
  // the additional operation Rows produced from its old multi-flag Row.
  for (const app of await sql`select name, perms, manifest from installed_app`) {
    const perms = Array.isArray(app.perms) ? (app.perms as string[]).flatMap((id) => replacements.get(id) ?? [id]) : app.perms
    // The recorded declaration is read the way its manifest is now read, so
    // the installed record and the shipped artifact still compare equal. The
    // artifact's files and digest are untouched.
    const manifest = app.manifest && Array.isArray(app.manifest.permissions)
      ? { ...app.manifest, permissions: app.manifest.permissions.map(readLegacyPermission) }
      : app.manifest
    await sql`update installed_app set perms = ${sql.json(perms as never)}, manifest = ${sql.json(manifest as never)} where name = ${app.name}`
  }
  // Raw metadata/app teardown also removes grants. Database dependencies
  // keep their selections and dependent contributions from outliving them.
  await sql.unsafe(`
    alter table featherbase.permission_column
      add constraint permission_column_grant_fk foreign key (parent) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_column_metadata_fk foreign key (target_column) references featherbase.column_def(row_id) on delete cascade;
    alter table featherbase.permission
      add constraint permission_parent_fk foreign key (parent_permission) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_prerequisite_fk foreign key (requires_permission) references featherbase.permission(row_id) on delete cascade,
      add constraint permission_parent_column_fk foreign key (parent_column) references featherbase.column_def(row_id) on delete cascade;
  `)
  // Native SQL cannot hide Columns, narrow by Data Scope or creator, or know
  // whether an app is available. It reads a Table (and its line items) only
  // through a directly held, unscoped, platform read grant whose rule reaches
  // every Column there. Anything finer uses the server's read path.
  await sql.unsafe(`create or replace function featherbase.fc_has_read(tbl text) returns boolean
    language sql stable security definer set search_path to pg_catalog as $$
      with recursive required(table_name, ancestors) as (
        select tbl, array[tbl]::text[]
        union all
        select c.row_table::text, r.ancestors || c.row_table::text
        from required r join featherbase.column_def c on c.parent = r.table_name
        where c.column_type = 'Sub-table' and not c.row_table = any(r.ancestors)
      )
      select featherbase.fc_session_user() = 'Administrator' or (
        exists (select 1 from featherbase.table_def where name = tbl)
        and (exists (select 1 from featherbase.person where row_id = featherbase.fc_session_user() and enabled)
          or exists (select 1 from featherbase.service_account where row_id = featherbase.fc_session_user() and enabled))
        and not exists (select 1 from required r join featherbase.table_def t on t.name = r.table_name
          where t.owner_app is not null or t.system or t.system_written)
        and not exists (select 1 from featherbase.data_scope
          where person = featherbase.fc_session_user() or service_account = featherbase.fc_session_user())
        and not exists (select 1 from required r join featherbase.column_def c on c.parent = r.table_name
          where c.column_type = 'Sub-table' and c.row_table = any(r.ancestors))
        and exists (
          select 1 from featherbase.permission p
          join featherbase.has_role hr on hr.role = p.role
            and hr.parenttype in ('Person', 'Service Account') and hr.parent = featherbase.fc_session_user()
          where p.ref_table = tbl and p.operation = 'read' and p.scope_mode = 'all' and p.owner_app is null
            and p.parent_permission is null and p.requires_permission is null
            and (p.column_rule = 'every' or (p.column_rule = 'basic' and not exists (
              select 1 from required r join featherbase.column_def c on c.parent = r.table_name
              where coalesce(c.tier, 'basic') <> 'basic'))))
      )
    $$`)
  // Drop only after conversion and the dependent function have changed.
  for (const column of retired) await sql`alter table permission drop column if exists ${sql(column)}`
}
