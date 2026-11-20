// #1349: a worked-out chip goes to its section, which may only appear after a tab switch or a read.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { scrollToWhenShown } from '../src/components/RowPane'

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

describe('scrolling to a section once it shows', () => {
  test('a section already there takes focus at once', () => {
    document.body.innerHTML = '<section id="worked-out-Apps" tabindex="-1"></section>'
    scrollToWhenShown('worked-out-Apps')
    expect(document.activeElement?.id).toBe('worked-out-Apps')
  })
  test('a section that shows a moment later is waited for; one that never shows is given up on', () => {
    vi.useFakeTimers()
    scrollToWhenShown('worked-out-Later')
    vi.advanceTimersByTime(100)
    document.body.innerHTML = '<section id="worked-out-Later" tabindex="-1"></section>'
    vi.advanceTimersByTime(60)
    expect(document.activeElement?.id).toBe('worked-out-Later')
    scrollToWhenShown('worked-out-Never', 2)
    vi.advanceTimersByTime(500)
    expect(document.activeElement?.id).toBe('worked-out-Later')
  })
})
