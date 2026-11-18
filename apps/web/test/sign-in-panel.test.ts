// #1283: whether the one panel of ways in draws any button at all, which decides the "or" above it.
import { describe, expect, it } from 'vitest'
import { hasOtherWays } from '../src/components/SignInPanel'

const stylehr = { key: 'stylehr', label: 'StyleHR' }

describe('hasOtherWays', () => {
  it('counts Google or Microsoft whenever they are on', () => {
    expect(hasOtherWays({ google: { key: 'g', label: 'Google' }, delegated: [], password: false, without: 'password' })).toBe(true)
    expect(hasOtherWays({ microsoft: { key: 'm', label: 'Microsoft' }, delegated: [], password: false, without: null })).toBe(true)
  })

  it('counts a connected service only when its form is not the one already open', () => {
    expect(hasOtherWays({ delegated: [stylehr], password: false, without: 'password' })).toBe(true)
    expect(hasOtherWays({ delegated: [stylehr], password: false, without: 'stylehr' })).toBe(false)
  })

  it('counts user name and password only when its form is not the one already open', () => {
    expect(hasOtherWays({ delegated: [stylehr], password: true, without: 'stylehr' })).toBe(true)
    expect(hasOtherWays({ delegated: [], password: true, without: 'password' })).toBe(false)
  })
})
