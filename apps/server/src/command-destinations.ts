import { ACCOUNT_SIGN_IN_METHODS_PATH, ADMIN_PAGES, INTERIM_APPS, type CommandDestinations, type CommandPageDestination } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta } from './meta'
import { getRoles, permissionScope, tableAccessFor } from './permissions'
import { getVisibleHomePages } from './home-pages'
import { appCatalog } from './runtime-packages'
import { getList } from './query'
import { scriptReportMeta } from './script-report'
import { VIEWER_ROLE } from './sales-target'
import { assertAppAvailable } from './app-lifecycle'

// Only expected access/availability refusals omit a destination; genuine
// database/programming failures must not masquerade as a complete inventory.
function unavailable(error: unknown): boolean {
  return error instanceof AppError && ['PermissionError', 'NotFoundError', 'ConflictError'].includes(error.type)
}

export async function commandDestinations(user: string): Promise<CommandDestinations> {
  const roles = await getRoles(user)
  const manage = user === 'Administrator' || roles.includes('System Manager')
  if (!manage && !(await tableAccessFor(user, roles)).admin)
    throw new AppError('PermissionError', 'Admin access required')

  const tables: CommandDestinations['tables'] = []
  const definitions = await sql<{ name: string; owner_app: string | null }[]>`select name, owner_app from table_def where kind != 'sub_table' order by name`
  for (const { name, owner_app } of definitions) {
    if ((await permissionScope(user, name, 'read')) === 'none') continue
    try {
      if (owner_app) await assertAppAvailable(`${owner_app}.__inventory`)
      // getMeta checks app availability even for privileged callers and only
      // reads local metadata/source configuration, never foreign row data.
      const meta = await getMeta(name)
      if (meta.kind === 'sub_table') continue
      tables.push({
        row_id: name, label: meta.label || name, module: meta.module,
        system: Boolean(meta.system), system_written: Boolean(meta.system_written), kind: meta.kind,
        can_create: meta.kind === 'table' && !meta.system_written && meta.source_writable !== false &&
          (await permissionScope(user, name, 'create')) !== 'none',
      })
    } catch (error) {
      if (!unavailable(error)) throw error
    }
  }

  const pages = new Map<string, CommandPageDestination>()
  function add(label: string, href: string, kind: string) {
    const key = href.replace(/\/$/, '')
    const existing = pages.get(key)
    if (existing) {
      if (existing.label !== label) existing.aliases = [...new Set([...(existing.aliases ?? []), label])]
    } else pages.set(key, { label, href, kind })
  }
  const readable = new Set(tables.map((table) => table.row_id))
  for (const page of ADMIN_PAGES) {
    if (page.manage && !manage || page.administrator && user !== 'Administrator') continue
    if (page.slug === 'find-person' && (!readable.has('Person') || !readable.has('Identifier System'))) continue
    add(page.title, `/featherbase/admin/${page.slug}`, 'Page')
  }
  add('Sign-in methods', ACCOUNT_SIGN_IN_METHODS_PATH, 'Account')
  if (roles.includes(VIEWER_ROLE)) add(INTERIM_APPS.feather_dash.title, INTERIM_APPS.feather_dash.root, 'Report')
  for (const page of await getVisibleHomePages(user))
    add(page.label || page.row_id, `/featherbase/admin/home/${encodeURIComponent(page.row_id)}`, 'Home Page')
  for (const app of await appCatalog(user)) {
    add(app.title, app.href, 'App')
    for (const tab of app.tabs ?? []) add(`${app.title} — ${tab.label}`, tab.href, 'App tab')
  }

  // Named resources use the normal list read: own rows, Data Scopes and
  // column tiers remain enforced. Page deterministically through all rows.
  async function named(table: string, fields: string[], visit: (row: Record<string, unknown>) => Promise<void> | void) {
    if (!readable.has(table)) return
    try {
      for (let offset = 0; ; offset += 500) {
        const result = await getList(table, { fields, order_by: 'row_id asc', limit_start: offset, limit_page_length: 500 }, user)
        for (const row of result.data) await visit(row)
        if (offset + result.data.length >= result.total || result.data.length === 0) break
      }
    } catch (error) {
      if (!unavailable(error)) throw error
    }
  }
  await named('Dashboard', ['row_id'], (row) => {
    add(String(row.row_id), `/featherbase/admin/dashboard/${encodeURIComponent(String(row.row_id))}`, 'Dashboard')
  })
  await named('Report', ['row_id', 'report_type'], async (row) => {
    if (row.report_type !== 'Script Report') return
    try {
      await scriptReportMeta(String(row.row_id), user)
      add(String(row.row_id), `/featherbase/admin/script-report/${encodeURIComponent(String(row.row_id))}`, 'Report')
    } catch (error) {
      if (!unavailable(error) && !(error instanceof AppError && error.type === 'ValidationError')) throw error
    }
  })
  if (manage) await named('Data Source', ['row_id'], (row) => {
    add(String(row.row_id), `/featherbase/admin/source/${encodeURIComponent(String(row.row_id))}`, 'Data Source')
  })
  await named('Web Form', ['row_id', 'title', 'route', 'published'], (row) => {
    if (row.published && typeof row.route === 'string' && row.route)
      add(String(row.title || row.row_id), `/featherbase/form/${encodeURIComponent(row.route)}`, 'Web Form')
  })
  return { tables, pages: [...pages.values()] }
}
