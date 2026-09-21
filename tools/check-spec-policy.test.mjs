import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  COMMANDS,
  checkOpenSpecInstallation,
  checkSpecPolicy,
  checkWorkflowGuidance,
  WORKFLOWS,
} from './check-spec-policy.mjs'

function run(files, baseline = []) {
  const root = mkdtempSync(join(tmpdir(), 'check-spec-policy-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = join(root, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
    const baselinePath = join(root, 'tools/legacy-spec-baseline.txt')
    mkdirSync(dirname(baselinePath), { recursive: true })
    writeFileSync(baselinePath, `${baseline.join('\n')}\n`)
    return checkSpecPolicy({ root })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the frozen legacy set passes', () => {
  const path = 'docs/specs/0001-existing.md'
  assert.deepEqual(run({ [path]: '# Historical' }, [path]).failures, [])
})

test('a new Journey behavior spec fails with the OpenSpec destination', () => {
  // @spec competing_behavior_specs_are_rejected
  const existing = 'docs/specs/0001-existing.md'
  const added = 'docs/specs/0002-new-feature.md'
  const result = run({ [existing]: '# Historical', [added]: '# New behavior' }, [existing])
  assert.deepEqual(result.added, [added])
  assert.match(result.failures.join('\n'), /new competing behavior-spec document/)
  assert.match(result.failures.join('\n'), /openspec/)
})

test('a migrated path must leave the baseline so it cannot reappear', () => {
  const removed = 'docs/specs/0001-migrated.md'
  const result = run({}, [removed])
  assert.deepEqual(result.removed, [removed])
  assert.match(result.failures.join('\n'), /delete it from tools\/legacy-spec-baseline\.txt/)
})

test('design, ADR, research, and archived documents are outside the competing root', () => {
  const result = run({
    'docs/design/feature.md': '# Alternatives',
    'docs/adr/0010-decision.md': '# Decision',
    'docs/research/study.md': '# Evidence',
    'docs/archive/journey-specs/0001.md': '# History',
  })
  assert.deepEqual(result.failures, [])
})

const GUIDANCE = `
OpenSpec is Featherbase's sole behavior specification and mandatory change
workflow.
- **New feature or behavior:** create and strictly validate an OpenSpec change
  before implementation.
- **Existing feature without an OpenSpec capability:** first reverse-engineer
  and commit that baseline separately. The baseline commit must not modify application behavior or expected test
  outcomes. Only after that commit, create and apply a separate OpenSpec
  change.
`

test('fresh-contributor guidance carries both mandatory workflow paths', () => {
  // @spec openspec_is_behavior_authority
  // @spec new_behavior_starts_with_change
  // @spec legacy_behavior_is_baselined_first
  const root = mkdtempSync(join(tmpdir(), 'check-workflow-guidance-'))
  try {
    writeFileSync(join(root, 'AGENTS.md'), GUIDANCE)
    assert.deepEqual(checkWorkflowGuidance({ root }).failures, [])
    writeFileSync(join(root, 'AGENTS.md'), GUIDANCE.replace('must not modify', 'may modify'))
    assert.match(checkWorkflowGuidance({ root }).failures.join('\n'), /behavior-neutral legacy baseline/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function installation(version = '1.13.0') {
  const files = {
    'package.json': JSON.stringify({ devDependencies: { '@fission-ai/openspec': version } }),
    '.agents/skills/.openspec-target': 'agents\n',
  }
  for (const workflow of WORKFLOWS) {
    const skill = `---\nmetadata:\n  generatedBy: "${version}"\n---\n`
    files[`.agents/skills/openspec-${workflow}/SKILL.md`] = skill
    files[`.claude/skills/openspec-${workflow}/SKILL.md`] = skill
  }
  for (const command of COMMANDS) files[`.claude/commands/opsx/${command}.md`] = '# Generated\n'
  return files
}

function runInstallation(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-openspec-installation-'))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = join(root, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
    return checkOpenSpecInstallation({ root })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the exact package pin and matching generated workflows pass', () => {
  // @spec repository_uses_pinned_openspec
  // @spec generated_workflow_matches_pinned_cli
  assert.deepEqual(runInstallation(installation()).failures, [])
})

test('a range dependency and stale generated workflow version fail actionably', () => {
  const files = installation('^1.13.0')
  assert.match(runInstallation(files).failures.join('\n'), /exact devDependency version/)

  const pinned = installation()
  pinned['.agents/skills/openspec-apply-change/SKILL.md'] = 'generatedBy: "1.13.1"\n'
  assert.match(runInstallation(pinned).failures.join('\n'), /refresh with pnpm exec openspec init/)
})
