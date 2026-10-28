import { describe, expect, it } from 'vitest'
import { jobTitle } from '../src/jobs'

describe('jobTitle (#464)', () => {
  it('reads a method as words with a capital', () => {
    expect(jobTitle('disable_leavers')).toBe('Disable leavers')
    expect(jobTitle('check_instance_health')).toBe('Check instance health')
    expect(jobTitle('refresh-datasets')).toBe('Refresh datasets')
  })
  it('keeps an odd method readable', () => {
    expect(jobTitle('ping')).toBe('Ping')
    expect(jobTitle('__')).toBe('__')
  })
})
