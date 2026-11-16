// #1230: an app asks whether an optional instance Table it reads is still there, with every column
// it declared, before reading it. Unavailable is false; any other failure is not hidden as false.
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { makeTable } from './fixtures'
import { baseTablesReader } from '../src/change-proposals'

vi.mock('../src/meta', async (original) => {
  const actual = await original<typeof import('../src/meta')>()
  return { ...actual, getMeta: async (table: string, ...rest: unknown[]) => {
    if (table === 'Broken Read') throw new Error('The database went away')
    return (actual.getMeta as (...args: unknown[]) => unknown)(table, ...rest)
  } }
})

describe('whether a base Table is available (#1230)', () => {
  test('false when undeclared, unlinked, missing or short of a declared column; true when all are there', async ({ admin }) => {
    await makeTable(admin, { name: 'Covered Rows', columns: ['store', 'person'] })
    const read = { 'Covered Rows': ['store', 'person'], 'Short Rows': ['store', 'missing'], 'No Such Table': ['x'] }
    await makeTable(admin, { name: 'Short Rows', columns: ['store'] })
    const reader = (linked: string[]) => baseTablesReader('someapp', { read, propose: {} } as never, linked).helper
    expect(await reader(['Covered Rows']).available('Undeclared')).toBe(false)
    expect(await reader([]).available('Covered Rows')).toBe(false)
    expect(await reader(['No Such Table']).available('No Such Table')).toBe(false)
    expect(await reader(['Short Rows']).available('Short Rows')).toBe(false)
    expect(await reader(['Covered Rows']).available('Covered Rows')).toBe(true)
  })

  test('any other failure is not hidden as unavailable', async () => {
    const helper = baseTablesReader('someapp', { read: { 'Broken Read': ['x'] }, propose: {} } as never, ['Broken Read']).helper
    await expect(helper.available('Broken Read')).rejects.toThrow('The database went away')
  })
})
