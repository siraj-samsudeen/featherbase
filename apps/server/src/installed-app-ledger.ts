// The jsonb ledger columns (tables/roles/perms) round-trip as arrays, but
// tolerate a stored JSON string too (defensive against double-encoding).
export function asNameList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return []
}

/** #659: does this installation declare pages of its own, opening at its own
 *  root? A runtime package whose stored manifest names a client. Read from
 *  the installed_app row, never from whether this process loaded the app's
 *  files: an artifact missing or rejected at a restart must not hand the
 *  app's Tables back to the Admin. Whether the app can be OPENED right now is
 *  a separate question (the app catalog also needs its loaded client).
 *
 *  Fails closed: a runtime package whose stored declaration cannot be read
 *  counts as having pages of its own, so its Tables never fall back to
 *  ordinary Admin Tables. A code-registered app has no pages of its own. */
export function declaresOwnPages(row: { runtime_package?: unknown; manifest?: unknown }): boolean {
  if (row.runtime_package !== true) return false
  let manifest = row.manifest
  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest)
    } catch {
      return true
    }
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return true
  // A readable declaration without a client is an app used through the
  // Admin; any client it declares, even a malformed one, is pages of its own.
  return (manifest as { client?: unknown }).client !== undefined
}
