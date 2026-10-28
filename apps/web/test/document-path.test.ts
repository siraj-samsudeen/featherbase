// #642 (E4): a page's frame policy is the one its document was loaded with, so
// moving between a page with its own policy (the Sales Target report, until B9)
// and any other page takes a full load, in either direction (Codex round 1 on
// #643: leaving the report must drop its MotherDuck allowance).
import { describe, expect, test } from 'vitest'
import { crossesFramePolicy } from '../src/lib/document-path'

const REPORT = '/featherbase/sales-target'
const loadedAt = (path: string) => [{ name: `https://dash.example.com${path}` }]

describe('crossesFramePolicy', () => {
  test('entering the report from a document loaded at another page crosses', () => {
    expect(crossesFramePolicy(REPORT, loadedAt('/featherbase/login?next=%2F'))).toBe(true)
  })

  test('leaving the report for another page crosses', () => {
    expect(crossesFramePolicy('/featherbase/account/sign-in-methods', loadedAt(REPORT))).toBe(true)
  })

  test('the report within the document loaded at it does not, whatever its query', () => {
    expect(crossesFramePolicy(REPORT, loadedAt(`${REPORT}?store=12`))).toBe(false)
  })

  // Codex round 2 on #643: the router shows the report with a trailing slash too.
  test('entering the report written with a trailing slash crosses', () => {
    expect(crossesFramePolicy(`${REPORT}/`, loadedAt('/featherbase/login'))).toBe(true)
  })

  test('the report with and without a trailing slash is one page', () => {
    expect(crossesFramePolicy(REPORT, loadedAt(`${REPORT}/`))).toBe(false)
  })

  test('moving between two ordinary pages does not', () => {
    expect(crossesFramePolicy('/featherbase/admin', loadedAt('/featherbase/login'))).toBe(false)
  })

  test('a browser that does not say where the document was loaded is taken at its word', () => {
    expect(crossesFramePolicy(REPORT, [])).toBe(false)
  })
})
