import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, clockMinutes, deadlineAfter, duration, issueClock, ruleFor } from './sla'

// Instants are written in IST (+05:30), the platform's display zone.
const at = (ist: string) => Date.parse(`${ist}+05:30`)
const STORE = { opens: '09:00', closes: '22:00' }

describe('minutes on the clock', () => {
  it('counts every minute round the clock', () => {
    expect(clockMinutes(at('2026-11-07T21:00'), at('2026-11-08T01:00'), 'Round the clock', STORE)).toBe(240)
  })

  it('counts only store hours, skipping the night', () => {
    expect(clockMinutes(at('2026-11-07T21:00'), at('2026-11-08T10:00'), 'Store hours', STORE)).toBe(120)
    expect(clockMinutes(at('2026-11-07T23:00'), at('2026-11-08T08:00'), 'Store hours', STORE)).toBe(0)
  })

  it('counts the default store hours, 09:00 to 22:00, when none are given', () => {
    expect(clockMinutes(at('2026-11-07T08:00'), at('2026-11-07T23:00'), 'Store hours')).toBe(780)
  })

  it('handles a shift that crosses midnight', () => {
    const night = { opens: '20:00', closes: '06:00' }
    expect(clockMinutes(at('2026-11-07T19:00'), at('2026-11-08T07:00'), 'Store hours', night)).toBe(600)
  })
})

describe('deadlines', () => {
  it('adds minutes round the clock', () => {
    expect(deadlineAfter(at('2026-11-07T21:00'), 240, 'Round the clock', STORE)).toBe(at('2026-11-08T01:00'))
  })

  it('carries store-hours time over the night', () => {
    expect(deadlineAfter(at('2026-11-07T21:00'), 120, 'Store hours', STORE)).toBe(at('2026-11-08T10:00'))
    expect(deadlineAfter(at('2026-11-07T23:30'), 60, 'Store hours', STORE)).toBe(at('2026-11-08T10:00'))
  })

  it('carries store-hours time over the night with the default hours when none are given', () => {
    expect(deadlineAfter(at('2026-11-07T21:00'), 120, 'Store hours')).toBe(at('2026-11-08T10:00'))
  })

  it('refuses a store-hours deadline when the store hours cannot be read', () => {
    expect(() => deadlineAfter(at('2026-11-07T21:00'), 60, 'Store hours', { opens: 'morning', closes: 'night' }))
      .toThrow('No store hours to count this clock')
  })
})

describe('SLA rules', () => {
  it('uses a category’s own rule before the severity default', () => {
    const rules = [{ severity: 'High', category: 'Cash shortage', respond_minutes: 15, fix_minutes: 120, clock: 'Round the clock' as const }]
    expect(ruleFor(rules, 'High', 'Cash shortage')).toMatchObject({ fix_minutes: 120, clock: 'Round the clock' })
    expect(ruleFor(rules, 'High', 'Equipment failure')).toMatchObject(DEFAULT_RULES.High)
  })

  it('falls back to the Medium default for a severity it does not know', () => {
    expect(ruleFor([], 'Urgent', null)).toBe(DEFAULT_RULES.Medium)
  })

  it('has the proposed defaults', () => {
    expect(DEFAULT_RULES.Critical).toMatchObject({ respond_minutes: 15, fix_minutes: 240, clock: 'Round the clock', director_after_minutes: 120 })
    expect(DEFAULT_RULES.Low).toMatchObject({ respond_minutes: 1440, fix_minutes: 10080, clock: 'Store hours' })
  })
})

describe('an issue’s clock', () => {
  const issue = { raised_at: new Date(at('2026-11-07T10:00')).toISOString(), fix_minutes: 600, clock: 'Store hours' as const, opens_at: '09:00', closes_at: '22:00', paused_minutes: 0 }

  it('shows elapsed time, time on the clock, the share used and what is left', () => {
    expect(issueClock(issue, at('2026-11-07T17:30'))).toMatchObject({ elapsed: 450, onClock: 450, usedPct: 75, left: 150, breached: false })
  })

  it('stops counting while paused and after submission', () => {
    expect(issueClock({ ...issue, paused_minutes: 60 }, at('2026-11-07T17:30'))).toMatchObject({ onClock: 390, left: 210 })
    expect(issueClock({ ...issue, paused: true, paused_since: new Date(at('2026-11-07T12:00')).toISOString() }, at('2026-11-07T17:30'))).toMatchObject({ onClock: 120 })
    expect(issueClock({ ...issue, submitted_at: new Date(at('2026-11-07T11:00')).toISOString() }, at('2026-11-07T17:30'))).toMatchObject({ onClock: 60 })
  })

  it('runs on the default store hours with nothing paused when the issue gives neither', () => {
    const bare = { raised_at: issue.raised_at, fix_minutes: 600, clock: 'Store hours' as const }
    expect(issueClock(bare, at('2026-11-07T23:00'))).toMatchObject({ elapsed: 780, onClock: 720, left: -120, breached: true })
  })

  it('is breached past its fix time, counting overnight in store hours', () => {
    expect(issueClock(issue, at('2026-11-08T10:00'))).toMatchObject({ elapsed: 1440, onClock: 780, left: -180, breached: true })
  })
})

describe('durations', () => {
  it('shows hours and minutes under a day', () => {
    expect(duration(90)).toBe('1h 30m')
  })

  it('shows whole hours without minutes', () => {
    expect(duration(120)).toBe('2h')
  })
})
