// #80: Home Pages — curated Frappe-style navigation. Two halves, both
// idempotent, so fresh and upgraded databases converge (the 0055/0057
// discipline):
//
//  A. CONVERGE the schema. A fresh install already created the final 'Home
//     Page' shape in (the rewritten) 0036 — every step here is
//     existence-checked and becomes a no-op. An upgraded database still has
//     the old three-column 'Workspace' table: rename it (metadata row,
//     sub-table parents, physical table, RLS policy, row references), create
//     the 'Home Page Link' / 'Home Page Role' sub-tables, add the
//     module/sequence/links/roles columns, and align column positions.
//
//  B. SEED navigation. One 'System' home page whose cards group every
//     platform (system = true) table sensibly, then a sweep that gives every
//     existing user table a link on its module's home page — user tables
//     filed under the default 'Core' module (created before the Table
//     Builder grew its module field) land on a plain 'Home' page.
import { randomUUID } from 'node:crypto'
import { sql } from '../src/db'
import { createTable, pgType, tableName } from '../src/doctype-engine'
import { invalidateMeta } from '../src/meta'
import { ensureHomePageForTable } from '../src/home-pages'
import {
  HOME_PAGE_COLUMNS,
  HOME_PAGE_LINK_DEF,
  HOME_PAGE_ROLE_DEF,
} from './0036_workspace'

// ---- A. converge the schema ------------------------------------------------

async function renameWorkspaceTable() {
  const [ws] = await sql`select 1 from table_def where name = 'Workspace'`
  if (!ws) return
  await sql.begin(async (tx) => {
    // column_def.parent references table_def(name), so the row is copied
    // under the new name first, children re-pointed, then the old row
    // removed — a plain UPDATE would trip the FK in either order.
    await tx`
      insert into table_def (name, module, kind, is_submittable, id_pattern,
        title_column, sort_column, sort_order, track_changes, description,
        custom, system)
      select 'Home Page', module, kind, is_submittable, id_pattern,
        title_column, sort_column, sort_order, track_changes, description,
        custom, system
      from table_def where name = 'Workspace'`
    await tx`update column_def set parent = 'Home Page' where parent = 'Workspace'`
    await tx`delete from table_def where name = 'Workspace'`
    await tx.unsafe(`alter table workspace rename to home_page`)
    // The SELECT policy's predicate still names 'Workspace' — recreate it.
    await tx.unsafe(`drop policy if exists fc_select on home_page`)
    await tx.unsafe(
      `create policy fc_select on home_page for select to desk_client using (fc_has_read('Home Page'))`,
    )
    // Rows elsewhere that point at the Table by name: every table with the
    // canonical ref_table column (permission, tag_link, comment, todo, …)
    // plus the three 0055 spellings that kept their own names. (In practice
    // these match nothing — no engine row targets Workspace — but an
    // upgrade must not strand a stray one.)
    await tx.unsafe(`
      do $$
      declare r record;
      begin
        for r in select table_name from information_schema.columns
                 where table_schema = 'public' and column_name = 'ref_table'
                   and table_name != 'column_def'
        loop
          execute format(
            'update %I set ref_table = ''Home Page'' where ref_table = ''Workspace''',
            r.table_name);
        end loop;
      end $$`)
    await tx`update share set share_table = 'Home Page' where share_table = 'Workspace'`
    await tx`update data_scope set allow_table = 'Home Page' where allow_table = 'Workspace'`
    await tx`update user_settings set table_name = 'Home Page' where table_name = 'Workspace'`
    await tx`update column_def set reference_table = 'Home Page' where reference_table = 'Workspace'`
  })
  invalidateMeta()
}

async function ensureSubTables() {
  for (const def of [HOME_PAGE_LINK_DEF, HOME_PAGE_ROLE_DEF]) {
    const [exists] = await sql`select 1 from table_def where name = ${def.name}`
    if (!exists) await createTable(def)
  }
}

async function ensureHomePageColumns() {
  const table = tableName('Home Page')
  for (const col of HOME_PAGE_COLUMNS) {
    const [exists] = await sql`
      select 1 from column_def where parent = 'Home Page' and column_name = ${col.column_name}`
    if (exists) continue
    await sql`insert into column_def ${sql({
      parent: 'Home Page',
      column_name: col.column_name,
      label: 'label' in col && col.label ? col.label : col.column_name,
      column_type: col.column_type,
      row_table: 'row_table' in col ? col.row_table : null,
      reqd: 'reqd' in col ? Boolean(col.reqd) : false,
      in_list_view: 'in_list_view' in col ? Boolean(col.in_list_view) : false,
      position: 0, // aligned below
    })}`
    const type = pgType(col.column_type)
    if (type)
      await sql.unsafe(
        `alter table "${table}" add column if not exists "${col.column_name}" ${type}`,
      )
  }
  // Both paths end with identical column positions (fresh order is the
  // canonical one; an upgraded table had shortcuts before module/sequence).
  for (const [i, col] of HOME_PAGE_COLUMNS.entries()) {
    await sql`
      update column_def set position = ${i + 1}
      where parent = 'Home Page' and column_name = ${col.column_name}`
  }
  invalidateMeta('Home Page')
}

// ---- B. seed navigation ----------------------------------------------------

// How the System page's cards group the platform tables. Order matters (it
// is the card order); any system table not named here lands under Platform.
const SYSTEM_CARDS: [string, string[]][] = [
  ['Users & Access', ['User', 'Role', 'Permission', 'Share', 'Data Scope']],
  [
    'Automation',
    ['Workflow', 'Workflow Action', 'Server Script', 'Client Script', 'Assignment Rule', 'Webhook', 'Service Level Agreement', 'ToDo'],
  ],
  ['Email', ['Email Account', 'Email Queue', 'Email Rule', 'Email Sink', 'Auto Email Report', 'Notification Log']],
  ['Reports & Dashboards', ['Report', 'Dashboard', 'Print Format', 'Letter Head']],
  ['Website', ['Web Page', 'Web Form']],
  ['Platform', []], // catch-all, filled from table_def below
]

async function seedSystemPage() {
  const [page] = await sql`select 1 from home_page where name = 'system'`
  if (!page)
    await sql`insert into home_page ${sql({
      name: 'system',
      label: 'System',
      sequence: 100,
    })}`
  // Only ever seed links onto an empty page — re-running the migration (or
  // an admin who curated the page) must not duplicate or fight the rows.
  const [{ n }] = await sql`
    select count(*)::int as n from home_page_link
    where parent = 'system' and parenttype = 'Home Page'`
  if (Number(n) > 0) return

  const systemTables = await sql`
    select name from table_def
    where system = true and kind in ('table', 'settings')
    order by name asc`
  const names = systemTables.map((r) => r.name as string)
  const placed = new Set(SYSTEM_CARDS.flatMap(([, tables]) => tables))
  const cards: [string, string[]][] = SYSTEM_CARDS.map(([label, tables]) => [
    label,
    label === 'Platform'
      ? names.filter((t) => !placed.has(t))
      : tables.filter((t) => names.includes(t)),
  ])

  let position = 0
  for (const [label, tables] of cards) {
    if (tables.length === 0) continue
    const rows = [
      { label, type: 'Card Break', link_to: null as string | null },
      ...tables.map((t) => ({ label: t, type: 'Link', link_to: t as string | null })),
    ]
    for (const row of rows) {
      position += 1
      await sql`insert into home_page_link ${sql({
        name: randomUUID(),
        parent: 'system',
        parenttype: 'Home Page',
        parentfield: 'links',
        position,
        ...row,
      })}`
    }
  }
}

async function sweepUserTables() {
  const userTables = await sql`
    select name, module from table_def
    where system = false and kind in ('table', 'settings')
    order by name asc`
  for (const t of userTables)
    await ensureHomePageForTable(t.name as string, (t.module as string) || 'Core')
}

export async function up() {
  await renameWorkspaceTable()
  await ensureSubTables()
  await ensureHomePageColumns()
  await seedSystemPage()
  await sweepUserTables()
}
