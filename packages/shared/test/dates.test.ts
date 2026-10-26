import { describe, expect, it } from 'vitest'
import { fmtInstantIST } from '../src/dates'

// The one `DD-Mon-YYYY HH:MM IST` formatter, used by the web and by the
// server's instance-health messages (#465).
describe('fmtInstantIST', () => {
  it('renders an ISO instant in IST', () => {
    expect(fmtInstantIST('2026-10-22T09:00:00Z')).toBe('22-Oct-2026 14:30 IST')
  })
  it('takes a Date too, and crosses midnight into the next IST day', () => {
    expect(fmtInstantIST(new Date('2026-12-31T19:00:00Z'))).toBe('01-Jan-2027 00:30 IST')
  })
  it('renders nothing known as a dash', () => {
    expect(fmtInstantIST(null)).toBe('—')
    expect(fmtInstantIST(undefined)).toBe('—')
    expect(fmtInstantIST('')).toBe('—')
    expect(fmtInstantIST('not a date')).toBe('—')
  })
})
