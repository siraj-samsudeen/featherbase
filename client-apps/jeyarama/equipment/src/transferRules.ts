// Rules for custody and transfers that both the server and the pages use. Pure.

export const TRANSFER_KINDS = ['Within site', 'Between sites', 'Temporary loan', 'Repair with vendor', 'Between companies'] as const
export const OPEN_TRANSFER_STATES = ['Requested', 'Approved', 'Dispatched'] as const
export const FINAL_LINE_STATES = ['Received good', 'Received damaged', 'Returned to source'] as const

const HOUR = 3_600_000

/** The BRD's default receipt deadline: a day within a site, three days for anything else. */
export function defaultReceiptBy(kind: string, fromIso: string): string {
  const hours = kind === 'Within site' ? 24 : 72
  return new Date(Date.parse(fromIso) + hours * HOUR).toISOString()
}

export function isOpenTransfer(state: string): boolean {
  return (OPEN_TRANSFER_STATES as readonly string[]).includes(state)
}

function span(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24), rest = hours % 24
  return rest ? `${days}d ${rest}h` : `${days}d`
}

/** Time left to receive a dispatched transfer, or how late it is. */
export function receiptClock(transfer: { transfer_state: string; expected_receipt_at?: string | null }, now: Date): { tone: 'ok' | 'late' | 'done'; label: string } {
  if (transfer.transfer_state === 'Received') return { tone: 'done', label: 'Received' }
  if (transfer.transfer_state !== 'Dispatched') return { tone: 'done', label: 'Not dispatched' }
  if (!transfer.expected_receipt_at) return { tone: 'ok', label: 'No receipt time' }
  const left = Date.parse(transfer.expected_receipt_at) - now.getTime()
  return left < 0 ? { tone: 'late', label: `Late by ${span(left)}` } : { tone: 'ok', label: `${span(left)} left` }
}

/** Where a leaver's or mover's clearance stands. Assets never holds pay. */
export function clearanceState(clearance: { clearance_state: string; leaving_date?: string | null }, open: number, today: string): string {
  if (clearance.clearance_state === 'Cleared') return 'Cleared'
  if (!open) return 'Ready to close'
  const assets = `${open} ${open === 1 ? 'asset' : 'assets'}`
  if (clearance.leaving_date && clearance.leaving_date.slice(0, 10) < today) return `Escalate to HR and Operations: ${assets} not returned`
  return `${assets} to return or reassign`
}
