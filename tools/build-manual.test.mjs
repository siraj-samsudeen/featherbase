// Mutation tests for tools/build-manual.mjs's spec parser — node's built-in
// runner, no dependencies, same as the generator.
//
//     node --test tools/
//
// build-manual.mjs turns docs/specs/0008-spreadsheet-import.md into the
// field guide at docs/manual/spreadsheet-import.html by *parsing* the spec's
// structure — step tables, evidence verdicts, step ids — rather than
// treating it as free-form prose. "THE PARSER IS DELIBERATELY BORING": when
// the spec's shape surprises it, it must FAIL naming the offending line
// rather than guess and quietly drop something. Each test below takes the
// real spec, mutates ONE line a contributor could plausibly get wrong, and
// asserts parseSpec refuses it, naming the line. A parser with no such tests
// is itself an unproven claim.
//
// Every case reads the real docs/specs/0008-spreadsheet-import.md and mutates
// an in-memory copy of its text — nothing here ever writes to the spec file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpec } from './build-manual.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SPEC_PATH = join(ROOT, 'docs/specs/0008-spreadsheet-import.md')

// The real spec, read once. Every test mutates a copy of its *lines* array —
// never this string, and never the file on disk.
const REAL_SPEC = readFileSync(SPEC_PATH, 'utf8')
const REAL_LINES = REAL_SPEC.split('\n')

/**
 * The real spec with one line changed: `oldFragment` must appear verbatim on
 * 1-indexed `lineNo`, or the mutation is rejected rather than silently
 * missing its target (the same discipline check-evidence.test.mjs uses for
 * its fixture edits — a `.replace()` that finds nothing is not a mutation).
 */
function mutate(lineNo, oldFragment, newFragment) {
  const lines = [...REAL_LINES]
  const i = lineNo - 1
  assert.ok(
    lines[i]?.includes(oldFragment),
    `expected line ${lineNo} to contain ${JSON.stringify(oldFragment)}, got ${JSON.stringify(lines[i])}`,
  )
  lines[i] = lines[i].replace(oldFragment, newFragment)
  return lines.join('\n')
}

/** Assert `parseSpec(md)` throws, its message naming every given fragment. */
function assertRefused(md, ...fragments) {
  assert.throws(
    () => parseSpec(md),
    (err) => {
      for (const fragment of fragments) {
        assert.ok(
          err.message.includes(fragment),
          `expected the refusal to mention ${JSON.stringify(fragment)}, got:\n${err.message}`,
        )
      }
      return true
    },
  )
}

// -------------------------------------------------- (1) unknown status word

test('an evidence verdict with an unknown status word is refused, naming the line', () => {
  // Line 97 opens IMP-J1's verdict: "> evidence: proven — the DSL walk …".
  const md = mutate(97, 'proven', 'maybeish')
  assertRefused(md, 'docs/specs/0008-spreadsheet-import.md:97', 'unknown status "maybeish"')
})

// ------------------------------------------------ (2) wrong step-row shape

test('a journey step row with the wrong cell count is refused, naming the line', () => {
  // Line 106 is IMP-J1's first step row, 5 cells wide (the last, Rules, is
  // empty). Dropping its trailing empty cell leaves 4.
  const md = mutate(
    106,
    ' | anything from a previous import is still on screen | |',
    ' | anything from a previous import is still on screen |',
  )
  assertRefused(
    md,
    'docs/specs/0008-spreadsheet-import.md:106',
    'IMP-J1 step row has 4 cells, expected 5',
  )
})

// ---------------------------------------------------- (3) wrong step header

test('a step table with a wrong header is refused', () => {
  // Line 104 is IMP-J1's header row: swap the last two columns.
  const md = mutate(104, '| Bug if | Rules |', '| Rules | Bug if |')
  assertRefused(
    md,
    'docs/specs/0008-spreadsheet-import.md:104',
    "IMP-J1's step table header is",
    'expected [# | Where / do | Must observably see | Bug if | Rules]',
  )
})

// ------------------------------------------------------- (4) step id shape

test('a step id not shaped J<n>.<n> (optional letter suffix) is refused', () => {
  for (const bad of ['J1.x1', 'J2.x3', 'Q1.1']) {
    const md = mutate(106, '| J1.1 |', `| ${bad} |`)
    assertRefused(
      md,
      'docs/specs/0008-spreadsheet-import.md:106',
      `"${bad}" is not a step id`,
    )
  }
})

test('a step id with a letter suffix, e.g. "J2.3b", is accepted', () => {
  const md = mutate(106, '| J1.1 |', '| J2.3b |')
  const spec = parseSpec(md)
  const j1 = spec.journeys.find((j) => j.id === 'IMP-J1')
  assert.equal(j1.steps[0].id, 'J2.3b')
})

// ---------------------------------------------- (5) fixture manifest check
//
// Skipped deliberately: the manifest/on-disk reconciliation lives in
// fixtureCatalog() (build-manual.mjs, section 4), which reads
// docs/manual/fixtures/manifest.json and readdirSync() straight off disk. It
// takes no spec text and isn't reachable from parseSpec(md) — there is no
// in-memory mutation that exercises it, only a real filesystem one. Nothing
// to pin here at the parse layer.

// --------------------------------------------------------- (6) happy path

test('the real spec parses to the current tally', () => {
  const spec = parseSpec(REAL_SPEC)
  assert.equal(spec.journeys.length, 7)
  const stepCount = spec.journeys.reduce((n, j) => n + j.steps.length, 0)
  assert.equal(stepCount, 56)
  assert.equal(spec.rules.length, 11)
  // Same tally build-manual.mjs's main() prints: every journey's own verdict
  // plus its sub-verdicts, plus rules, invariants and hazards.
  const verdicts =
    spec.journeys.reduce((n, j) => n + 1 + j.subVerdicts.length, 0) +
    spec.rules.length +
    spec.invariants.length +
    spec.hazards.length
  assert.equal(verdicts, 25)
})
