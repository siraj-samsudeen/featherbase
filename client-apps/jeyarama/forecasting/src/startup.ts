// How a hosted instance without the legacy Run (forecasting.run_line) opens (#1419): on the read-only copies once an
// official Run is loaded; "No Run" when the copy is readable but empty; and, when the copy refuses the read because the
// person lacks Forecasting Member, that they have no access yet, never a misleading "No Run" (Siraj, 28-Nov).
export type HostedStart = 'open' | 'no-run' | 'no-access'

export async function hostedStart(readRuns: () => Promise<unknown[]>): Promise<HostedStart> {
  try {
    return (await readRuns()).length ? 'open' : 'no-run'
  } catch (e) {
    if ((e as { status?: number }).status === 403) return 'no-access'
    throw e
  }
}
