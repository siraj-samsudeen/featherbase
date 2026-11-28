// How the app opens (#1419): on the read-only copies once an official Run is loaded; "No Run" when the copy is readable but empty; and, when the read is refused, that they have
// no access, never a misleading "No Run" (Siraj, 28-Nov). Refused is: no Forecasting Member role, or no place on the org
// chart (#1454).
import { refusedAccess } from './api'

export type HostedStart = 'open' | 'no-run' | 'no-access'

export async function hostedStart(readRuns: () => Promise<unknown[]>): Promise<HostedStart> {
  try {
    return (await readRuns()).length ? 'open' : 'no-run'
  } catch (e) {
    if (refusedAccess(e)) return 'no-access'
    throw e
  }
}

/** What the page does when its first reads fail (#1454, 28-Nov): a lapsed sign-in signs in again; a refused read is
 *  no access; on a hosted instance anything else asks to try again, never the made-up data (which would tell a real
 *  person "you are not on the forecasting org chart"); only a local instance falls back to the made-up data. */
export type StartFailure = 'sign-in' | 'no-access' | 'try-again' | 'made-up'
export function startFailure(e: unknown, local: boolean): StartFailure {
  if ((e as { status?: number }).status === 401) return 'sign-in'
  if (local) return 'made-up'
  return refusedAccess(e) ? 'no-access' : 'try-again'
}
