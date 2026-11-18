// #1280: what a Site is, and whether it is an open store. One home for the rule, read alike by
// the scope provider, the app's reads and the comparison: one path reading more than another
// would make them disagree (#1277, Codex round 9).
import { checked, text } from './values.ts'

type Row = Record<string, unknown>

/** What a Site can be (owner, 18-Nov-2026). Group is virtual: no address, nothing physical. */
export const SITE_KINDS = ['Store', 'Warehouse', 'Head Office', 'Group', 'Collection Centre', 'Central Kitchen', 'Exhibition'] as const

/** The Site columns openStore reads beyond is_store. Site is the instance's own Table, and an
 *  instance may not have them yet: they are read only where it has them. */
export const SITE_KIND_FIELDS = ['site_kind', 'status']

/**
 * Whether a Site row is an open store (owner, 18-Nov-2026): with a status of Planned or Closed, never; with a site_kind,
 * only Store (any other kind, now or added later, is not); with neither, its is_store flag. Empty means not set.
 */
export function openStore(row: Row): boolean {
  if (['planned', 'closed'].includes(text(row.status).toLowerCase())) return false
  const kind = text(row.site_kind)
  return kind ? kind === 'Store' : checked(row.is_store)
}

/** The Site columns to read for openStore: site_kind and status too where the instance's Site has them. */
export async function siteStoreFields(hasKind: boolean | Promise<boolean>): Promise<string[]> {
  return (await hasKind) ? ['is_store', ...SITE_KIND_FIELDS] : ['is_store']
}
