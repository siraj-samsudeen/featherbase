// How a hosted instance without the legacy Run (forecasting.run_line) opens (#1419): on the read-only copies once an
// official Run is loaded; "No Run" when the copy is readable but empty; and, when the read is refused, that they have
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

/** Who the signed-in person is to the app: someone who looks after it ('admin'), a person on the chart ('on-chart'),
 *  or off it. On the read-only copies the chart is the made-up one, so a real person is never on it: they open the copy
 *  views ('copies'), which the server reads as them, rather than "not on the forecasting org chart" (28-Nov). */
export type Signed = 'admin' | 'on-chart' | 'copies' | 'off-chart'
export function signedIn(u: { row_id?: string; full_name?: string; roles?: string[] }, onChart: (name: string) => boolean, copiesOnly: boolean): Signed {
  if (u.row_id === 'Administrator' || (u.roles ?? []).includes('System Manager')) return 'admin'
  if (u.full_name && onChart(u.full_name)) return 'on-chart'
  return copiesOnly ? 'copies' : 'off-chart'
}
