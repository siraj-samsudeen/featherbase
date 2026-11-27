// #1409: the header that marks a response whose rows came from a stand-in.
import { describe, expect, test } from 'vitest'
import { STAND_IN_HEADER, STAND_IN_TIMING, readStandInHeader, standInHeaderValue, standInServerTiming, type StandInServed } from '../src/stand-in'

const targets: StandInServed = { app: 'storesales', dataset: 'targets', loaded_at: '2026-11-27T05:30:00.000Z', note: 'From the planning workbook – draft', expected_by: '2026-12-15' }

describe('the stand-in header', () => {
  test('carries the stand-ins a response served, whatever script the note is in', () => {
    const value = standInHeaderValue([targets, { ...targets, dataset: 'plans', note: 'திட்டம்', expected_by: null }])
    expect(value).toMatch(/^[\x21-\x7e]+$/)
    expect(readStandInHeader(value)).toEqual([targets, { ...targets, dataset: 'plans', note: 'திட்டம்', expected_by: null }])
  })

  test('is repeated as one Server-Timing metric, whose description reads back as the same list', () => {
    const value = standInServerTiming([targets])
    const [, name, description] = /^([^;]+);desc="([^"\\]*)"$/.exec(value)!
    expect(name).toBe(STAND_IN_TIMING)
    expect(readStandInHeader(description)).toEqual([targets])
  })

  test('names no stand-in when it is missing, unreadable or not a list of stand-ins', () => {
    expect(STAND_IN_HEADER).toBe('Featherbase-Stand-In')
    expect(readStandInHeader(null)).toEqual([])
    expect(readStandInHeader('')).toEqual([])
    expect(readStandInHeader('%7Bnot json')).toEqual([])
    expect(readStandInHeader('%E0%A4%A')).toEqual([])
    expect(readStandInHeader(encodeURIComponent('{"app":"storesales"}'))).toEqual([])
    expect(readStandInHeader(encodeURIComponent(JSON.stringify([null, { app: 'storesales' }, targets])))).toEqual([targets])
  })
})
