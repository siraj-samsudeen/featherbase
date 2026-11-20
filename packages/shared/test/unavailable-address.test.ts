// #1328 (audit F09): the address the unavailable page repeats, as text only, and
// where the server sends an address it cannot open.
import { describe, expect, test } from 'vitest'
import { ADDRESS_MAX, UNAVAILABLE_PATH, askedAddress, unavailableHref } from '../src/unavailable-address'

describe('askedAddress', () => {
  test('a relative path with a single leading slash is repeated as it is', () => {
    expect(askedAddress('/equipment/')).toBe('/equipment/')
    expect(askedAddress(`/${'x'.repeat(ADDRESS_MAX - 1)}`)).toHaveLength(ADDRESS_MAX)
  })

  test('anything else is not repeated: another site, a backslash, a control character, too long, not text', () => {
    for (const bad of ['//evil.example', 'https://evil.example', 'evil', '/\\evil', '/a\nb', '/a\u0000b', `/${'x'.repeat(ADDRESS_MAX)}`, 42, null, undefined])
      expect(askedAddress(bad), String(bad)).toBeNull()
  })
})

test('unavailableHref carries the address as one encoded query value', () => {
  expect(unavailableHref('/equipment/')).toBe(`${UNAVAILABLE_PATH}?address=%2Fequipment%2F`)
})
