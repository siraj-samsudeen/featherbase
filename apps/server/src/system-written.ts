import { AppError } from './errors'
import type { TableMeta } from './meta'

// #432: a system-written Table (Activity Log, Version, Background Job, …) is
// written by the server's own code alone. Every public write path calls this
// BEFORE any permission check, so the privileged bypass (Administrator,
// System Manager, their access tokens) never reaches the write. The server's
// writers do not pass through here: they insert directly (audit.ts, jobs.ts,
// email.ts, the version trail) or through saveSystemRow (document.ts).
export function assertNotSystemWritten(
  meta: Pick<TableMeta, 'name' | 'system_written'>,
  action: string,
): void {
  if (meta.system_written)
    throw new AppError(
      'PermissionError',
      `${meta.name} is written only by the platform; its rows and columns cannot be ${action}`,
    )
}

/** The gate on every row write: never a system-written Table's, and (#905)
 *  never an archived Table's, whoever asks, until a System Manager
 *  un-archives it. Its columns, name and deletion are not row writes: they
 *  keep assertNotSystemWritten alone, so an archived Table can still be
 *  deleted later. */
export function assertRowsWritable(
  meta: Pick<TableMeta, 'name' | 'system_written' | 'archived_at'> & Partial<Pick<TableMeta, 'kind' | 'view_of'>>,
  action: string,
): void {
  // #1021: a view holds no rows; every write addressed to one stops here.
  if (meta.kind === 'view')
    throw new AppError('ValidationError',
      `${meta.name} is a view of ${meta.view_of}; it holds no rows of its own, so nothing can be ${action} through it. ${action === 'created' || action === 'imported' ? `Add it to ${meta.view_of} instead.` : `Open the ${meta.view_of} row instead.`}`)
  assertNotSystemWritten(meta, action)
  if (meta.archived_at)
    throw new AppError('PermissionError', `${meta.name} is archived; its rows cannot be ${action}. A System Manager can un-archive it.`)
}

// #432: configuration that acts on another Table (a Server Script, Metadata
// Override, Workflow or Custom Field) may not name a system-written one —
// each would let a person reshape or rewrite the audit trail from the side.
export async function assertTargetNotSystemWritten(target: unknown, action: string): Promise<void> {
  if (typeof target !== 'string' || !target) return
  const { getMeta } = await import('./meta')
  const meta = await getMeta(target).catch(() => null)
  if (meta) assertNotSystemWritten(meta, action)
}
