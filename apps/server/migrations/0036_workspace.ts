// UI-027 / #80: Home Page (formerly "Workspace") — a curated module landing
// page. Navigation only: the `links` sub-table holds grouped link cards
// (Card Break rows start a card, Link rows point at Tables), the `roles`
// sub-table scopes who SEES the page (presentation only — table access is
// still enforced by Permission rows), `module`/`sequence` file and order it,
// and the legacy JSON `shortcuts` column keeps pre-#80 pages working.
//
// The FILENAME stays 0036_workspace.ts on purpose: the runner records
// migrations by filename, and every upgraded database has this one applied —
// those databases still hold the old three-column `Workspace` table and
// converge through 0060_home_pages.ts instead. A fresh install creates the
// final shape right here (the 0055 rewrite discipline), and 0060's rename
// half is then a no-op.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

// Exported so 0060 can create the identical sub-tables/columns on upgraded
// databases without a second copy of the definitions.
export const HOME_PAGE_LINK_DEF = {
  name: 'Home Page Link',
  module: 'Core',
  kind: 'sub_table' as const,
  system: true,
  columns: [
    { column_name: 'label', column_type: 'Data' as const, reqd: true, in_list_view: true },
    {
      column_name: 'type',
      column_type: 'Choice' as const,
      choices: 'Link\nCard Break',
      reqd: true,
      in_list_view: true,
    },
    {
      column_name: 'link_to',
      label: 'Link To',
      column_type: 'Reference' as const,
      reference_table: 'Table',
      in_list_view: true,
    },
  ],
}

export const HOME_PAGE_ROLE_DEF = {
  name: 'Home Page Role',
  module: 'Core',
  kind: 'sub_table' as const,
  system: true,
  columns: [
    {
      column_name: 'role',
      column_type: 'Reference' as const,
      reference_table: 'Role',
      reqd: true,
      in_list_view: true,
    },
  ],
}

// Home Page's own columns, in canonical order. 0060 aligns upgraded
// databases to these exact positions so both paths end schema-identical.
export const HOME_PAGE_COLUMNS = [
  { column_name: 'label', column_type: 'Data' as const, reqd: true, in_list_view: true },
  { column_name: 'icon', column_type: 'Data' as const },
  { column_name: 'module', column_type: 'Data' as const, in_list_view: true },
  { column_name: 'sequence', column_type: 'Int' as const },
  {
    column_name: 'links',
    column_type: 'Sub-table' as const,
    row_table: 'Home Page Link',
  },
  {
    column_name: 'roles',
    column_type: 'Sub-table' as const,
    row_table: 'Home Page Role',
  },
  // Legacy UI-027 shape, still rendered:
  // [{ label, type: 'doctype'|'report'|'dashboard'|'url', link_to }]
  { column_name: 'shortcuts', column_type: 'JSON' as const },
]

export async function up() {
  const [exists] = await sql`
    select 1 from table_def where name in ('Home Page', 'Workspace')`
  if (exists) return
  await createTable(HOME_PAGE_LINK_DEF)
  await createTable(HOME_PAGE_ROLE_DEF)
  await createTable({
    name: 'Home Page',
    module: 'Core',
    id_pattern: 'prompt',
    system: true,
    columns: HOME_PAGE_COLUMNS,
  })
}
