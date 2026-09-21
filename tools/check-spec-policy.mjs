#!/usr/bin/env node
// @spec competing_behavior_specs_are_rejected
// OpenSpec is Featherbase's sole active behavior-specification root. This
// ratchet freezes the pre-adoption Journey documents by exact path: migration
// may remove them, but no new document can make docs/specs authoritative again.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LEGACY_ROOT = 'docs/specs'
export const BASELINE = 'tools/legacy-spec-baseline.txt'
export const WORKFLOWS = [
  'apply-change',
  'archive-change',
  'bulk-archive-change',
  'continue-change',
  'explore',
  'ff-change',
  'new-change',
  'onboard',
  'propose',
  'sync-specs',
  'verify-change',
]
export const COMMANDS = [
  'apply',
  'archive',
  'bulk-archive',
  'continue',
  'explore',
  'ff',
  'new',
  'onboard',
  'propose',
  'sync',
  'verify',
]

function* markdownFiles(root, rel) {
  const start = join(root, rel)
  if (!existsSync(start)) return
  const stack = [start]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.name.endsWith('.md')) yield relative(root, path).split('\\').join('/')
    }
  }
}

export function checkSpecPolicy({
  root = ROOT,
  legacyRoot = LEGACY_ROOT,
  baseline = BASELINE,
} = {}) {
  const baselinePath = join(root, baseline)
  if (!existsSync(baselinePath)) {
    return { failures: [`missing legacy-spec baseline: ${baseline}`] }
  }

  const allowed = new Set(
    readFileSync(baselinePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  )
  const actual = new Set(markdownFiles(root, legacyRoot))
  const added = [...actual].filter((path) => !allowed.has(path)).sort()
  const removed = [...allowed].filter((path) => !actual.has(path)).sort()
  const failures = [
    ...added.map(
      (path) =>
        `${path} is a new competing behavior-spec document; create an OpenSpec capability/change under openspec/ instead`,
    ),
    ...removed.map(
      (path) =>
        `${path} was migrated or removed; delete it from ${baseline} in the same commit so it cannot reappear`,
    ),
  ]
  return { failures, added, removed, actual, allowed }
}

// @spec openspec_is_behavior_authority
// @spec new_behavior_starts_with_change
// @spec legacy_behavior_is_baselined_first
export function checkWorkflowGuidance({ root = ROOT } = {}) {
  const path = join(root, 'AGENTS.md')
  if (!existsSync(path)) return { failures: ['missing AGENTS.md OpenSpec workflow guidance'] }
  const text = readFileSync(path, 'utf8')
  const failures = []
  const required = [
    [
      /OpenSpec is Featherbase's sole behavior specification and mandatory change\s+workflow/,
      'AGENTS.md must name OpenSpec as the sole behavior specification and mandatory workflow',
    ],
    [
      /New feature or behavior:.*create and strictly validate an OpenSpec change\s+before implementation/s,
      'AGENTS.md must require a validated OpenSpec change before new behavior',
    ],
    [
      /Existing feature without an OpenSpec capability:.*commit that baseline separately.*baseline commit must not modify application behavior or expected test\s+outcomes.*Only after that commit, create and apply a separate OpenSpec\s+change/s,
      'AGENTS.md must require a behavior-neutral legacy baseline commit before a separate change',
    ],
  ]
  for (const [pattern, failure] of required) if (!pattern.test(text)) failures.push(failure)
  return { failures }
}

// @spec repository_uses_pinned_openspec
// @spec generated_workflow_matches_pinned_cli
export function checkOpenSpecInstallation({ root = ROOT } = {}) {
  const failures = []
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) return { failures: ['missing package.json'] }

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const version = pkg.devDependencies?.['@fission-ai/openspec']
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    failures.push('@fission-ai/openspec must be an exact devDependency version in package.json')
    return { failures, version }
  }

  const expectedSkills = new Set(WORKFLOWS.map((name) => `openspec-${name}`))
  for (const base of ['.agents/skills', '.claude/skills']) {
    const dir = join(root, base)
    const actual = new Set(
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('openspec-'))
            .map((entry) => entry.name)
        : [],
    )
    for (const name of expectedSkills) {
      const rel = `${base}/${name}/SKILL.md`
      if (!actual.has(name)) {
        failures.push(`missing generated workflow skill ${rel}`)
        continue
      }
      const text = readFileSync(join(root, rel), 'utf8')
      if (!text.includes(`generatedBy: "${version}"`)) {
        failures.push(`${rel} was not generated by pinned OpenSpec ${version}; refresh with pnpm exec openspec init`)
      }
    }
    for (const name of actual)
      if (!expectedSkills.has(name)) failures.push(`${base}/${name} is a stale or unknown OpenSpec workflow skill`)
  }

  const commandDir = join(root, '.claude/commands/opsx')
  const expectedCommands = new Set(COMMANDS.map((name) => `${name}.md`))
  const actualCommands = new Set(
    existsSync(commandDir)
      ? readdirSync(commandDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
          .map((entry) => entry.name)
      : [],
  )
  for (const name of expectedCommands)
    if (!actualCommands.has(name)) failures.push(`missing generated workflow command .claude/commands/opsx/${name}`)
  for (const name of actualCommands)
    if (!expectedCommands.has(name)) failures.push(`.claude/commands/opsx/${name} is a stale or unknown OpenSpec command`)

  const targetPath = join(root, '.agents/skills/.openspec-target')
  if (!existsSync(targetPath) || readFileSync(targetPath, 'utf8').trim() !== 'agents') {
    failures.push('.agents/skills/.openspec-target must identify the generated agents workflow target')
  }
  return { failures, version }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const specPolicy = checkSpecPolicy()
  const guidance = checkWorkflowGuidance()
  const installation = checkOpenSpecInstallation()
  const failures = [...specPolicy.failures, ...guidance.failures, ...installation.failures]
  if (failures.length) {
    for (const failure of failures) console.error(`[spec-policy] ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      `[spec-policy] OpenSpec ${installation.version} is pinned with current workflows; ` +
        `${specPolicy.actual.size} frozen legacy document(s), no additions`,
    )
  }
}
