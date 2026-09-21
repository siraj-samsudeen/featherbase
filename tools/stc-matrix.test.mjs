// Mutation tests for tools/stc-matrix.mjs — node's built-in runner, no
// dependencies, same as the checker.
//
//     node --test tools/*.test.mjs
//
// Each case asks: *can a future contributor make a broken linkage look green?*
// Each takes a passing fixture tree, applies ONE mutation someone could
// plausibly make — rename a requirement and leave the marker behind, add a
// requirement nothing tests, nest a marker one directory deeper — and asserts
// the checker now fails, naming the thing that broke.
//
// A checker with no such tests is itself an unsupported claim: the Python
// original shipped a skip expression that was vacuously true and walked
// nothing, reporting "nothing to check" as success. `finds a marker nested
// below the tree root` is that bug's pin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { stcMatrix } from './stc-matrix.mjs'

// ------------------------------------------------------------------ harness

/** Write `files` into a throwaway tree and run the matrix over it. */
function run(files, specRoots = ['openspec/specs']) {
  const root = mkdtempSync(join(tmpdir(), 'stc-matrix-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = join(root, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
    return stcMatrix({
      root,
      specRoots,
      codeDirs: ['src'],
      testDirs: ['test'],
      baseline: 'stc-baseline.txt',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const said = (result) => result.failures.join('\n')

function assertPasses(result) {
  assert.deepEqual(result.failures, [], `expected a clean run, got:\n${said(result)}`)
}

function assertFails(result, ...fragments) {
  assert.ok(result.failures.length > 0, 'expected at least one failure, got none')
  for (const fragment of fragments)
    assert.ok(
      said(result).includes(fragment),
      `expected a failure mentioning ${JSON.stringify(fragment)}, got:\n${said(result)}`,
    )
}

const SPEC = `# Deletion

## Requirements

### Requirement: schema_reference_blocks
A referenced Table SHALL NOT be deletable.

#### Scenario: zero_rows_still_blocks
- **WHEN** the referencing Table has no rows
- **THEN** deletion is still refused.
`

const CODE = `export function deleteTable() {
  // @spec schema_reference_blocks
  return refuse()
}
`

const TEST = `test('a referenced Table is refused', () => {
  // @spec schema_reference_blocks
  expect(refused).toBe(true)
})
`

const clean = () => ({
  'openspec/specs/table-deletion/spec.md': SPEC,
  'src/table-engine.ts': CODE,
  'test/table-deletion.test.ts': TEST,
  'stc-baseline.txt': '',
})

// -------------------------------------------------------------------- cases

test('a requirement with a code marker and a test marker is clean', () => {
  const result = run(clean())
  assertPasses(result)
  assert.equal(result.rows.length, 1)
  assert.ok(result.rows[0].hasCode && result.rows[0].hasTest)
})

test('an active delta spec owns markers before the change is archived', () => {
  const result = run({
    'openspec/changes/add-rule/specs/capability/spec.md': SPEC,
    'src/feature.ts': CODE,
    'test/feature.test.ts': TEST,
  }, ['openspec/specs', 'openspec/changes'])
  assertPasses(result)
})

test('proposal prose and archived change history are not behavior contracts', () => {
  const result = run({
    'openspec/changes/add-rule/proposal.md': SPEC,
    'openspec/changes/archive/2026-09-21-add-rule/specs/capability/spec.md': SPEC,
  }, ['openspec/specs', 'openspec/changes'])
  assert.deepEqual([...result.requirements], [])
  assertPasses(result)
})

test('renaming the requirement leaves the markers orphaned, and the run fails', () => {
  const files = clean()
  files['openspec/specs/table-deletion/spec.md'] = SPEC.replace(
    'Requirement: schema_reference_blocks',
    'Requirement: schema_reference_refuses',
  ).replace('Scenario: zero_rows_still_blocks', 'Scenario: zero_rows_still_refuses')
  const result = run(files)
  assertFails(result, 'orphan code marker @spec schema_reference_blocks')
  assertFails(result, 'orphan test marker @spec schema_reference_blocks')
})

test('a requirement no test marks is a new gap beyond the baseline', () => {
  const files = clean()
  files['test/table-deletion.test.ts'] = "test('says nothing', () => {})\n"
  assertFails(run(files), 'new coverage gap beyond the baseline: no_test schema_reference_blocks')
})

test('a gap already recorded in the baseline does not fail', () => {
  const files = clean()
  files['test/table-deletion.test.ts'] = "test('says nothing', () => {})\n"
  files['stc-baseline.txt'] = 'no_test schema_reference_blocks\n'
  const result = run(files)
  assertPasses(result)
  assert.deepEqual(result.newGaps, [])
})

test('a closed gap is reported so the baseline can ratchet down', () => {
  const files = clean()
  files['stc-baseline.txt'] = 'no_test schema_reference_blocks\n'
  const result = run(files)
  assertPasses(result)
  assert.deepEqual(result.closed, ['no_test schema_reference_blocks'])
})

test('a scenario marker satisfies its requirement, so a test may cite the narrower slug', () => {
  const files = clean()
  files['test/table-deletion.test.ts'] = TEST.replace(
    '@spec schema_reference_blocks',
    '@spec schema_reference_blocks.zero_rows_still_blocks',
  )
  const result = run(files)
  assertPasses(result)
  assert.ok(result.rows[0].hasTest)
})

test('a marker in the code tree does not satisfy the test vertex', () => {
  const files = clean()
  delete files['test/table-deletion.test.ts']
  assertFails(run(files), 'no_test schema_reference_blocks')
})

test('a marker in the test tree does not satisfy the code vertex', () => {
  const files = clean()
  delete files['src/table-engine.ts']
  assertFails(run(files), 'no_code schema_reference_blocks')
})

test('finds a marker nested below the tree root — the walker must not skip everything', () => {
  const files = clean()
  delete files['src/table-engine.ts']
  files['src/actions/nested/deep/delete-table.ts'] = CODE
  const result = run(files)
  assertPasses(result)
  assert.match(result.rows[0].code[0], /^src\/actions\/nested\/deep\/delete-table\.ts:2$/)
})

test('a bare `spec:` is not a marker, so Playwright configs raise no false orphan', () => {
  const files = clean()
  files['src/config.ts'] = "export default { spec: 'e2e/**/*.spec.ts', testMatch: 'spec: nothing' }\n"
  assertPasses(run(files))
})

test('node_modules is never walked', () => {
  const files = clean()
  files['src/node_modules/vendored/index.ts'] = '// @spec a_slug_that_does_not_exist\n'
  assertPasses(run(files))
})

test('a marker is reported at its file and line, so the reviewer can open it', () => {
  const result = run(clean())
  assert.deepEqual(result.rows[0].code, ['src/table-engine.ts:2'])
  assert.deepEqual(result.rows[0].test, ['test/table-deletion.test.ts:2'])
})

test('a `#` comment in the baseline explains a gap without becoming one', () => {
  const files = clean()
  files['test/table-deletion.test.ts'] = "test('says nothing', () => {})\n"
  files['stc-baseline.txt'] =
    '# no journey owns a single line — the gap is the shape of the promise\nno_test schema_reference_blocks\n'
  const result = run(files)
  assertPasses(result)
  assert.deepEqual(result.closed, [])
})
