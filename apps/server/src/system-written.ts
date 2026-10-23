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

// #432: configuration that acts on another Table (a Server Script, Metadata
// Override, Workflow or Custom Field) may not name a system-written one —
// each would let a person reshape or rewrite the audit trail from the side.
export async function assertTargetNotSystemWritten(target: unknown, action: string): Promise<void> {
  if (typeof target !== 'string' || !target) return
  const { getMeta } = await import('./meta')
  const meta = await getMeta(target).catch(() => null)
  if (meta) assertNotSystemWritten(meta, action)
}
