// #1385 (slice 4): one chrome. The platform draws the sidebar's default pieces (the app switcher, Search or
// Command, View As, the account, Help, Theme, Collapse, the bell, Recently Opened, Frequent and Saved Views)
// and every app's rows; an app gives its rows as data (its manifest's `sidebar`, and setSidebarRows) and never
// markup. This guard reads the apps' source, like record-links-guard.test.ts:
// - nothing is put inside <featherbase-sidebar>, which draws only what the platform renders;
// - no app writes the frame's own markers (a rail fold, a sidebar count), which only the platform's rows carry;
// - no app control is named after a default piece (its words, its aria-label or its title), beyond the few
//   counted below, which may only go down;
// - no manifest's sidebar names a row or a section after one.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { SIDEBAR_DEFAULT_PIECES, namesDefaultPiece, type SidebarDeclaration } from 'shared'

const ROOT = join(__dirname, '../../..')
const APPS = ['example-apps', 'client-apps', 'test-apps']

/** An app's own screens: not its tests, stories or design prototypes, which are never shipped. */
function appScreens(): string[] {
  const listed = execFileSync('git', ['ls-files', ...APPS], { cwd: ROOT, encoding: 'utf8' })
  return listed.split('\n').filter((file) => /\.(tsx|jsx)$/.test(file) && !/\.(test|stories)\.tsx$/.test(file) && !/\/prototype\//.test(file))
}

const source = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const PIECES = SIDEBAR_DEFAULT_PIECES.map((piece) => piece.replace(/ /g, '\\s+')).join('|')
/** A control named after a default piece: its words, or its aria-label or title. */
const NAMED_AFTER_PIECE = new RegExp(`>\\s*(?:${PIECES})\\s*<|(?:aria-label|title)=["'{\`]+\\s*(?:${PIECES})\\s*["'}\`]`, 'gi')

/** Controls named like a default piece on 28-Nov-2026, when the rule arrived; each is the page's own. */
const ALLOWED: Record<string, number> = {
  // a tab on the review page that explains the page, not the platform's Help
  'client-apps/jeyarama/forecasting/src/shared/Attention.tsx': 1,
}

test('no app puts anything inside the shared sidebar: its rows are data the platform draws', () => {
  const filled: string[] = []
  for (const file of appScreens()) {
    const text = source(file)
    if (/createElement\(\s*['"]featherbase-sidebar['"]\s*,\s*(?:\{[^{}]*\}|null|undefined)\s*,/.test(text)) filled.push(`${file}: createElement('featherbase-sidebar', …) has children`)
    if (/<featherbase-sidebar\b[^>]*[^/]>(?!\s*<\/featherbase-sidebar>)/.test(text)) filled.push(`${file}: <featherbase-sidebar> has children`)
  }
  expect(filled).toEqual([])
})

test("no app writes the frame's own markers, which only the platform's rows carry", () => {
  const marked = appScreens().filter((file) => /data-(?:rail-[a-z-]+|sidebar-count|sidebar-item)\b/.test(source(file)))
  expect(marked).toEqual([])
})

test('no app names a control after a default piece, beyond what was there when the rule arrived', () => {
  const grown: string[] = []
  for (const file of appScreens()) {
    const found = source(file).match(NAMED_AFTER_PIECE) ?? []
    if (found.length > (ALLOWED[file] ?? 0)) grown.push(`${file}: ${found.join(', ')} — the platform draws that piece`)
  }
  expect(grown).toEqual([])
})

test('a file whose copy was removed has its allowance lowered, so the count only goes down', () => {
  const stale: string[] = []
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    let found = 0
    try { found = source(file).match(NAMED_AFTER_PIECE)?.length ?? 0 } catch { /* the file is gone */ }
    if (found < allowed) stale.push(`${file}: ${found} now, ${allowed} allowed — lower it to ${found}`)
  }
  expect(stale).toEqual([])
})

test("no manifest's sidebar names a row or a section after a default piece", () => {
  const listed = execFileSync('git', ['ls-files', ...APPS.map((dir) => `${dir}/**/featherbase.json`)], { cwd: ROOT, encoding: 'utf8' })
  const named: string[] = []
  const manifests = listed.split('\n').filter(Boolean)
  for (const file of manifests) {
    const sidebar = (JSON.parse(source(file)) as { sidebar?: SidebarDeclaration }).sidebar
    for (const section of sidebar?.sections ?? []) {
      const words = [section.title ?? '', ...section.items.flatMap((item) => [item.label, ...(item.children ?? []).map((child) => child.label)])]
      for (const word of words.filter(namesDefaultPiece)) named.push(`${file}: ${word}`)
    }
  }
  expect(manifests.length).toBeGreaterThan(0)
  expect(named).toEqual([])
})

test('the guard finds a copy of a default piece where one is drawn', () => {
  expect(`<button>Recently Opened</button>`.match(NAMED_AFTER_PIECE)).toHaveLength(1)
  expect(`<button aria-label="Theme" />`.match(NAMED_AFTER_PIECE)).toHaveLength(1)
  expect(`<button>Saved views</button>`.match(NAMED_AFTER_PIECE)).toHaveLength(1)
  expect(`<button>Theme colours</button>`.match(NAMED_AFTER_PIECE)).toBeNull()
})
