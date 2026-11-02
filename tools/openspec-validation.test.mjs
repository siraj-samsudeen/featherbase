import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('strict OpenSpec validates executable Gherkin without accepting examples or missing outcomes', () => {
  const root = mkdtempSync(join(tmpdir(), 'featherbase-spec-validation-'))
  const spec = join(root, 'openspec/specs/example')
  mkdirSync(spec, { recursive: true })
  const validate = steps => {
    writeFileSync(join(spec, 'spec.md'), `# Example\n\n## Purpose\nPeople can explore the platform before choosing which applications to install.\n\n## Requirements\n\n### Requirement: Choose an application\nThe system SHALL install only the application the user chooses.\n\n#### Scenario: Explicit installation\n${steps}\n`)
    return spawnSync(process.execPath, [resolve('node_modules/@fission-ai/openspec/bin/openspec.js'), 'validate', 'example', '--type', 'spec', '--strict', '--no-interactive'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, OPENSPEC_TELEMETRY: '0' },
    })
  }
  try {
    for (const fence of ['```', '~~~~']) {
      const result = validate(`${fence}gherkin\nGiven the user has no apps\nWhen the user installs Tasker\nThen Tasker is installed\n${fence}`)
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    for (const steps of [
      '```gherkin\nGiven the user has no apps\nAnd the user opens the catalog\n```',
      '```text\nWHEN the user installs Tasker\nTHEN Tasker is installed\n```',
      '```gherkin\nGiven the user writes a note\n"""\nThen the note describes an outcome\n"""\n```',
    ]) assert.notEqual(validate(steps).status, 0, `Invalid scenario must still fail: ${steps}`)
    assert.equal(validate('- **WHEN** the user installs Tasker\n- **THEN** Tasker is installed').status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
