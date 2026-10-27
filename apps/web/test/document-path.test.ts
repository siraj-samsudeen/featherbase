// #642 (E4): a page's frame policy is the one its document was loaded with, so
// a page with its own policy (the Sales Target report, until B9) is entered by
// a full load when the document was loaded at another page.
import { describe, expect, test } from 'vitest'
import { loadedElsewhere } from '../src/lib/document-path'

const REPORT = '/featherbase/sales-target'
const loadedAt = (url: string) => [{ name: url }]

describe('loadedElsewhere', () => {
  test('a document loaded at another page was loaded elsewhere', () => {
    expect(loadedElsewhere(REPORT, loadedAt('https://dash.example.com/featherbase/login?next=%2F'))).toBe(true)
  })

  test('a document loaded at the page itself was not, whatever its query', () => {
    expect(loadedElsewhere(REPORT, loadedAt(`https://dash.example.com${REPORT}?store=12`))).toBe(false)
  })

  test('a browser that does not say where the document was loaded is taken at its word', () => {
    expect(loadedElsewhere(REPORT, [])).toBe(false)
  })
})
