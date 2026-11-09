// What the warehouse browser keeps in the browser (#969): a copy draft and the
// place last open. Anything that is not the JSON it wrote reads as nothing
// kept, rather than breaking the page.
import { afterEach, describe, expect, test } from 'vitest'
import { lastPlace, readCopyDraft } from '../src/lib/warehouse'

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('kept warehouse state that is not readable', () => {
  test('a copy draft that is not JSON reads as no draft', () => {
    sessionStorage.setItem('fb-warehouse-copy::sales/main/stores', '{not json')
    expect(readCopyDraft('sales/main/stores')).toBeUndefined()
  })

  test('a last place that is not JSON reads as no place', () => {
    localStorage.setItem('fb-warehouse-place::web-wh', '{not json')
    expect(lastPlace('web-wh')).toEqual({})
  })
})
