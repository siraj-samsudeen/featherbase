import { describe, expect, test } from 'vitest'
import { parseInstanceAddresses } from '../src/instance-addresses'

// #488: INSTANCE_ADDRESSES — what each web address of an instance opens, and
// which one emailed links use. Read at boot, before the database.

const DASH = { address: 'https://dash.example.com', opens: 'feather_dash', emails: true }
const ADMIN = { address: 'https://featherbase.example.com', opens: 'admin' }
const parse = (list: unknown, environment = 'production') => parseInstanceAddresses(JSON.stringify(list), environment)

describe('INSTANCE_ADDRESSES validation', () => {
  test('a valid list parses into entries with their lowercased hosts', () => {
    expect(parse([DASH, { ...ADMIN, address: 'https://FeatherBase.Example.com/' }])).toEqual([
      { address: 'https://dash.example.com', host: 'dash.example.com', opens: 'feather_dash', emails: true },
      { address: 'https://featherbase.example.com', host: 'featherbase.example.com', opens: 'admin', emails: false },
    ])
  })

  test('unset is no list', () => {
    expect(parseInstanceAddresses(undefined, 'production')).toBeNull()
    expect(parseInstanceAddresses('  ', 'production')).toBeNull()
  })

  test('a value that is not a JSON array is refused', () => {
    expect(() => parseInstanceAddresses('https://dash.example.com', 'production')).toThrow(/JSON array/)
    expect(() => parse({ address: 'https://dash.example.com' })).toThrow(/JSON array/)
  })

  test('an address with a path is refused', () => {
    expect(() => parse([{ ...DASH, address: 'https://dash.example.com/app' }, ADMIN])).toThrow(/origin/)
  })

  test('an address that is not absolute is refused', () => {
    expect(() => parse([{ ...DASH, address: 'dash.example.com' }, ADMIN])).toThrow(/origin/)
  })

  test('plain http is refused outside development and test', () => {
    expect(() => parse([{ ...DASH, address: 'http://dash.example.com' }, ADMIN])).toThrow(/https/)
  })

  test('plain http is allowed in development', () => {
    expect(parse([{ ...DASH, address: 'http://dash.localhost:5173' }, ADMIN], 'development')?.[0].host).toBe('dash.localhost')
  })

  test('two entries with one host are refused, whatever their ports', () => {
    expect(() => parse([DASH, { ...ADMIN, address: 'https://dash.example.com:8443' }])).toThrow(/more than once/)
  })

  test('opens must be admin or an app name', () => {
    expect(() => parse([{ ...DASH, opens: 'Feather Dash' }, ADMIN])).toThrow(/opens/)
  })

  test('a reserved root is not an app name', () => {
    expect(() => parse([{ ...DASH, opens: 'featherbase' }, ADMIN])).toThrow(/opens/)
  })

  test('exactly one entry is marked for emails', () => {
    expect(() => parse([{ ...DASH, emails: false }, ADMIN])).toThrow(/exactly one/)
    expect(() => parse([DASH, { ...ADMIN, emails: true }])).toThrow(/exactly one/)
  })

  test('at least one entry opens admin', () => {
    expect(() => parse([DASH])).toThrow(/admin/)
  })
})
