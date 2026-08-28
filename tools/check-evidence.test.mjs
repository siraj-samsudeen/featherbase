// Mutation tests for tools/check-evidence.mjs — node's built-in runner, no
// dependencies, same as the checker.
//
//     node --test tools/
//
// The question every case here asks is the owner's, from the PR #239 review:
// *can a future contributor make an unsupported claim look green?* Each test
// takes a passing fixture tree, applies ONE mutation a contributor could
// plausibly make — delete the `**IDs:**` line, flip a test to `.skip`, move
// an issue number into a comment — and asserts the checker now FAILS, naming
// the thing that broke. A checker with no such tests is itself an
// unsupported claim.
//
// Fixtures are written to a fresh temp tree per case, so nothing here reads
// the repo's real specs; `node tools/check-evidence.mjs` covers those.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { checkEvidence, parseTestFile, idsInTitle } from './check-evidence.mjs'

// ------------------------------------------------------------------ harness

/** Write `files` into a throwaway tree and run the checker over it. */
function run(files, resultFiles = []) {
  const root = mkdtempSync(join(tmpdir(), 'check-evidence-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = join(root, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
    return checkEvidence({
      root,
      requiredSpecDirs: ['specs'],
      watchedSpecDirs: ['design'],
      testDirs: ['tests'],
      resultFiles,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Every failure message joined — for asserting what the run complained about. */
const said = (result) => result.failures.join('\n')

function assertPasses(result) {
  assert.deepEqual(result.failures, [], `expected a clean run, got:\n${said(result)}`)
}

function assertFails(result, ...fragments) {
  assert.ok(result.failures.length > 0, 'expected at least one failure, got none')
  for (const fragment of fragments) {
    assert.ok(
      said(result).includes(fragment),
      `expected a failure mentioning ${JSON.stringify(fragment)}, got:\n${said(result)}`,
    )
  }
}

// ----------------------------------------------------------- the base tree
//
// One spec with four obligations, each in a different evidence state, and the
// tests that back them. This tree passes; every case below mutates one thing.

const SPEC = `# Feature: Fixtures

**IDs:** \`FIX-J*\` journeys · \`FIX-R*\` rules · \`FIX-I*\` invariants

## FIX-J1 — the journey

> evidence: proven — the browser walk

## FIX-R1 — a rule proved by a differently-named test

> evidence: proven via FIX-901 — the property suite carries the legacy ID

## FIX-R2 — a rule with a known defect

> evidence: pinned #42 — the expected-failing test pins it

## FIX-I1 — an unproved invariant

> evidence: gap — no reconciliation test yet
`

const TESTS = `import { describe, it, test } from 'vitest'

describe('FIX-J1: the journey', () => {
  test('FIX-J1: the walk end to end', () => {})
})

it('FIX-901: the naming property', () => {})

// pins-gap #42: today the guard is missing; fixing it flips this to a plain
// \`it\` in the same change.
it.fails('FIX-R2: the guard holds at the boundary (pins #42)', () => {})
`

const base = () => ({ 'specs/0001-fixtures.md': SPEC, 'tests/fixtures.test.ts': TESTS })

/** The base tree with one file replaced. */
const withFile = (rel, content) => ({ ...base(), [rel]: content })

function vitestResult(assertions) {
  return JSON.stringify({
    testResults: [{ name: 'tests/fixtures.test.ts', assertionResults: assertions }],
  })
}

function playwrightResult(status = 'passed', idOnSuite = false, expectedStatus = 'passed') {
  return JSON.stringify({
    suites: [
      {
        title: 'fixtures.spec.ts',
        suites: [
          {
            title: idOnSuite ? 'FIX-J1: the journey' : 'the journey',
            specs: [
              {
                title: idOnSuite ? 'the walk end to end' : 'FIX-J1: the walk end to end',
                tests: [{ projectName: 'chromium', expectedStatus, results: [{ status }] }],
              },
            ],
          },
        ],
      },
    ],
  })
}

const RUNTIME_FILES = ['results/vitest.json', 'results/playwright.json']

function withRuntime({
  journey = 'passed',
  includeJourney = true,
  rule = 'passed',
  idOnSuite = false,
  journeyExpectedStatus = 'passed',
} = {}) {
  const files = {
    ...base(),
    'results/vitest.json': vitestResult([
      {
        ancestorTitles: [],
        title: 'FIX-901: the naming property',
        status: rule,
      },
    ]),
  }
  if (includeJourney) {
    files['results/playwright.json'] = playwrightResult(
      journey,
      idOnSuite,
      journeyExpectedStatus,
    )
  }
  else files['results/playwright.json'] = JSON.stringify({ suites: [] })
  return files
}

// ------------------------------------------------------------------- (f) ok

test('(f) the happy path passes, and counts what it saw', () => {
  const result = run(base())
  assertPasses(result)
  assert.equal(result.total, 4)
  assert.equal(result.specs.length, 1)
  assert.equal(result.testFiles, 1)
  assert.equal(result.byStatus.get('proven'), 2)
  assert.equal(result.byStatus.get('pinned'), 1)
  assert.equal(result.byStatus.get('gap'), 1)
})

// ------------------------------------------- runtime execution evidence (#241)

test('runtime results accept a passed proof across combined runner reports', () => {
  const result = run(withRuntime(), RUNTIME_FILES)
  assertPasses(result)
  assert.equal(result.runtimeTests, 2)
  assert.equal(result.resultFiles, 2)
})

test('a dynamically skipped proof fails runtime evidence', () => {
  const result = run(withRuntime({ journey: 'skipped' }), RUNTIME_FILES)
  assertFails(result, 'FIX-J1 is marked "proven"', 'every matching concrete test was skipped')
})

test('a missing or runner-excluded proof fails runtime evidence', () => {
  const result = run(withRuntime({ includeJourney: false }), RUNTIME_FILES)
  assertFails(result, 'FIX-J1 is marked "proven"', 'no concrete test', 'combined runtime results')
})

test('an ID on a suite title propagates to its executed descendant', () => {
  // The concrete Playwright spec title carries no ID. Its parent suite does,
  // so the executed leaf is the runtime evidence for FIX-J1.
  const result = run(withRuntime({ idOnSuite: true }), RUNTIME_FILES)
  assertPasses(result)
})

test('a failed test still counts as executed; its runner remains responsible for red', () => {
  const result = run(withRuntime({ journey: 'failed', rule: 'failed' }), RUNTIME_FILES)
  assertPasses(result)
})

test('a Playwright expected failure is not runtime proof', () => {
  const result = run(
    withRuntime({ journey: 'failed', journeyExpectedStatus: 'failed' }),
    RUNTIME_FILES,
  )
  assertFails(result, 'FIX-J1 is marked "proven"', 'no concrete test')
})

test('an expected-failure child cannot counterfeit runtime proof for its suite ID', () => {
  const tests = TESTS.replace(
    "  test('FIX-J1: the walk end to end', () => {})",
    "  test('FIX-J1: the walk end to end', () => {})\n" +
      "  test.fails('FIX-J1.pin: known broken edge', () => {})",
  )
  const files = {
    ...base(),
    'tests/fixtures.test.ts': tests,
    'results/vitest.json': vitestResult([
      {
        ancestorTitles: ['FIX-J1: the journey'],
        title: 'FIX-J1: the walk end to end',
        status: 'skipped',
      },
      {
        ancestorTitles: ['FIX-J1: the journey'],
        title: 'FIX-J1.pin: known broken edge',
        // Vitest inverts `.fails`: the assertion's expected failure reports
        // as passed, while the suite stays green.
        status: 'passed',
      },
      {
        ancestorTitles: [],
        title: 'FIX-901: the naming property',
        status: 'passed',
      },
    ]),
    'results/playwright.json': JSON.stringify({ suites: [] }),
  }
  const result = run(files, RUNTIME_FILES)
  assertFails(result, 'FIX-J1 is marked "proven"', 'every matching concrete test was skipped')
})

// ------------------------------------------- (a) a declared ID with no verdict

test('(a) an obligation declared with no evidence line fails', () => {
  const result = run(
    withFile(
      'specs/0001-fixtures.md',
      SPEC + '\n## FIX-R3 — a rule someone forgot to rule on\n\nProse, no verdict.\n',
    ),
  )
  assertFails(result, 'FIX-R3 is declared with no evidence line')
})

// ------------------------------ (b) a spec silently opting out of the check

test('(b) deleting the **IDs:** line fails, naming the file', () => {
  // The owner's reproduction: without this, the spec — verdicts and all —
  // vanished from the run and the run still said "passed".
  const opted = SPEC.split('\n').filter((l) => !l.startsWith('**IDs:**')).join('\n')
  const result = run(withFile('specs/0001-fixtures.md', opted))
  assertFails(result, 'specs/0001-fixtures.md', 'declares no participation')
})

test('(b) an **IDs:** line naming no pattern fails rather than owning nothing', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC.replace(/\*\*IDs:\*\*.*/, '**IDs:** everything')),
  )
  assertFails(result, 'names no `pattern`')
})

test('(b) a doc under docs/specs may opt out explicitly, with a reason', () => {
  const result = run({
    ...base(),
    'specs/README.md': '# Specs\n\n**Evidence mode:** excluded — an index.\n',
  })
  assertPasses(result)
})

test('(b) an explicit exclusion with no reason fails', () => {
  const result = run({
    ...base(),
    'specs/README.md': '# Specs\n\n**Evidence mode:** excluded\n',
  })
  assertFails(result, 'excluded from the evidence check with no reason')
})

test('(b) an excluded doc may not also carry verdicts', () => {
  const result = run({
    ...base(),
    'specs/README.md':
      '# Specs\n\n**Evidence mode:** excluded — an index.\n\n## FIX-R9 — sneaky\n\n> evidence: proven — nothing backs this\n',
  })
  assertFails(result, 'cannot claim proof and opt out')
})

test('(b) declaring both IDs and an exclusion fails', () => {
  const result = run({
    ...base(),
    'specs/0002-both.md':
      '# Both\n\n**IDs:** `TWO-R*` rules\n\n**Evidence mode:** excluded — hedging.\n',
  })
  assertFails(result, 'accountable or exempt, never both')
})

test('(b) an unknown evidence mode fails', () => {
  const result = run({
    ...base(),
    'specs/0002-mode.md': '# Mode\n\n**Evidence mode:** partial — sort of.\n',
  })
  assertFails(result, 'unknown evidence mode "partial"')
})

test('(b) a watched design doc carrying verdicts must declare; a plain note need not', () => {
  const plain = run({ ...base(), 'design/notes.md': '# Notes\n\nJust thinking out loud.\n' })
  assertPasses(plain)

  const bearing = run({
    ...base(),
    'design/notes.md': '# Notes\n\n## FIX-R8 — smuggled in\n\n> evidence: proven — trust me\n',
  })
  assertFails(bearing, 'design/notes.md', 'declares no "**IDs:**" line')
})

// --------------------------------------------- (c) skipped tests as "proof"

test('(c) a proven ID whose only test is `.skip` fails', () => {
  // The owner's reproduction: flipping the one proving test to `test.skip`
  // left all verdicts green. The enclosing `describe` still runs and still
  // carries the ID, so the suite rule has to hold too — otherwise the
  // container would go on proving what nothing executes.
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace("test('FIX-J1", "test.skip('FIX-J1")),
  )
  assertFails(
    result,
    'FIX-J1 is marked "proven"',
    'not executable',
    'a suite with no executable test inside it',
  )
})

test('(c) `.todo` is not proof', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace("test('FIX-J1", "test.todo('FIX-J1")),
  )
  assertFails(result, 'FIX-J1 is marked "proven"', 'not executable')
})

test('(c) a title inside a `describe.skip` block is not proof', () => {
  const result = run(
    withFile(
      'tests/fixtures.test.ts',
      TESTS.replace("describe('FIX-J1", "describe.skip('FIX-J1"),
    ),
  )
  // Both the suite title and the test inside it stop counting.
  assertFails(result, 'FIX-J1 is marked "proven"', 'not executable')
})

test('(c) a conditional suite (`describe.skipIf`) is not static proof either', () => {
  const result = run(
    withFile(
      'tests/fixtures.test.ts',
      TESTS.replace("describe('FIX-J1", "describe.skipIf(!process.env.URL)('FIX-J1"),
    ),
  )
  assertFails(result, 'FIX-J1 is marked "proven"')
})

test('(c) an unknown modifier disqualifies rather than counting by default', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace("test('FIX-J1", "test.someday('FIX-J1")),
  )
  assertFails(result, 'FIX-J1 is marked "proven"', 'not executable')
})

test('(c) an executable modifier still counts', () => {
  for (const mod of ['concurrent', 'only', 'sequential']) {
    const result = run(
      withFile('tests/fixtures.test.ts', TESTS.replace("test('FIX-J1", `test.${mod}('FIX-J1`)),
    )
    assertPasses(result)
  }
})

// -------------------------------------------------------- (d) a dead alias

test('(d) a `via` alias no test title carries fails', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC.replace('via FIX-901', 'via FIX-902')),
  )
  assertFails(result, 'claims "via FIX-902"', 'no test title carries FIX-902')
})

test('(d) the alias must be executable proof, not just present', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace("it('FIX-901", "it.skip('FIX-901")),
  )
  assertFails(result, 'FIX-R1 is marked "proven"', 'not executable')
})

// ------------------------------------------------------ (e) counterfeit pins

test('(e) an issue number in a comment does not pin a defect', () => {
  // The owner's reproduction: issue numbers used to be harvested from
  // anywhere in any test file, so a stray `#42` satisfied the pin.
  const result = run(
    withFile(
      'tests/fixtures.test.ts',
      TESTS.replace(
        "it.fails('FIX-R2: the guard holds at the boundary (pins #42)', () => {})",
        "// TODO(#42): write the pinning test\nit('FIX-R2: the guard is unrelated', () => {})",
      ),
    ),
  )
  assertFails(result, 'FIX-R2 pins #42', 'expected-failure')
})

test('(e) flipping the pinning `it.fails` to `it.skip` fails', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace('it.fails(', 'it.skip(')),
  )
  assertFails(result, 'FIX-R2 pins #42', 'not executable')
})

test('(e) flipping the pinning `it.fails` to a plain `it` fails', () => {
  const result = run(withFile('tests/fixtures.test.ts', TESTS.replace('it.fails(', 'it(')))
  assertFails(result, 'FIX-R2 pins #42')
})

test('(e) the pinning title must carry the issue number, not just the ID', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace(' (pins #42)', '')),
  )
  assertFails(result, 'FIX-R2 pins #42')
})

test('(e) the pinning title must carry the pinned ID, not just the issue', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS.replace('FIX-R2: the guard', 'the guard')),
  )
  assertFails(result, 'FIX-R2 pins #42')
})

test('(e) a longer issue number does not satisfy a shorter pin', () => {
  const result = run(withFile('tests/fixtures.test.ts', TESTS.replace('#42)', '#420)')))
  assertFails(result, 'FIX-R2 pins #42')
})

test('(e) "pinned" with no issue number fails', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC.replace('pinned #42 —', 'pinned —')),
  )
  assertFails(result, 'marked "pinned" but names no issue')
})

// ------------------------------------- (g) an expected failure is not proof

test('(g) a `.fails` title does not satisfy a `proven` verdict', () => {
  const result = run(
    withFile(
      'specs/0001-fixtures.md',
      SPEC.replace(
        '> evidence: pinned #42 — the expected-failing test pins it',
        '> evidence: proven — the expected-failing test, laundered',
      ),
    ),
  )
  assertFails(result, 'FIX-R2 is marked "proven"', 'expected failure, not proof')
})

// ------------------------------------------------- the rest of the contract

test('a verdict with an unknown status fails', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC.replace('evidence: gap —', 'evidence: mostly —')),
  )
  assertFails(result, 'unknown evidence status "mostly"')
})

test('a gap or pin with no reason fails', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC.replace('gap — no reconciliation test yet', 'gap')),
  )
  assertFails(result, 'FIX-I1 is marked "gap" with no reason')
})

test('two verdicts for one ID fail', () => {
  const result = run(
    withFile('specs/0001-fixtures.md', SPEC + '\n> evidence FIX-J1: gap — second opinion\n'),
  )
  assertFails(result, 'a second evidence line')
})

test('a test naming an ID the spec never declares is a warning, not a failure', () => {
  const result = run(
    withFile('tests/fixtures.test.ts', TESTS + "\nit('FIX-R7: an orphan', () => {})\n"),
  )
  assertPasses(result)
  assert.ok(result.warnings.join('\n').includes('FIX-R7'))
})

test('verdicts shown inside a fenced block are documentation, not claims', () => {
  const result = run({
    ...base(),
    'design/format.md':
      '# Format\n\nWrite it like this:\n\n```\n> evidence: proven — what ran\n```\n',
  })
  assertPasses(result)
})

// ---------------------------------------------- the declaration scanner itself

test('an unrelated `.test()` call is not a test declaration', () => {
  // `/re/.test('FIX-J1: …')` used to register as a title and could inject any
  // ID into the join table.
  const { decls } = parseTestFile('x.test.ts', "if (RE.test('FIX-J1: not a test')) {}\n")
  assert.deepEqual(decls, [])
})

test('braces and parens inside strings, comments and regexes do not move the scan', () => {
  const src = [
    "describe.skip('FIX-J1: hidden', () => {",
    "  const noise = ')})' // ) } ) and /* ) */",
    '  const re = /[)}]+/g',
    "  it('FIX-J1: still hidden', () => {})",
    '})',
    "it('FIX-J1: visible', () => {})",
  ].join('\n')
  const { decls, errors } = parseTestFile('x.test.ts', src)
  assert.deepEqual(errors, [])
  const byTitle = Object.fromEntries(decls.map((d) => [d.title, d.executable]))
  assert.equal(byTitle['FIX-J1: hidden'], false)
  assert.equal(byTitle['FIX-J1: still hidden'], false)
  assert.equal(byTitle['FIX-J1: visible'], true, 'the scan must end at the suite it skipped')
})

test('an unreadable skipped suite is reported, never guessed at', () => {
  const { errors } = parseTestFile('x.test.ts', "describe.skip('FIX-J1: truncated', () => {\n")
  assert.equal(errors.length, 1)
  assert.match(errors[0], /could not read the extent/)
})

test('idsInTitle reads families, sub-IDs and slash continuations', () => {
  assert.deepEqual([...idsInTitle('RVT-R2/R3: both')], ['RVT-R2', 'RVT-R3'])
  assert.deepEqual([...idsInTitle('IMP-R2.16-digit: precision')], ['IMP-R2.16-digit'])
})
