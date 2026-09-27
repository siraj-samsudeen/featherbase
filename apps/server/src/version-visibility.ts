import { getMeta } from './meta'
import { isSharedWith, permittedTiers, sharedFieldTiers } from './permissions'
import { STANDARD_COLUMNS } from './table-engine'

type VersionData = { changed?: [string, unknown, unknown][] } & Record<string, unknown>

export function sanitizeVersionData(data: unknown, visibleFields: Set<string>): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const version = data as VersionData
  return {
    ...version,
    changed: (version.changed ?? []).filter(([field]) => visibleFields.has(field)),
  }
}

// Generic Version reads have already authorized the parent row. Derive the
// same field view a parent detail read would use, including the special share
// rule: basic comes from the share; restricted still comes from roles.
export async function sanitizeVersionDataForUser(
  refTable: string,
  refName: string,
  data: unknown,
  user: string,
): Promise<unknown> {
  const meta = await getMeta(refTable)
  const shared = await isSharedWith(user, refTable, refName, 'read')
  const tiers = shared
    ? await sharedFieldTiers(user, refTable, 'read')
    : await permittedTiers(user, refTable, 'read')
  const visible = new Set<string>(['table', ...STANDARD_COLUMNS])
  for (const column of meta.columns)
    if (tiers.has(column.tier ?? 'basic')) visible.add(column.column_name)
  return sanitizeVersionData(data, visible)
}
