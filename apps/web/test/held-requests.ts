// A slow network, for a test that must act while a request is still out:
// every request whose address contains `part` waits until the test releases
// it, then goes to the in-process server as usual. `asked` settles once the
// first such request has been made.
// Undone by vi.restoreAllMocks() after each test (test/setup.ts).
import { vi } from 'vitest'

export function holdResponses(part: string): { asked: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let reached!: () => void
  const asked = new Promise<void>((resolve) => { reached = resolve })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!path.includes(part)) return real(input, init)
    reached()
    await held
    return real(input, init)
  })
  return { asked, release }
}
