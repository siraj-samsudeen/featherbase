// What a Dive receives for a reader: only filters, worked out from the report's row and the
// reader's places. Made-up stores 9901 and 9902, made-up subcategories.
import { describe, expect, it } from 'vitest'
import { diveFilters, storesOfReport, type ReportRecord } from './dive-filters'
import type { Place } from './provider'

const report = (over: Partial<ReportRecord>): ReportRecord => ({
  report_key: 'r', report_name: 'R', dive_id: 'd', filter_shape: 'No filter',
  store_key: null, subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: false, quick_view: null, pickers_in_dive: false, ...over })
const oneStore = report({ filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end' })
const wholeStores = report({ filter_shape: 'Whole stores', store_key: 'store_codes' })
const perStore = report({ filter_shape: 'Stores and subcategories', store_key: 'reach' })

const wholeStore = (store: string): Place => ({ label: store, filters: { store: [store] } })
const section = (store: string, name: string, ...codes: string[]): Place => ({ label: `${store} / Section: ${name}`, filters: { store: [store], subcategory: codes } })
const period = { store: '9901', periodEnd: '2026-11-07', appOrigin: null }

describe('a report taking one store', () => {
  it('sends a section reader that store and their subcategories, and no whole-store flag', () => {
    const answer = diveFilters(oneStore, [section('9901', 'Tops', '000000002', '000000001')], period)
    expect(answer).toEqual({ state: { plant_code: '9901', material_groups: ['000000001', '000000002'], period_end: '2026-11-07' } })
  })

  it('sends a whole-store reader the flag and no subcategories', () => {
    expect(diveFilters(oneStore, [wholeStore('9901')], period)).toEqual({ state: { plant_code: '9901', whole_store: true, period_end: '2026-11-07' } })
  })

  it('never carries one store\'s subcategories into another', () => {
    const answer = diveFilters(oneStore, [section('9901', 'Tops', '000000001'), section('9902', 'Sarees', '000000002')], period)
    expect(answer).toMatchObject({ state: { material_groups: ['000000001'] } })
  })

  it('a whole store beats a section in that store, and a section elsewhere stays narrow', () => {
    const places = [section('9901', 'Tops', '000000001'), wholeStore('9901'), section('9902', 'Sarees', '000000002')]
    expect(diveFilters(oneStore, places, period)).toMatchObject({ state: { whole_store: true } })
    expect(diveFilters(oneStore, places, { ...period, store: '9902' })).toMatchObject({ state: { material_groups: ['000000002'] } })
  })

  it('refuses a store outside the reader\'s places', () => {
    expect(diveFilters(oneStore, [wholeStore('9901')], { ...period, store: '9902' })).toEqual({ refused: 'not_your_store' })
  })

  it('leaves the month out when the report takes none', () => {
    const { month_key: _, ...rest } = oneStore
    expect(diveFilters({ ...rest, month_key: null }, [wholeStore('9901')], period)).toEqual({ state: { plant_code: '9901', whole_store: true } })
  })
})

describe('a report taking whole stores', () => {
  it('sends only the stores the reader covers whole', () => {
    const places = [wholeStore('9902'), wholeStore('9901'), section('9903', 'Tops', '000000001')]
    expect(diveFilters(wholeStores, places, { ...period, store: undefined })).toEqual({ state: { store_codes: ['9901', '9902'] } })
  })

  it('is not for someone who covers no whole store: never the store\'s totals for a section reader', () => {
    expect(diveFilters(wholeStores, [section('9901', 'Tops', '000000001')], { ...period, store: undefined })).toEqual({ refused: 'whole_stores_only' })
  })
})

describe('a report taking stores and subcategories', () => {
  it('sends each store its own reach, so a subcategory never crosses into another store', () => {
    const places = [wholeStore('9901'), section('9902', 'Tops', '000000002', '000000001'), section('9903', 'Sarees', '000000003')]
    expect(diveFilters(perStore, places, { ...period, store: undefined })).toEqual({
      state: { reach: { 9901: null, 9902: ['000000001', '000000002'], 9903: ['000000003'] } } })
  })

  it('joins two sections of one store', () => {
    const places = [section('9902', 'Tops', '000000001'), section('9902', 'Sarees', '000000002')]
    expect(diveFilters(perStore, places, { ...period, store: undefined })).toEqual({ state: { reach: { 9902: ['000000001', '000000002'] } } })
  })
})

describe('any report', () => {
  it('a report taking no filter sends nothing', () => {
    expect(diveFilters(report({}), [wholeStore('9901')], { ...period, store: undefined })).toEqual({ state: {} })
  })

  it('sends the page\'s origin only to a Dive that says it is ready', () => {
    const origin = { ...period, store: undefined, appOrigin: 'https://dash.example.test' }
    expect(diveFilters(report({}), [wholeStore('9901')], origin)).toEqual({ state: {} })
    expect(diveFilters(report({ ready_signal: true }), [wholeStore('9901')], origin)).toEqual({ state: { app_origin: 'https://dash.example.test' } })
  })

  it('a row whose keys are missing is refused, never opened unfiltered', () => {
    expect(diveFilters(report({ filter_shape: 'Whole stores' }), [wholeStore('9901')], period)).toEqual({ refused: 'report_not_set_up' })
    expect(diveFilters(report({ filter_shape: 'One store and subcategories', store_key: 'plant_code' }), [wholeStore('9901')], period)).toEqual({ refused: 'report_not_set_up' })
    expect(diveFilters(report({ filter_shape: 'Stores and subcategories' }), [wholeStore('9901')], period)).toEqual({ refused: 'report_not_set_up' })
  })

  it('a row with an unknown shape is refused', () => {
    expect(diveFilters(report({ filter_shape: 'Everything' as never }), [wholeStore('9901')], period)).toEqual({ refused: 'report_not_set_up' })
  })
})

describe('the store picker', () => {
  it('offers stores only on a report taking one store', () => {
    expect(storesOfReport(oneStore, [wholeStore('9902'), section('9901', 'Tops', '000000001')])).toEqual(['9901', '9902'])
    expect(storesOfReport(wholeStores, [wholeStore('9901')])).toEqual([])
    expect(storesOfReport(perStore, [wholeStore('9901')])).toEqual([])
  })
})

describe('what a place without a store, or an opening without one, gives', () => {
  it('ignores a place naming no store, and refuses a one-store report opened without a store', () => {
    const noStore: Place = { label: 'Head office', filters: {} }
    expect(diveFilters(oneStore, [noStore, wholeStore('9901')], { ...period, store: undefined })).toEqual({ refused: 'not_your_store' })
    expect(diveFilters(wholeStores, [noStore, wholeStore('9901')], period)).toEqual({ state: { store_codes: ['9901'] } })
  })
})

// #1159: the Dive has its own Store and Month pickers (v16, data-warehouse#4739). Dash passes the
// reader's whole reach and where to open, and no key of the old one-store contract.
describe('a report whose Dive has its own pickers', () => {
  const pickers = { ...oneStore, pickers_in_dive: true, ready_signal: true }
  const places = [section('9901', 'Tops', '000000002', '000000001'), wholeStore('9902')]

  it('sends the reach of every place, the store and month to open on, and the origin, and no other key', () => {
    expect(diveFilters(pickers, places, { store: '9902', month: 'last', periodEnd: '2026-10-31', appOrigin: 'https://dash.example.test' }))
      .toEqual({ state: { reach: { 9901: ['000000001', '000000002'], 9902: null }, store: '9902', month: 'last', app_origin: 'https://dash.example.test' } })
  })

  it('leaves out a store outside the reach, and opens on this month when none is named', () => {
    expect(diveFilters({ ...pickers, ready_signal: false }, places, { store: '9999', periodEnd: '2026-11-07', appOrigin: null }))
      .toEqual({ state: { reach: { 9901: ['000000001', '000000002'], 9902: null }, month: 'this' } })
  })

  it('refuses a reader who reaches no store, so the Dive is never asked', () => {
    expect(diveFilters(pickers, [], { periodEnd: '2026-11-07', appOrigin: null })).toEqual({ refused: 'not_your_store' })
  })

  it('offers the bar no store', () => {
    expect(storesOfReport(pickers, places)).toEqual([])
  })
})
