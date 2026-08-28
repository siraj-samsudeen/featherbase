#!/usr/bin/env node
// check-evidence — the spec/test join table, derived instead of curated.
//
// Every obligation in a journey-spec (a journey, rule, invariant or hazard
// with an ID) carries a one-line verdict in the spec itself:
//
//     > evidence: proven — <what was executed>
//     > evidence: rule-tier — <what the specified tier never witnessed>
//     > evidence: gap — <what is missing>
//     > evidence: pinned #110 — <the defect the expected-failing test pins>
//
// and, where the joining test title does not carry the ID itself:
//
//     > evidence: proven via IMP-010, IMP-013 — <note>
//     > evidence IMP-R2.leading-zero: pinned #111 — <note>   (a sub-ID)
//
// This script re-derives the linkage from the two artifacts that already
// have to be correct — the spec headings and the test titles — and fails
// when a claim in one is not backed by the other. It reads no database and
// runs no tests; it is a linkage check, never execution evidence.
//
// Usage: node tools/check-evidence.mjs [--quiet]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Documents that may declare obligations. */
const SPEC_GLOBS = ['docs/specs', 'docs/design']

/** Trees whose test titles are the join key. */
const TEST_DIRS = [
  'apps/server/test',
  'apps/web/test',
  'apps/web/e2e',
  'packages/shared/test',
]
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

const STATUSES = new Set(['proven', 'gap', 'pinned', 'rule-tier'])
/** Statuses that assert a test exists and so must name one. */
const MUST_LINK = new Set(['proven', 'rule-tier'])
/** Statuses that stand on their own but must say why. */
const MUST_EXPLAIN = new Set(['gap', 'rule-tier', 'pinned'])

// ---------------------------------------------------------------- utilities

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** `IMP-R*` → a prefix test; `C1` → an exact test. */
function idMatcher(patterns) {
  const exact = new Set()
  const prefixes = []
  for (const p of patterns) {
    if (p.endsWith('*')) prefixes.push(p.slice(0, -1))
    else exact.add(p)
  }
  return (id) => exact.has(id) || prefixes.some((p) => id.startsWith(p))
}

// ------------------------------------------------------------- spec parsing

// `## IMP-J1 — ...`, `- **DEL-I1 — ...**`, `**IMP-R2.7 — ordering guard.**`
const DECLARATION = /^(?:#{2,4}\s+|[-*]\s+\*\*|\*\*)([A-Za-z][A-Za-z0-9._-]*)\s+—/
// `> evidence: proven — note` / `>   evidence IMP-R6.shape: gap #114 — note`
const VERDICT = /^\s*>\s*evidence(?:\s+([A-Za-z][A-Za-z0-9._-]*))?:\s*(\S+)(.*)$/
const CONTINUATION = /^\s*>(.*)$/

/**
 * A spec participates when it names its ID families on an `**IDs:**` line.
 * That line is the document's own statement of what it is accountable for.
 */
function parseSpec(path) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  const rel = relative(ROOT, path)

  // The `**IDs:**` field wraps across lines; read it to the blank line.
  const idsStart = lines.findIndex((l) => l.trimStart().startsWith('**IDs:**'))
  if (idsStart === -1) return null
  let idsField = ''
  for (let i = idsStart; i < lines.length && lines[i].trim() !== ''; i++) {
    idsField += lines[i] + ' '
  }
  const patterns = [...idsField.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  if (patterns.length === 0) return null
  const owns = idMatcher(patterns)

  const declared = new Map() // id -> line number
  const verdicts = [] // { id, status, issues, via, note, line, file }
  let current = null // the declaration a bare verdict attaches to
  let open = null // the verdict absorbing `>` continuation lines
  let fenced = false // inside ``` — documentation showing the format

  lines.forEach((raw, i) => {
    const lineNo = i + 1

    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      open = null
      return
    }
    if (fenced) return

    const verdict = raw.match(VERDICT)
    if (verdict) {
      const [, explicitId, rawStatus, rest] = verdict
      const id = explicitId ?? current
      const status = rawStatus.replace(/[.,;:]$/, '')
      const entry = {
        id,
        status,
        rest,
        note: '',
        issues: [],
        via: [],
        line: lineNo,
        file: rel,
        declaredBy: explicitId ? null : current,
      }
      verdicts.push(entry)
      open = entry
      return
    }

    const cont = raw.match(CONTINUATION)
    if (cont && open) {
      open.rest += ' ' + cont[1]
      return
    }
    open = null

    const decl = raw.match(DECLARATION)
    if (decl && owns(decl[1])) {
      if (!declared.has(decl[1])) declared.set(decl[1], lineNo)
      current = decl[1]
    }
  })

  for (const v of verdicts) {
    const rest = v.rest.replace(/\s+/g, ' ').trim()
    // Everything before the first em-dash is machine-read; the note after it
    // is prose, so a "via" or a "#123" inside it is not a linkage claim.
    const dash = rest.indexOf('—')
    const head = dash === -1 ? rest : rest.slice(0, dash)
    v.note = dash === -1 ? '' : rest.slice(dash + 1).trim()

    const viaMatch = head.match(/(?:^|\s)via\s+(.+)$/)
    if (viaMatch) {
      v.via = viaMatch[1]
        .split(/[,\s]+/)
        .map((t) => t.replace(/^`|[`.,;]+$/g, ''))
        .filter(Boolean)
    }
    v.issues = [...head.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  }

  return { file: rel, patterns, owns, declared, verdicts }
}

// ------------------------------------------------------------- test parsing

const TITLE =
  /\b(?:describe|it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
// `IMP-R2`, `UPS-J1.4`, `NAM-001`, plus `/R3` continuations in `RVT-R2/R3`
const ID_IN_TITLE = /\b([A-Z][A-Z0-9]{1,5})-([A-Z]?\d+(?:\.[A-Za-z0-9][\w-]*)*)((?:\/[A-Z]?\d+(?:\.[A-Za-z0-9][\w-]*)*)*)/g

function idsInTitle(title) {
  const found = new Set()
  for (const m of title.matchAll(ID_IN_TITLE)) {
    const [, family, part, tail] = m
    found.add(`${family}-${part}`)
    for (const extra of tail.split('/').filter(Boolean)) {
      found.add(`${family}-${extra}`)
    }
  }
  return found
}

function collectTests() {
  /** id -> Set of "file:line" */
  const index = new Map()
  /** every issue number named anywhere in a test file */
  const issues = new Set()
  let files = 0

  for (const dir of TEST_DIRS) {
    for (const path of walk(join(ROOT, dir))) {
      if (!TEST_FILE.test(path)) continue
      files++
      const text = readFileSync(path, 'utf8')
      const rel = relative(ROOT, path)
      for (const m of text.matchAll(/#(\d+)/g)) issues.add(Number(m[1]))
      for (const m of text.matchAll(TITLE)) {
        const line = text.slice(0, m.index).split('\n').length
        for (const id of idsInTitle(m[2])) {
          if (!index.has(id)) index.set(id, new Set())
          index.get(id).add(`${rel}:${line}`)
        }
      }
    }
  }
  return { index, issues, files }
}

// -------------------------------------------------------------------- check

function main() {
  const quiet = process.argv.includes('--quiet')
  const specs = []
  for (const dir of SPEC_GLOBS) {
    for (const path of walk(join(ROOT, dir))) {
      if (!path.endsWith('.md')) continue
      const spec = parseSpec(path)
      if (spec) specs.push(spec)
    }
  }

  const { index, issues: testIssues, files: testFiles } = collectTests()
  const failures = []
  const warnings = []
  const byStatus = new Map()
  const specIds = new Set()
  const viaTargets = new Set()

  for (const spec of specs) {
    const verdictsById = new Map()
    for (const v of spec.verdicts) {
      if (!v.id) {
        failures.push(
          `${spec.file}:${v.line}  evidence line names no ID and follows no declaration`,
        )
        continue
      }
      if (!STATUSES.has(v.status)) {
        failures.push(
          `${spec.file}:${v.line}  ${v.id}: unknown evidence status "${v.status}" ` +
            `(expected one of ${[...STATUSES].join(', ')})`,
        )
        continue
      }
      if (verdictsById.has(v.id)) {
        failures.push(
          `${spec.file}:${v.line}  ${v.id}: a second evidence line — one verdict per ID ` +
            `(first at line ${verdictsById.get(v.id).line})`,
        )
        continue
      }
      verdictsById.set(v.id, v)
      specIds.add(v.id)
      v.via.forEach((t) => viaTargets.add(t))
      byStatus.set(v.status, (byStatus.get(v.status) ?? 0) + 1)

      // The ID always joins on its own name; "via" adds aliases for the
      // titles that prove it without quoting it (legacy IDs, a covering
      // journey, a rule proved inside a sibling's test).
      const joins = [v.id, ...v.via]
      const hits = joins.flatMap((j) => [...(index.get(j) ?? [])])

      if (MUST_LINK.has(v.status) && hits.length === 0) {
        const how = v.via.length
          ? `no test title carries ${joins.join(' or ')}`
          : `no test title carries ${v.id}`
        failures.push(
          `${spec.file}:${v.line}  ${v.id} is marked "${v.status}" but ${how}. ` +
            `Add the ID to the proving test's name, name the joining title with ` +
            `"via <ID>", or migrate the verdict to gap.`,
        )
      }
      if (MUST_EXPLAIN.has(v.status) && !v.note) {
        failures.push(
          `${spec.file}:${v.line}  ${v.id} is marked "${v.status}" with no reason — ` +
            `write "— <why>" after the status.`,
        )
      }
      if (v.status === 'pinned' && v.issues.length === 0) {
        failures.push(
          `${spec.file}:${v.line}  ${v.id} is marked "pinned" but names no issue — ` +
            `write "pinned #<number>".`,
        )
      }
      for (const issue of v.issues) {
        if (v.status !== 'pinned') continue
        if (!testIssues.has(issue)) {
          failures.push(
            `${spec.file}:${v.line}  ${v.id} pins #${issue}, but no test file mentions ` +
              `#${issue} — the expected-failing test that pins it is missing.`,
          )
        }
      }
    }

    for (const [id, line] of spec.declared) {
      specIds.add(id)
      if (verdictsById.has(id)) continue
      const hasChild = [...verdictsById.keys()].some((k) => k.startsWith(id + '.'))
      if (hasChild) continue
      failures.push(
        `${spec.file}:${line}  ${id} is declared with no evidence line. ` +
          `Add "> evidence: proven|gap|pinned #N|rule-tier — <note>" under it.`,
      )
    }
  }

  const families = new Set([...specIds].map((id) => id.split('-')[0]))
  for (const [id, where] of index) {
    if (!families.has(id.split('-')[0])) continue
    if (specIds.has(id) || viaTargets.has(id)) continue
    warnings.push(
      `${[...where][0]}  test names ${id}, which no spec declares ` +
        `(${where.size} test${where.size === 1 ? '' : 's'})`,
    )
  }

  const total = [...byStatus.values()].reduce((a, b) => a + b, 0)
  const tally = [...byStatus.entries()]
    .sort()
    .map(([s, n]) => `${n} ${s}`)
    .join(' · ')

  if (warnings.length && !quiet) {
    console.log('evidence warnings (not failures):')
    for (const w of warnings.sort()) console.log(`  ${w}`)
    console.log('')
  }

  if (failures.length) {
    console.error(`evidence check FAILED — ${failures.length} problem(s):\n`)
    for (const f of failures.sort()) console.error(`  ${f}`)
    console.error(
      `\n${total} verdicts across ${specs.length} specs; ${testFiles} test files scanned.`,
    )
    process.exit(1)
  }

  console.log(
    `evidence check passed — ${total} verdicts across ${specs.length} specs ` +
      `(${tally}); ${testFiles} test files scanned.`,
  )
}

main()
