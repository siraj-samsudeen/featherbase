import { afterEach, expect, it } from 'vitest'

// public/help/help.js is the script Tasker's nested help document loads by a
// relative path. The server tests prove the document and the script are served
// (apps/server/test/runtime-packages.test.ts, PKG-R4); a browser resolving the
// relative path is browser-only (#1080). Here: what the script does once run.
afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

it('the help document script marks the page as ready', async () => {
  const dataset: Record<string, string> = {}
  ;(globalThis as { document?: unknown }).document = { body: { dataset } }
  // @ts-expect-error -- a plain script with no type declarations
  await import('../public/help/help.js')
  expect(dataset.taskerHelp).toBe('ready')
})
