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
