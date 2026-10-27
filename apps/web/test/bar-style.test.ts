// #650: the platform stylesheet as the bar's shadow root uses it (src/bar/style.ts).
import { describe, expect, test } from 'vitest'
import { shadowCss } from '../src/bar/style'

describe("the bar's shadow stylesheet", () => {
  test('rules written for the root apply to the shadow host', () => {
    const css = shadowCss(':root{--color-ink:#111}@media (pointer: coarse){:root{--spacing-control:3rem}}')
    expect([css.includes(':root'), css.includes(':host{--color-ink:#111}'), css.includes(':host{--spacing-control:3rem}')]).toEqual([false, true, true])
  })

  test("a registered property's starting value is declared on every element of the bar", () => {
    const css = shadowCss('@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}')
    expect(css).toContain('@layer properties{*,::before,::after,::backdrop{--tw-border-style:solid}}')
  })

  test('a registered property with no starting value starts as initial', () => {
    const css = shadowCss('@property --tw-font-weight{syntax:"*";inherits:false}')
    expect(css).toContain('{--tw-font-weight:initial}')
  })

  test('the starting values sit in the lowest layer, below every other style', () => {
    expect(shadowCss('').startsWith('@layer properties, featherbase-host;')).toBe(true)
  })

  test('the host sits at the top of the page, above the content, from the browser defaults', () => {
    expect(shadowCss('')).toContain(':host{all:initial;display:block;position:sticky;top:0;z-index:2147483647}')
  })
})
