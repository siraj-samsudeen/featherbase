import { vi } from 'vitest'

/**
 * Runs `fn` with the app's clock (`Date`, `Date.now`) at `when`, then puts the real clock back.
 * Only `Date` is faked, so timeouts and I/O keep running; call `vi.setSystemTime` inside `fn` to
 * move the clock further. The database's own clock (`now()`) is not moved by this.
 */
export async function withTime<T>(when: Date | number, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] })
  try { vi.setSystemTime(when); return await fn() } finally { vi.useRealTimers() }
}

/** `withTime`, at `offsetMs` from now (negative for the past). */
export function withTimeFromNow<T>(offsetMs: number, fn: () => Promise<T>): Promise<T> {
  return withTime(Date.now() + offsetMs, fn)
}
