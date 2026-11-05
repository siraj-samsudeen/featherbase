// The warehouse reader's own decisions, made before any network call: a
// missing token fails by name and says what it was needed for. The hosted
// query itself (readMotherDuck) needs a live token and is exercised manually.
import { afterEach, describe, expect, it } from 'vitest'
import { attachStatement, requireMotherDuckToken } from '../src/motherduck-reader'

const saved = process.env.MOTHERDUCK_TOKEN
afterEach(() => {
  if (saved === undefined) delete process.env.MOTHERDUCK_TOKEN
  else process.env.MOTHERDUCK_TOKEN = saved
})

describe('Reading the warehouse', () => {
  it('without a MotherDuck token says which variable is missing and what it was for', () => {
    delete process.env.MOTHERDUCK_TOKEN
    expect(() => requireMotherDuckToken('run the leaver check')).toThrow(
      'MOTHERDUCK_TOKEN is not set (required to run the leaver check)',
    )
  })

  it('with a token set returns it for the connection', () => {
    process.env.MOTHERDUCK_TOKEN = 'md-test-token'
    expect(requireMotherDuckToken('refresh anything')).toBe('md-test-token')
  })
})

describe('attachStatement (#969)', () => {
  it('always attaches read-only, and keeps an address and a name quoted', () => {
    expect(attachStatement('md:_share/gold/abc', 'gold')).toBe(`attach 'md:_share/gold/abc' as "gold" (read_only)`)
    expect(attachStatement("a'b", 'c"d')).toBe(`attach 'a''b' as "c""d" (read_only)`)
  })
})
