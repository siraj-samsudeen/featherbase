// #80: Home Pages — Frappe-style curated navigation. The Admin sidebar lists
// Home Pages (one per user module + a seeded System page); each page renders
// grouped link cards from its `links` sub-table. This module owns the two
// server-side halves of that:
//
//  1. getVisibleHomePages(user) — the ONLY thing the sidebar consumes. Role
//     visibility and link permission-filtering are computed here, server-side,
//     so the Admin UI stays generic (architecture invariant #3).
//  2. ensureHomePageForTable(table, module) — auto-membership. Called from
//     POST /api/doctype and from app installs so a table a user builds NEVER
//     vanishes from navigation: its module's home page is created on demand
//     and the table's link appended. Deliberately NOT called inside
//     createTable itself — mid-chain migrations (0037–0057) create engine
//     tables before the `system` flag exists and must not seed spurious pages.
//
// Role-based visibility is PRESENTATION/NAVIGATION SCOPING ONLY, not a
// security boundary: a page with an empty roles list is visible to everyone,
// otherwise only to holders of one of those roles, and Administrator always
// sees every page. Table ACCESS is still enforced by Permission rows exactly
// as before — hiding a link never grants or revokes anything.
import { randomUUID } from 'node:crypto'
import { sql } from './db'
import { getRoles, permissionScope } from './permissions'

// Legacy UI-027 shortcut shape, kept working: [{ label, type, link_to }].
export interface HomePageShortcut {
  label: string
  type?: string // doctype | report | dashboard | url
  link_to: string
}

export interface HomePageCard {
  label: string | null
  links: { label: string; link_to: string }[]
}

export interface VisibleHomePage {
  name: string
  label: string
  icon: string | null
  module: string | null
  cards: HomePageCard[]
  shortcuts: HomePageShortcut[]
}

// Which page a module's tables land on. `Core` is special: user tables filed
// under the default module (created before the Table Builder grew its module
// field, e.g. a pre-#74 production table) go on a plain "Home" page rather
// than a page literally named Core among the platform vocabulary.
export function homePageForModule(module: string): { name: string; label: string } {
  if (module === 'Core') return { name: 'home', label: 'Home' }
  const slug = module
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return { name: slug || 'home', label: module }
}

// Find the module's home page, creating it on demand. Direct SQL on purpose:
// these are engine-seeded navigation rows (the 0005 core-seeds discipline),
// not user mutations — nothing in the save lifecycle applies to them.
export async function ensureModuleHomePage(module: string): Promise<string> {
  const [existing] = await sql`
    select row_id from home_page where module = ${module} order by row_id limit 1`
  if (existing) return existing.row_id as string
  const page = homePageForModule(module)
  // The slug may collide with an unrelated page (e.g. a user module named
  // "System" vs the seeded 'system' page, which carries no module) — probe
  // for a free name rather than adopting a page that isn't this module's.
  let name = page.name
  for (let i = 2; ; i++) {
    const [taken] = await sql`select 1 from home_page where row_id = ${name}`
    if (!taken) break
    name = `${page.name}-${i}`
  }
  // Module pages sort between the "Home" page (0) and the System page (100).
  await sql`insert into home_page ${sql({
    name,
    label: page.label,
    module,
    sequence: module === 'Core' ? 0 : 50,
  })}`
  return name
}

// Append a link card entry for `table` on its module's home page (created on
// demand). Idempotent: an existing link to the table is left alone.
export async function ensureHomePageForTable(table: string, module: string): Promise<void> {
  const pageName = await ensureModuleHomePage(module)
  const [linked] = await sql`
    select 1 from home_page_link
    where parent = ${pageName} and parenttype = 'Home Page' and link_to = ${table}`
  if (linked) return
  const [{ next }] = await sql`
    select coalesce(max(position), 0) + 1 as next from home_page_link
    where parent = ${pageName} and parenttype = 'Home Page'`
  await sql`insert into home_page_link ${sql({
    name: randomUUID(),
    parent: pageName,
    parenttype: 'Home Page',
    parentfield: 'links',
    position: Number(next),
    label: table,
    type: 'Link',
    link_to: table,
  })}`
}

function parseShortcuts(raw: unknown): HomePageShortcut[] {
  let value = raw
  if (typeof value === 'string' && value.trim()) {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.filter(
    (s): s is HomePageShortcut =>
      typeof s === 'object' && s !== null && typeof (s as HomePageShortcut).label === 'string',
  )
}

// The caller's visible Home Pages with their permission-filtered card links —
// the one endpoint the sidebar (and the page view) consume.
export async function getVisibleHomePages(user: string): Promise<VisibleHomePage[]> {
  const pages = await sql`
    select row_id, label, icon, module, shortcuts from home_page
    order by coalesce(sequence, 50) asc, label asc, row_id asc`
  if (pages.length === 0) return []

  const isAdmin = user === 'Administrator'
  const roles = isAdmin ? [] : await getRoles(user)

  const pageRoles = await sql`
    select parent, role from home_page_role where parenttype = 'Home Page'`
  const rolesByPage = new Map<string, string[]>()
  for (const r of pageRoles) {
    const list = rolesByPage.get(r.parent as string) ?? []
    list.push(r.role as string)
    rolesByPage.set(r.parent as string, list)
  }

  const links = await sql`
    select parent, label, type, link_to from home_page_link
    where parenttype = 'Home Page'
    order by parent, position asc, row_id asc`
  const linksByPage = new Map<string, { label: string; type: string; link_to: string | null }[]>()
  for (const l of links) {
    const list = linksByPage.get(l.parent as string) ?? []
    list.push({
      label: (l.label as string) ?? '',
      type: (l.type as string) ?? 'Link',
      link_to: l.link_to as string | null,
    })
    linksByPage.set(l.parent as string, list)
  }

  // A link to a table that no longer exists (dropped by an app uninstall)
  // must not break the page — it is filtered out here. Sub-tables have no
  // list view to open, so links to them are dropped too.
  const targets = new Set<string>()
  for (const list of linksByPage.values())
    for (const l of list) if (l.link_to) targets.add(l.link_to)
  for (const p of pages)
    for (const s of parseShortcuts(p.shortcuts))
      if (!s.type || s.type === 'doctype') targets.add(s.link_to)
  const existing = new Set<string>()
  if (targets.size > 0) {
    const rows = await sql`
      select name from table_def where name in ${sql([...targets])} and kind != 'sub_table'`
    for (const r of rows) existing.add(r.name as string)
  }

  // Mirror Frappe's is_item_allowed: a user who cannot read a Table does not
  // see its link. Cached per table — the same target appears on many pages.
  const readable = new Map<string, boolean>()
  async function canRead(table: string): Promise<boolean> {
    if (!existing.has(table)) return false
    if (isAdmin) return true
    let ok = readable.get(table)
    if (ok === undefined) {
      ok = (await permissionScope(user, table, 'read')) !== 'none'
      readable.set(table, ok)
    }
    return ok
  }

  const out: VisibleHomePage[] = []
  for (const p of pages) {
    const required = rolesByPage.get(p.name as string) ?? []
    const visible = isAdmin || required.length === 0 || required.some((r) => roles.includes(r))
    if (!visible) continue

    // Fold the flat, ordered link rows into cards: a Card Break starts a new
    // card; links before the first break form an unlabeled card.
    const cards: HomePageCard[] = []
    let current: HomePageCard | null = null
    for (const l of linksByPage.get(p.name as string) ?? []) {
      if (l.type === 'Card Break') {
        current = { label: l.label || null, links: [] }
        cards.push(current)
        continue
      }
      if (!l.link_to || !(await canRead(l.link_to))) continue
      if (!current) {
        current = { label: null, links: [] }
        cards.push(current)
      }
      current.links.push({ label: l.label || l.link_to, link_to: l.link_to })
    }

    // Legacy shortcuts stay working; table shortcuts get the same read
    // filter, report/dashboard/url shortcuts pass through untouched.
    const shortcuts: HomePageShortcut[] = []
    for (const s of parseShortcuts(p.shortcuts)) {
      if (!s.type || s.type === 'doctype') {
        if (!(await canRead(s.link_to))) continue
      }
      shortcuts.push(s)
    }

    out.push({
      name: p.name as string,
      label: (p.label as string) || (p.name as string),
      icon: (p.icon as string) ?? null,
      module: (p.module as string) ?? null,
      cards: cards.filter((c) => c.links.length > 0),
      shortcuts,
    })
  }
  return out
}
