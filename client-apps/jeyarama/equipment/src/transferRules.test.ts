import { describe, expect, it } from 'vitest'
import { clearanceState, defaultReceiptBy, isOpenTransfer, receiptClock, TRANSFER_KINDS } from './transferRules'

describe('receipt deadlines', () => {
  it('gives a day within a site and three days for anything else', () => {
    expect(TRANSFER_KINDS).toEqual(['Within site', 'Between sites', 'Temporary loan', 'Repair with vendor', 'Between companies'])
    expect(defaultReceiptBy('Within site', '2026-11-07T04:00:00.000Z')).toBe('2026-11-08T04:00:00.000Z')
    for (const kind of ['Between sites', 'Temporary loan', 'Repair with vendor', 'Between companies'])
      expect(defaultReceiptBy(kind, '2026-11-07T04:00:00.000Z')).toBe('2026-11-10T04:00:00.000Z')
  })

  it('counts down while in transit and shows lateness once past due', () => {
    const transfer = { transfer_state: 'Dispatched', expected_receipt_at: '2026-11-10T04:00:00.000Z' }
    expect(receiptClock(transfer, new Date('2026-11-08T04:00:00.000Z'))).toEqual({ tone: 'ok', label: '2d left' })
    expect(receiptClock(transfer, new Date('2026-11-10T09:00:00.000Z'))).toEqual({ tone: 'late', label: 'Late by 5h' })
    expect(receiptClock({ ...transfer, transfer_state: 'Received' }, new Date('2026-11-20T00:00:00.000Z'))).toEqual({ tone: 'done', label: 'Received' })
    expect(receiptClock({ ...transfer, transfer_state: 'Requested' }, new Date('2026-11-20T00:00:00.000Z'))).toEqual({ tone: 'done', label: 'Not dispatched' })
  })

  it('knows which transfers still hold their assets', () => {
    expect(['Requested', 'Approved', 'Dispatched'].every(isOpenTransfer)).toBe(true)
    expect(['Rejected', 'Received', 'Cancelled'].some(isOpenTransfer)).toBe(false)
  })
})

describe('clearance', () => {
  const today = '2026-11-07'

  it('is clear only when the person holds nothing', () => {
    expect(clearanceState({ clearance_state: 'Open', leaving_date: '2026-11-30' }, 0, today)).toBe('Ready to close')
    expect(clearanceState({ clearance_state: 'Open', leaving_date: '2026-11-30' }, 2, today)).toBe('2 assets to return or reassign')
    expect(clearanceState({ clearance_state: 'Cleared', leaving_date: '2026-11-30' }, 0, today)).toBe('Cleared')
  })

  it('asks for escalation to HR and Operations after the leaving date', () => {
    expect(clearanceState({ clearance_state: 'Open', leaving_date: '2026-11-05' }, 1, today)).toBe('Escalate to HR and Operations: 1 asset not returned')
    expect(clearanceState({ clearance_state: 'Open', leaving_date: '2026-11-05T00:00:00.000Z' }, 0, today)).toBe('Ready to close')
  })
})
