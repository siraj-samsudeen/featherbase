import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inScope, scan, RETIRED_WORDS } from './check-vocabulary.mjs'

// Built at runtime so this file does not itself trip the repository scan.
const D = ['De', 'sk'].join('')

test('the retired list names the word and its replacement', () => {
  assert.deepEqual(RETIRED_WORDS.map((w) => [w.word, w.replacement]), [[D, 'Admin']])
})

test('the retired word is flagged as a whole word in any case, with line and replacement', () => {
  const hits = scan(`intro\nlocked in the ${D}\n${D.toUpperCase()} saves\n${D.toLowerCase()}`)
  assert.deepEqual(hits.map((h) => [h.line, h.word, h.replacement]), [
    [2, D, 'Admin'],
    [3, D, 'Admin'],
    [4, D, 'Admin'],
  ])
  assert.equal(hits[0].text, `locked in the ${D}`)
})

test('longer words that contain it are not flagged', () => {
  assert.deepEqual(scan(`${D}top app, ${D}s, Stand${D.toLowerCase()}`), [])
})

test("Frappe's own Desk, the Help Desk product and the glossary's former-name line pass", () => {
  assert.deepEqual(scan(`looks like Frappe's ${D}`), [])
  assert.deepEqual(scan(`Frappes ${D} SPA`), [])
  assert.deepEqual(scan(`the Help ${D} app`), [])
  assert.deepEqual(scan(`the Help${D} app`), [])
  assert.deepEqual(scan(`**Admin** (formerly Frappe's "${D}")`), [])
})

test('a line carrying a vocabulary-allow comment passes', () => {
  assert.deepEqual(scan(`${D} SPA <!-- vocabulary-allow: upstream -->`), [])
  assert.deepEqual(scan(`// ${D} here vocabulary-allow`), [])
})

test('scope: app sources, client apps, openspec, docs and root markdown, minus the allowlisted files', () => {
  for (const f of ['apps/web/src/index.css', 'apps/server/src/a/b.ts', 'openspec/changes/x/design.md', 'docs/VISION.md', 'README.md', 'CLAUDE.md', 'client-apps/x/y/README.md', 'client-apps/x/CLAUDE.md']) {
    assert.equal(inScope(f), true, f)
  }
  for (const f of ['CONTEXT.md', 'apps/web/e2e/a.spec.ts', 'tools/x.mjs', 'apps/web/README.md', 'sub/README.md']) {
    assert.equal(inScope(f), false, f)
  }
})
