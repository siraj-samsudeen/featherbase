import type { PageStatus } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { isPrivileged } from './permissions'

// #1410 (design D4): who may open a page is decided here, not by grants on the
// Page Table. A Published page opens for anyone signed in; a Draft only for
// someone who may build. To anyone else a Draft is exactly a page that is not
// there, so its name tells them nothing.

export interface PageListing { name: string; title: string; module: string; status: PageStatus; description: string | null }
export interface OpenPage extends PageListing { definition: unknown; updated_at: string }

/** The pages `user` may open, by title; of one module when it is named. */
export async function pagesFor(user: string, module?: string): Promise<PageListing[]> {
  const builds = await isPrivileged(user)
  const rows = await sql`
    select row_id as name, title, module, status, description from page
    where retired_at is null
      ${builds ? sql`` : sql`and status = 'Published'`}
      ${module === undefined ? sql`` : sql`and module = ${module}`}
    order by title asc, row_id asc`
  return rows as unknown as PageListing[]
}

/** One page, for `user`: its definition and the version a save of it takes. */
export async function openPage(user: string, name: string): Promise<OpenPage> {
  const [row] = await sql`
    select row_id as name, title, module, status, description, definition, updated_at from page
    where row_id = ${name} and retired_at is null`
  if (!row || (row.status !== 'Published' && !(await isPrivileged(user))))
    throw new AppError('NotFoundError', `There is no page "${name}"`)
  return { ...row, updated_at: (row.updated_at as Date).toISOString() } as unknown as OpenPage
}
