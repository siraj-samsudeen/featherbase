#!/usr/bin/env node
// stc-matrix — which OpenSpec requirements have code and tests, and which
// markers are orphans.
//
// Convention: docs/agents/stc-traceability.md. One snake_case slug per
// requirement, carried in the spec heading, in a `// @spec <slug>` comment at
// the code that decides the behaviour, and in a `// @spec <slug>` comment
// inside the test that checks it. One grep returns all three vertices; this
// script does that grep for every slug at once.
//
//     node tools/stc-matrix.mjs                # the matrix + the verdict
//     node tools/stc-matrix.mjs --write-baseline
//
// Zero dependencies, like `check-evidence.mjs` — it runs before `pnpm install`
// in CI, where a broken linkage costs nothing to discover.
//
// Exit codes:  0 clean  |  1 orphans (a marker naming no requirement)
//              2 baseline regression (a NEW coverage gap)
//
// An orphan always fails: a slug was renamed or deleted and a vertex was left
// behind, which is exactly the drift this convention exists to catch. Coverage
// gaps do NOT fail — they ratchet against tools/stc-baseline.txt, so today's
// backlog is recorded without blocking anyone and tomorrow's additions have
// nowhere to hide. Same ratchet shape as the coverage thresholds in the vitest
// configs (#226): only ever tightens.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT CHECK, stated plainly
// ---------------------------------------------------------------------------
// That the three vertices AGREE. A requirement with a code marker and a test
// marker is linked, not proven: the marker says "this line is about that
// promise", never "that promise holds". Agreement is what a human review
// decides — `spec-review-5-axes` and its divergence triage.
//
// It is also not `check-evidence.mjs` and does not replace it. That checker
// owns `docs/specs` — the `> evidence:` verdict under every obligation, joined
// to the test TITLES that back it, upgraded in CI to "a matching test actually
// executed on this commit". This one owns `openspec/specs` and joins on a
// marker rather than a title. Two spec homes, two join keys, no overlap:
//
//   check-evidence.mjs   docs/specs/*.md       verdict  <-> test title
//   stc-matrix.mjs       openspec/specs/**     heading  <-> @spec marker

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Where capability specs live. */
export const SPEC_ROOTS = ['openspec/specs']

/** Trees whose `@spec` markers count as the CODE vertex. */
export const CODE_DIRS = ['apps/server/src', 'apps/web/src', 'packages/shared/src', 'tools']

/** Trees whose `@spec` markers count as the TEST vertex — the same list
 *  `check-evidence.mjs` calls TEST_DIRS, so the two checkers cannot disagree
 *  about what a test is. */
export const TEST_DIRS = ['apps/server/test', 'apps/web/test', 'apps/web/e2e', 'packages/shared/test']

/**
 * A file is a TEST wherever it lives: `tools/` is a code tree that also holds
 * `tools/*.test.mjs`, and counting a checker's own test as the code vertex
 * would let a requirement read "has code" on the strength of a test file. The
 * Python original routed on `/tests/` or a `test_` prefix; this repo's
 * convention is the suffix.
 */
const isTestPath = (rel, testDirs) =>
  /\.(test|spec)\.[jt]sx?$|\.(test|spec)\.mjs$/.test(rel) ||
  testDirs.some((d) => rel === d || rel.startsWith(`${d}/`))

/**
 * This checker's own source and its fixtures. `stc-matrix.test.mjs` contains
 * deliberately broken markers (`@spec a_slug_that_does_not_exist` is a CASE),
 * so walking it would make the checker fail on its own test data — an
 * unenforced guard by self-inflicted noise.
 */
const SELF = new Set(['tools/stc-matrix.mjs', 'tools/stc-matrix.test.mjs'])

/** The ratchet floor. */
export const BASELINE = 'tools/stc-baseline.txt'

const SOURCE_SUFFIXES = ['.ts', '.tsx', '.mjs', '.js', '.sql']

/** Never walked, wherever they appear. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report'])

// A requirement heading in an OpenSpec capability spec, and the scenarios under
// it. The slug IS the heading — see the convention on why a slug and not a
// number.
const RE_REQUIREMENT = /^#{2,4}\s+Requirement:\s*([a-z][a-z0-9_]*)\s*$/
const RE_SCENARIO = /^#{2,4}\s+Scenario:\s*([a-z][a-z0-9_]*)\s*$/

// The token is `@spec` and NOT a bare `spec:`: this repo is full of incidental
// `spec:` occurrences — Playwright's `spec` fixtures, `*.spec.ts` filenames,
// object literals — and a bare token would produce false orphans. Axis 4 of
// code-review-8-axes applied to this script: the token must be unique.
// Deliberately one spelling; see the convention on why kebab-case is not
// allowed alongside it.
const RE_MARKER = /@spec\s+([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)/g

/**
 * Yield every file under `base` with one of `suffixes`.
 *
 * The skip test is on PATH COMPONENTS, not on a substring of the path. The
 * Python original this was ported from carried a bug here once — a skip
 * expression that was vacuously true and silently walked nothing, reporting
 * "nothing to check" instead of failing. That is the Silent Success defect
 * (code-review-8-axes Axis 2) inside the checker that polices it, which is why
 * `tools/stc-matrix.test.mjs` pins it with a case of its own.
 */
function* walk(root, base, suffixes) {
  const start = join(root, base)
  if (!existsSync(start)) return
  const stack = [start]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (suffixes.some((s) => entry.name.endsWith(s))) yield path
    }
  }
}

/** slug -> spec file that declares it. Scenarios register as `<req>.<scenario>`. */
export function collectRequirements(root, specRoots) {
  const found = new Map()
  for (const specRoot of specRoots) {
    for (const path of walk(root, specRoot, ['.md'])) {
      const rel = relative(root, path).split('\\').join('/')
      let current = null
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const req = RE_REQUIREMENT.exec(line)
        if (req) {
          current = req[1]
          found.set(current, rel)
          continue
        }
        const scen = RE_SCENARIO.exec(line)
        if (scen && current) found.set(`${current}.${scen[1]}`, rel)
      }
    }
  }
  return found
}

/** Collect `@spec` markers under `dirs`. Returns slug -> ['path:line', ...]. */
export function collectMarkers(root, dirs) {
  const markers = new Map()
  for (const dir of dirs) {
    for (const path of walk(root, dir, SOURCE_SUFFIXES)) {
      const rel = relative(root, path).split('\\').join('/')
      if (SELF.has(rel)) continue
      let text
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let n = 0; n < lines.length; n++) {
        RE_MARKER.lastIndex = 0
        let m
        while ((m = RE_MARKER.exec(lines[n])) !== null) {
          const at = `${rel}:${n + 1}`
          const seen = markers.get(m[1])
          if (seen) seen.push(at)
          else markers.set(m[1], [at])
        }
      }
    }
  }
  return markers
}

const rootOf = (slug) => slug.split('.')[0]

/** One row per requirement, plus every marker naming no requirement. */
export function build(requirements, code, test) {
  const rows = []
  for (const slug of [...requirements.keys()].sort()) {
    if (slug.includes('.')) continue // scenarios report through their requirement
    const scenarios = [...requirements.keys()].filter((s) => s.startsWith(`${slug}.`)).sort()
    const testLocations = [
      ...(test.get(slug) ?? []),
      ...scenarios.flatMap((s) => test.get(s) ?? []),
    ]
    rows.push({
      slug,
      spec: requirements.get(slug),
      code: code.get(slug) ?? [],
      test: testLocations,
      // The asymmetry is deliberate: a TEST may prove one scenario, so a
      // scenario marker counts for its requirement. A CODE marker names the
      // line that decides the whole requirement, so it must cite the
      // requirement itself — a scenario-level code marker is a narrower claim
      // than the vertex is for.
      scenarios,
      hasCode: code.has(slug),
      hasTest: testLocations.length > 0,
    })
  }
  const orphans = []
  for (const [kind, bucket] of [
    ['code', code],
    ['test', test],
  ]) {
    for (const [slug, locations] of bucket)
      if (!requirements.has(slug) && !requirements.has(rootOf(slug)))
        for (const at of locations) orphans.push({ kind, slug, at })
  }
  orphans.sort((a, b) => a.slug.localeCompare(b.slug) || a.at.localeCompare(b.at))
  return { rows, orphans }
}

/** The gap keys a baseline records. */
export function gapKeys(rows) {
  const keys = new Set()
  for (const r of rows) {
    if (!r.hasCode) keys.add(`no_code ${r.slug}`)
    if (!r.hasTest) keys.add(`no_test ${r.slug}`)
  }
  return keys
}

/**
 * Run the whole check. Returns the rows, the orphans, the gaps and the
 * failures — exported separately from the CLI so the mutation tests can drive
 * it over a throwaway tree, the way `check-evidence.mjs` is driven.
 */
export function stcMatrix({
  root = ROOT,
  specRoots = SPEC_ROOTS,
  codeDirs = CODE_DIRS,
  testDirs = TEST_DIRS,
  baseline = BASELINE,
} = {}) {
  const requirements = collectRequirements(root, specRoots)
  const all = collectMarkers(root, [...codeDirs, ...testDirs])
  const code = new Map()
  const test = new Map()
  for (const [slug, locations] of all)
    for (const at of locations) {
      const bucket = isTestPath(at.slice(0, at.lastIndexOf(':')), testDirs) ? test : code
      const seen = bucket.get(slug)
      if (seen) seen.push(at)
      else bucket.set(slug, [at])
    }
  const { rows, orphans } = build(requirements, code, test)
  const gaps = gapKeys(rows)

  const known = new Set()
  const baselinePath = join(root, baseline)
  if (existsSync(baselinePath))
    for (const line of readFileSync(baselinePath, 'utf8').split('\n')) {
      const key = line.trim()
      // `#` comments carry WHY a gap is accepted. Without this they would be
      // read as gap keys, and every run would report them as "closed" — noise
      // that trains a reader to ignore the ratchet's own output.
      if (key && !key.startsWith('#')) known.add(key)
    }

  const newGaps = [...gaps].filter((g) => !known.has(g)).sort()
  const closed = [...known].filter((g) => !gaps.has(g)).sort()

  const failures = []
  for (const o of orphans)
    failures.push(
      `orphan ${o.kind} marker @spec ${o.slug} at ${o.at} — names no requirement in ` +
        `${specRoots.join(', ')}. A slug was renamed or deleted and this vertex was left behind.`,
    )
  for (const gap of newGaps) failures.push(`new coverage gap beyond the baseline: ${gap}`)

  return { rows, orphans, gaps, newGaps, closed, failures, requirements, code, test }
}

/** Write today's gaps as the ratchet floor. */
export function writeBaseline(root, baseline, gaps) {
  const path = join(root, baseline)
  mkdirSync(dirname(path), { recursive: true })
  const sorted = [...gaps].sort()
  writeFileSync(path, sorted.length ? `${sorted.join('\n')}\n` : '')
  return sorted.length
}

function main(argv) {
  const write = argv.includes('--write-baseline')
  const quiet = argv.includes('--quiet')
  const result = stcMatrix()

  if (result.requirements.size === 0) {
    console.log(
      `[stc] no tagged requirements found under ${SPEC_ROOTS.join(', ')} — nothing to check yet. ` +
        'See docs/agents/stc-traceability.md.',
    )
    return 0
  }

  if (!quiet) {
    const width = Math.max(...result.rows.map((r) => r.slug.length), 'requirement'.length)
    console.log(`${'requirement'.padEnd(width)}  S  C  T   scenarios`)
    console.log('-'.repeat(width + 24))
    for (const r of result.rows)
      console.log(
        `${r.slug.padEnd(width)}  Y  ${r.hasCode ? 'Y' : '.'}  ${r.hasTest ? 'Y' : '.'}   ` +
          `${r.scenarios.length}`,
      )
    const withCode = result.rows.filter((r) => r.hasCode).length
    const withTest = result.rows.filter((r) => r.hasTest).length
    console.log(
      `\n${result.rows.length} requirement(s): ${withCode} with code, ${withTest} with a test.`,
    )
  }

  if (result.orphans.length) {
    console.error(`\n[FAIL] ${result.orphans.length} orphan marker(s) — naming a requirement that does not exist.`)
    for (const o of result.orphans) console.error(`       ${o.kind.padEnd(4)} ${o.slug}  at ${o.at}`)
    return 1
  }

  if (write) {
    const n = writeBaseline(ROOT, BASELINE, result.gaps)
    console.log(`\n[stc] baseline written: ${n} known gap(s) -> ${BASELINE}`)
    return 0
  }

  if (result.newGaps.length) {
    console.error(`\n[FAIL] ${result.newGaps.length} NEW coverage gap(s) beyond the baseline:`)
    for (const gap of result.newGaps) console.error(`       ${gap}`)
    console.error('\n       Add the missing @spec marker, or — if the gap is deliberate and')
    console.error('       recorded on an issue — re-run with --write-baseline and say why in the PR.')
    return 2
  }

  if (result.closed.length)
    console.log(
      `\n[stc] ${result.closed.length} gap(s) closed since the baseline. ` +
        'Re-run --write-baseline to ratchet down.',
    )
  console.log('\n[ok] no orphans, no new gaps.')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  process.exit(main(process.argv.slice(2)))
