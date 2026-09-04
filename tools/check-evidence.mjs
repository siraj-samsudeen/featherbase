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
// when a claim in one is not backed by the other. With no result files it
// reads no database and runs no tests: the default remains a dependency-free
// linkage check. CI adds `--results` after every suite has run, which upgrades
// proven/rule-tier claims into execution evidence for that commit.
//
// Usage: node tools/check-evidence.mjs [--quiet] [--results <json...>]
// Tests: node --test tools/*.test.mjs   (tools/check-evidence.test.mjs)
//
// ---------------------------------------------------------------------------
// THE PARTICIPATION CONTRACT (owner review of PR #239, 2026-08-28)
// ---------------------------------------------------------------------------
// The question this file has to answer is "can a future contributor make an
// unsupported claim look green?". Three ways it used to be possible, and the
// rule that closed each:
//
// 1. A spec could opt out in silence. Deleting the `**IDs:**` line made
//    parseSpec return null and the document — verdicts and all — vanished
//    from the run, which still reported "passed". So participation is now
//    DECLARED AND CHECKED:
//
//      * REQUIRED_SPEC_DIRS (docs/specs) — every `.md` must carry either
//        `**IDs:** \`FAM-J*\` …` or
//        `**Evidence mode:** excluded — <one-phrase reason>`.
//        A file with neither fails the run by name. A file with both fails
//        too: a document cannot be accountable and exempt at once.
//      * WATCHED_SPEC_DIRS (docs/design) — design notes are not specs, so
//        they are not forced to declare. But a document that CARRIES
//        obligations (any `> evidence:` verdict line outside a code fence)
//        must declare, exactly as a spec does; that is what stops a future
//        obligations-bearing design doc from being ignored in silence.
//      * An excluded document may not carry verdict lines, and an `**IDs:**`
//        line naming no `\`pattern\`` fails rather than silently opting out.
//
//    docs/specs/README.md declares its own exclusion rather than being
//    exempted by a rule in here on purpose: the participation statement then
//    lives in the document for a reader to see, and this file keeps no
//    exemption list to go stale.
//
// 2. A skipped test counted as proof. `test.skip`, `it.todo` and a title
//    inside a `describe.skipIf(…)` block all matched the title regex, so
//    flipping the only proving test to `.skip` left the run green — "a skip
//    that reads green is a lie with a timestamp"
//    (docs/design/requirements-framework.md, Part I §8). A title now counts
//    only from an EXECUTABLE declaration: the modifier chain must be empty or
//    drawn entirely from EXECUTABLE_MODIFIERS, and the declaration must not
//    sit inside a non-executable suite.
//
//    `.skipIf` / `.runIf` are treated as non-executable even though they run
//    somewhere: whether they run depends on the environment of a particular
//    run, and this check is static — it cannot know that MYSQL_URL was set.
//    Conservative by design, and the allowlist (rather than a denylist of
//    skip words) means a future Vitest modifier disqualifies a title until
//    someone reviews it here, instead of quietly counting as proof.
//
//    The same lie wears a fourth dress: a `describe` whose only `it` was
//    flipped to `.skip` is still an executable suite, and its title still
//    carries the ID. So a SUITE title proves nothing on its own — it counts
//    only while an executable test declaration still runs inside its extent.
//
//    What this check cannot see, stated plainly: whether an executable test
//    asserts anything. `it('DEL-J1: …', () => {})` counts here. Emptiness is
//    a review question, not a static one.
//
// 3. Pins were counterfeitable. A `pinned #N` verdict was satisfied by the
//    string `#N` appearing ANYWHERE in ANY test file — a comment would do,
//    and flipping the pinning `it.fails` to `it.skip` changed nothing. A pin
//    is now satisfied only by an executable EXPECTED-FAILURE declaration
//    (`it.fails` / `test.fails`, not skipped, not inside a skipped suite)
//    whose TITLE carries both the pinned ID (or one of its `via` aliases)
//    and `#N`.
//
//    Correspondingly, `.fails` is matchable but never proof: an expected
//    failure records that the behaviour is BROKEN, so it cannot satisfy a
//    `proven` (or `rule-tier`) verdict.
//
// Also closed here: `re.test('…')` and `s.match(…).test(` style calls no
// longer register as test titles (a lookbehind rejects a `.`-qualified or
// word-prefixed `test`/`it`/`describe`), so a string argument to an
// unrelated method can no longer inject an ID into the join table.
//
// When you add a new obligations-bearing document, declare it. When you add a
// new tree of tests, add it to TEST_DIRS. Both lists are below; the
// journey-spec skill states the same contract from the author's side.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Documents that MUST declare participation — every `.md`, no exceptions. */
export const REQUIRED_SPEC_DIRS = ['docs/specs']
/** Documents that participate only by declaring — but must declare if they
 *  carry `> evidence:` verdicts. */
export const WATCHED_SPEC_DIRS = ['docs/design']

/** Trees whose test titles are the join key. */
export const TEST_DIRS = [
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

/**
 * Modifiers that leave a declaration unconditionally executable. Anything
 * outside this set (`skip`, `todo`, `skipIf`, `runIf`, and whatever the test
 * runner adds next) disqualifies the title as static proof. See note 2 above.
 */
const EXECUTABLE_MODIFIERS = new Set([
  'each',
  'for',
  'only',
  'concurrent',
  'sequential',
  'extend',
  'fails',
  'failing',
  // Playwright spells its suites and steps off `test`.
  'describe',
  'serial',
  'parallel',
  'step',
])
/** Modifiers that declare the test is EXPECTED to fail — a pin, never proof. */
const EXPECTED_FAILURE_MODIFIERS = new Set(['fails', 'failing'])
/** Modifiers whose condition is the FIRST call, with the title curried after
 *  it: `describe.skipIf(!URL)('title', fn)`. */
const CURRIED_MODIFIERS = new Set(['skipIf', 'runIf'])

// ---------------------------------------------------------------- utilities

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries.sort()) {
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

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

// ------------------------------------------------------------- spec parsing

// `## IMP-J1 — ...`, `- **DEL-I1 — ...**`, `**IMP-R2.7 — ordering guard.**`
const DECLARATION = /^(?:#{2,4}\s+|[-*]\s+\*\*|\*\*)([A-Za-z][A-Za-z0-9._-]*)\s+—/
// `> evidence: proven — note` / `>   evidence IMP-R6.shape: gap #114 — note`
const VERDICT = /^\s*>\s*evidence(?:\s+([A-Za-z][A-Za-z0-9._-]*))?:\s*(\S+)(.*)$/
const CONTINUATION = /^\s*>(.*)$/
// The two participation declarations.
const IDS_LINE = /^\s*\*\*IDs:\*\*/
const MODE_LINE = /^\s*\*\*Evidence mode:\*\*\s*(\S+)\s*(?:—\s*(.*))?$/

/**
 * Blank out fenced blocks so documentation that SHOWS the verdict format is
 * never read as a verdict. Returns a parallel array — line numbers survive.
 */
function unfence(lines) {
  const out = []
  let fenced = false
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      out.push('')
      continue
    }
    out.push(fenced ? '' : raw)
  }
  return out
}

/**
 * Read a document's participation declaration.
 *
 * @returns {{mode: 'ids'|'excluded'|'none'|'unknown', patterns: string[],
 *            reason: string, badMode: string, verdictLines: number[],
 *            idsLine: number, modeLine: number}}
 */
export function parseParticipation(text) {
  const lines = text.split('\n')
  const live = unfence(lines)

  const idsLine = live.findIndex((l) => IDS_LINE.test(l))
  let patterns = []
  if (idsLine !== -1) {
    // The `**IDs:**` field wraps across lines; read it to the blank line.
    let idsField = ''
    for (let i = idsLine; i < live.length && live[i].trim() !== ''; i++) {
      idsField += live[i] + ' '
    }
    patterns = [...idsField.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  }

  const modeIndex = live.findIndex((l) => MODE_LINE.test(l))
  let modeWord = ''
  let reason = ''
  if (modeIndex !== -1) {
    const m = live[modeIndex].match(MODE_LINE)
    modeWord = m[1].replace(/[.,;:]$/, '')
    reason = (m[2] ?? '').trim()
  }

  const verdictLines = []
  live.forEach((l, i) => {
    if (VERDICT.test(l)) verdictLines.push(i + 1)
  })

  let mode = 'none'
  if (idsLine !== -1 && modeIndex !== -1) mode = 'both'
  else if (idsLine !== -1) mode = 'ids'
  else if (modeIndex !== -1) mode = modeWord === 'excluded' ? 'excluded' : 'unknown'

  return {
    mode,
    patterns,
    reason,
    badMode: modeWord,
    verdictLines,
    idsLine: idsLine + 1,
    modeLine: modeIndex + 1,
  }
}

/**
 * A spec participates when it names its ID families on an `**IDs:**` line.
 * That line is the document's own statement of what it is accountable for.
 * Returns null when the document declares no IDs — the caller decides
 * whether that silence is allowed (see the participation contract above).
 */
export function parseSpec(rel, text) {
  const lines = text.split('\n')
  const part = parseParticipation(text)
  if (part.mode !== 'ids' || part.patterns.length === 0) return null
  const owns = idMatcher(part.patterns)

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

  return { file: rel, patterns: part.patterns, owns, declared, verdicts }
}

// ------------------------------------------------------------- test parsing
//
// The scanner below has to know where a `describe.skip(…)` block ENDS, which
// means matching its closing paren across a file's worth of JavaScript. It is
// deliberately not a parser. Limits, stated plainly:
//
//   * strings, template literals (including `${…}` nesting), line and block
//     comments and regex literals are stepped over, so braces and parens
//     inside them do not move the depth;
//   * regex-vs-division is decided by the usual preceding-token heuristic,
//     which is right for test files but is a heuristic;
//   * paren matching is only ever run for a NON-EXECUTABLE declaration (to
//     find its extent) or a curried `.skipIf(cond)(title)` — a handful of
//     sites per repo, not every test — so a mis-scan has a small blast
//     radius, and an unbalanced scan is REPORTED as a failure rather than
//     guessed at: an unreadable skipped suite must not silently let the
//     titles inside it count as proof.

const QUOTES = new Set(["'", '"', '`'])
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '%', '^', '~', '<', '>',
])
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do',
  'else', 'yield', 'await',
])

function isRegexStart(text, i) {
  let j = i - 1
  while (j >= 0 && /\s/.test(text[j])) j--
  if (j < 0) return true
  const c = text[j]
  if (REGEX_PRECEDERS.has(c)) return true
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j
    while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k--
    return REGEX_KEYWORDS.has(text.slice(k + 1, j + 1))
  }
  return false
}

/** Index just past the regex literal starting at `i` (a `/`). */
function endOfRegex(text, i) {
  let inClass = false
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') {
      j++
      continue
    }
    if (c === '\n') return -1
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) {
      let k = j + 1
      while (k < text.length && /[a-z]/.test(text[k])) k++
      return k
    }
  }
  return -1
}

/** Index just past the string/template literal starting at `i` (a quote). */
export function endOfString(text, i) {
  const q = text[i]
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') {
      j++
      continue
    }
    if (c === q) return j + 1
    if (q === '`' && c === '$' && text[j + 1] === '{') {
      const close = matchDelim(text, j + 1, '{', '}')
      if (close === -1) return -1
      j = close
    }
  }
  return -1
}

/** Index of the delimiter closing the one at `openIdx`, or -1. */
export function matchDelim(text, openIdx, open, close) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      if (nl === -1) return -1
      i = nl
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (c === '/' && isRegexStart(text, i)) {
      const end = endOfRegex(text, i)
      if (end === -1) return -1
      i = end - 1
      continue
    }
    if (QUOTES.has(c)) {
      const end = endOfString(text, i)
      if (end === -1) return -1
      i = end - 1
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// `describe(`, `it.each(`, `test.skipIf(` — but never `re.test(` or
// `mytest(`: a `.`-qualified or word-prefixed name is somebody else's method.
const DECL_CALL = /(?<![\w.$])(describe|it|test)((?:\.[A-Za-z_$][\w$]*)*)\s*\(/g
// `IMP-R2`, `UPS-J1.4`, `NAM-001`, plus `/R3` continuations in `RVT-R2/R3`
const ID_IN_TITLE = /\b([A-Z][A-Z0-9]{1,5})-([A-Z]?\d+(?:\.[A-Za-z0-9][\w-]*)*)((?:\/[A-Z]?\d+(?:\.[A-Za-z0-9][\w-]*)*)*)/g

export function idsInTitle(title) {
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

/**
 * Every `describe`/`it`/`test` declaration in one file, with the facts a
 * verdict needs: is it executable, is it an expected failure, what does its
 * title say, and does a non-executable ancestor contain it.
 *
 * @returns {{decls: object[], errors: string[]}}
 */
export function parseTestFile(rel, text) {
  const decls = []
  const errors = []

  for (const m of text.matchAll(DECL_CALL)) {
    const [, name, chain] = m
    const mods = chain ? chain.slice(1).split('.') : []
    const executableSelf = mods.every((mod) => EXECUTABLE_MODIFIERS.has(mod))
    const expectedFailure = mods.some((mod) => EXPECTED_FAILURE_MODIFIERS.has(mod))
    const curried = mods.some((mod) => CURRIED_MODIFIERS.has(mod))
    const start = m.index
    const openParen = m.index + m[0].length - 1

    // Where do the title and the callback live?
    let argsOpen = openParen
    if (curried) {
      const condClose = matchDelim(text, openParen, '(', ')')
      if (condClose === -1) {
        errors.push(
          `${rel}:${lineAt(text, start)}  could not read the extent of ` +
            `${name}${chain} — unbalanced parentheses; check-evidence cannot ` +
            `tell what is inside it, so nothing in this file is trusted as proof.`,
        )
        continue
      }
      let k = condClose + 1
      while (k < text.length && /\s/.test(text[k])) k++
      if (text[k] !== '(') continue // `.skipIf(cond)` used some other way
      argsOpen = k
    }

    // The title is the first argument, and only if it is a literal string.
    let k = argsOpen + 1
    while (k < text.length && /\s/.test(text[k])) k++
    if (!QUOTES.has(text[k])) continue // `test.skip(cond, msg)` and friends
    const titleEnd = endOfString(text, k)
    if (titleEnd === -1) continue
    const title = text.slice(k + 1, titleEnd - 1)

    // The extent says what a suite contains and what a skipped one hides.
    const end = matchDelim(text, argsOpen, '(', ')')
    if (end === -1) {
      errors.push(
        `${rel}:${lineAt(text, start)}  could not read the extent of ` +
          `${name}${chain}(${JSON.stringify(title)}) — unbalanced parentheses. ` +
          `check-evidence will not guess which titles it contains or hides.`,
      )
    }

    decls.push({
      file: rel,
      name,
      mods,
      title,
      start,
      end: end === -1 ? text.length : end,
      line: lineAt(text, start),
      suite: name === 'describe' || mods.includes('describe'),
      executableSelf,
      expectedFailure,
    })
  }

  // Parent-suite exclusion: a declaration inside a non-executable one is not
  // executable either, whatever its own modifiers say.
  const dead = decls.filter((d) => !d.executableSelf)
  for (const d of decls) {
    const hiddenBy = dead.find((s) => s !== d && d.start > s.start && d.start < s.end)
    d.executable = d.executableSelf && !hiddenBy
    if (hiddenBy) {
      d.expectedFailure = d.expectedFailure || hiddenBy.expectedFailure
      d.hiddenBy = `${hiddenBy.name}.${hiddenBy.mods.join('.')} at ${rel}:${hiddenBy.line}`
    }
  }

  // A suite is a container, not an assertion: its title proves something only
  // while an executable test still runs inside it. Otherwise flipping the one
  // `it` in `describe('DEL-J1: …')` to `it.skip` would leave the suite title
  // standing as proof — the same lie in a different dress.
  for (const d of decls) {
    d.proves =
      d.executable &&
      (!d.suite ||
        decls.some(
          (leaf) => !leaf.suite && leaf.executable && leaf.start > d.start && leaf.start < d.end,
        ))
    if (d.executable && !d.proves) d.emptySuite = true
  }

  return { decls, errors }
}

/** How a disqualified title reads in a failure message. */
function why(decl) {
  const self = decl.mods.length ? `${decl.name}.${decl.mods.join('.')}` : decl.name
  if (!decl.executableSelf) return `${self} — not executable`
  if (decl.hiddenBy) return `${self} inside ${decl.hiddenBy} — not executable`
  if (decl.expectedFailure) return `${self} — an expected failure, not proof`
  if (decl.emptySuite) return `${self} — a suite with no executable test inside it`
  return self
}

export function collectTests(root, testDirs) {
  /** id -> array of declarations carrying it */
  const index = new Map()
  const errors = []
  const declarations = []
  let files = 0

  for (const dir of testDirs) {
    for (const path of walk(join(root, dir))) {
      if (!TEST_FILE.test(path)) continue
      files++
      const text = readFileSync(path, 'utf8')
      const rel = relative(root, path)
      const { decls, errors: fileErrors } = parseTestFile(rel, text)
      errors.push(...fileErrors)
      declarations.push(...decls)
      for (const decl of decls) {
        for (const id of idsInTitle(decl.title)) {
          if (!index.has(id)) index.set(id, [])
          index.get(id).push(decl)
        }
      }
    }
  }
  return { index, errors, files, declarations }
}

// ------------------------------------------------------- runtime test results

const VITEST_EXECUTED = new Set(['passed', 'failed'])
const VITEST_NOT_EXECUTED = new Set(['pending', 'skipped', 'todo', 'disabled'])
const PLAYWRIGHT_EXECUTED = new Set(['passed', 'failed', 'timedOut'])
const PLAYWRIGHT_NOT_EXECUTED = new Set(['skipped', 'interrupted'])

function runtimeRecord(source, file, leafTitle, title, status, executed, expectedFailure = false) {
  return {
    source,
    file,
    leafTitle,
    title,
    status,
    executed,
    expectedFailure,
    ids: idsInTitle(title),
  }
}

/** Normalize Vitest's Jest-compatible JSON report into concrete test leaves. */
export function parseVitestResults(source, report) {
  const records = []
  const errors = []
  if (!Array.isArray(report.testResults)) {
    return { records, errors: [`${source} is not a Vitest JSON report (missing testResults)`] }
  }
  for (const file of report.testResults) {
    if (!Array.isArray(file.assertionResults)) continue
    for (const assertion of file.assertionResults) {
      const ancestors = Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles : []
      const title = [...ancestors, assertion.title].filter((x) => typeof x === 'string').join(' ')
      const status = assertion.status
      if (!VITEST_EXECUTED.has(status) && !VITEST_NOT_EXECUTED.has(status)) {
        errors.push(
          `${source}: Vitest test ${JSON.stringify(title)} has unknown status ` +
            JSON.stringify(status),
        )
        continue
      }
      records.push(
        runtimeRecord(source, file.name ?? '', assertion.title ?? '', title, status,
          VITEST_EXECUTED.has(status)),
      )
    }
  }
  return { records, errors }
}

/** Normalize Playwright's nested suites/specs JSON into concrete project tests. */
export function parsePlaywrightResults(source, report) {
  const records = []
  const errors = []
  if (!Array.isArray(report.suites)) {
    return { records, errors: [`${source} is not a Playwright JSON report (missing suites)`] }
  }

  function visit(suite, ancestors) {
    const titles = suite.title ? [...ancestors, suite.title] : ancestors
    for (const spec of suite.specs ?? []) {
      const title = [...titles, spec.title].filter((x) => typeof x === 'string').join(' ')
      for (const projectTest of spec.tests ?? []) {
        const statuses = (projectTest.results ?? []).map((r) => r.status)
        const unknown = statuses.find(
          (s) => !PLAYWRIGHT_EXECUTED.has(s) && !PLAYWRIGHT_NOT_EXECUTED.has(s),
        )
        if (unknown !== undefined) {
          errors.push(
            `${source}: Playwright test ${JSON.stringify(title)} has unknown ` +
              `status ${JSON.stringify(unknown)}`,
          )
          continue
        }
        const executed = statuses.some((s) => PLAYWRIGHT_EXECUTED.has(s))
        records.push(runtimeRecord(
          source,
          spec.file ?? suite.file ?? '',
          spec.title ?? '',
          title,
          statuses.length ? statuses.join('/') : 'unreported',
          executed,
          projectTest.expectedStatus !== undefined && projectTest.expectedStatus !== 'passed',
        ))
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles)
  }

  for (const suite of report.suites) visit(suite, [])
  return { records, errors }
}

/** Read and combine Vitest and Playwright JSON result files. */
export function collectRuntimeResults(root, resultFiles, declarations = []) {
  const records = []
  const errors = []
  for (const resultFile of resultFiles) {
    const path = resolve(root, resultFile)
    let report
    try {
      report = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      errors.push(`${resultFile}: cannot read test results: ${error.message}`)
      continue
    }
    const parsed = Array.isArray(report.testResults)
      ? parseVitestResults(resultFile, report)
      : parsePlaywrightResults(resultFile, report)
    records.push(...parsed.records)
    errors.push(...parsed.errors)
  }

  // Playwright exposes expectedStatus in its JSON. Vitest does not, so join
  // each concrete Vitest leaf back to the static declaration by file+title.
  // A duplicate plain/.fails title is conservatively treated as expected-
  // failure: ambiguous runtime evidence must not make a proof green.
  const expectedVitest = declarations.filter((d) => !d.suite && d.expectedFailure)
  for (const record of records) {
    if (record.expectedFailure || !record.file) continue
    const runtimeFile = resolve(root, record.file)
    record.expectedFailure = expectedVitest.some(
      (decl) => resolve(root, decl.file) === runtimeFile && decl.title === record.leafTitle,
    )
  }
  return { records, errors }
}

// -------------------------------------------------------------------- check

/**
 * The whole check, over explicit roots so tests can point it at a fixture
 * tree. The CLI below is the only caller that supplies the real repo.
 */
export function checkEvidence({
  root = ROOT,
  requiredSpecDirs = REQUIRED_SPEC_DIRS,
  watchedSpecDirs = WATCHED_SPEC_DIRS,
  testDirs = TEST_DIRS,
  resultFiles = [],
} = {}) {
  const failures = []
  const warnings = []
  const specs = []

  const docs = []
  for (const dir of requiredSpecDirs) {
    for (const path of walk(join(root, dir))) {
      if (path.endsWith('.md')) docs.push({ path, required: true })
    }
  }
  for (const dir of watchedSpecDirs) {
    for (const path of walk(join(root, dir))) {
      if (path.endsWith('.md')) docs.push({ path, required: false })
    }
  }

  for (const { path, required } of docs) {
    const rel = relative(root, path)
    const text = readFileSync(path, 'utf8')
    const part = parseParticipation(text)

    if (part.mode === 'both') {
      failures.push(
        `${rel}:${part.modeLine}  declares "**IDs:**" (line ${part.idsLine}) AND ` +
          `"**Evidence mode:** excluded" — a document is accountable or exempt, ` +
          `never both. Delete one.`,
      )
      continue
    }
    if (part.mode === 'unknown') {
      failures.push(
        `${rel}:${part.modeLine}  unknown evidence mode "${part.badMode}" — the ` +
          `only mode is "excluded" ("**Evidence mode:** excluded — <reason>"); ` +
          `a participating document uses "**IDs:**" instead.`,
      )
      continue
    }
    if (part.mode === 'excluded') {
      if (!part.reason) {
        failures.push(
          `${rel}:${part.modeLine}  is excluded from the evidence check with no ` +
            `reason — write "**Evidence mode:** excluded — <why this document ` +
            `declares no obligations>".`,
        )
      }
      if (part.verdictLines.length) {
        failures.push(
          `${rel}:${part.verdictLines[0]}  is excluded from the evidence check ` +
            `but carries ${part.verdictLines.length} "> evidence:" verdict(s) — ` +
            `a document cannot claim proof and opt out of the check. Declare ` +
            `"**IDs:**" instead.`,
        )
      }
      continue
    }
    if (part.mode === 'none') {
      if (required) {
        failures.push(
          `${rel}  declares no participation in the evidence check. Every ` +
            `document under ${requiredSpecDirs.join(', ')} must carry either ` +
            `"**IDs:** \`FAM-J*\` …" or "**Evidence mode:** excluded — <reason>".`,
        )
      } else if (part.verdictLines.length) {
        failures.push(
          `${rel}:${part.verdictLines[0]}  carries ` +
            `${part.verdictLines.length} "> evidence:" verdict(s) but declares ` +
            `no "**IDs:**" line, so the check would ignore it. Add the IDs line ` +
            `(or "**Evidence mode:** excluded — <reason>" and drop the verdicts).`,
        )
      }
      continue
    }

    // mode === 'ids'
    if (part.patterns.length === 0) {
      failures.push(
        `${rel}:${part.idsLine}  the "**IDs:**" line names no \`pattern\` — ` +
          `the document would own nothing and its verdicts would go unchecked. ` +
          `Write "**IDs:** \`FAM-J*\` journeys · …".`,
      )
      continue
    }
    const spec = parseSpec(rel, text)
    if (spec) specs.push(spec)
  }

  const {
    index,
    errors: testErrors,
    files: testFiles,
    declarations,
  } = collectTests(root, testDirs)
  failures.push(...testErrors)
  const runtime = collectRuntimeResults(root, resultFiles, declarations)
  failures.push(...runtime.errors)

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
      const hits = joins.flatMap((j) => index.get(j) ?? [])
      const proof = hits.filter((d) => d.proves && !d.expectedFailure)

      // A "via" that names no title at all is a dead pointer — the alias
      // reads as corroboration and corroborates nothing.
      for (const alias of v.via) {
        if ((index.get(alias) ?? []).length === 0) {
          failures.push(
            `${spec.file}:${v.line}  ${v.id} claims "via ${alias}", but no test ` +
              `title carries ${alias}. Name a title that exists, or drop the alias.`,
          )
        }
      }

      if (MUST_LINK.has(v.status) && proof.length === 0) {
        const what = v.via.length ? joins.join(' or ') : v.id
        const detail = hits.length
          ? `the only title(s) carrying ${what} cannot prove it: ` +
            hits.map((d) => `${d.file}:${d.line} (${why(d)})`).join(', ')
          : `no test title carries ${what}`
        failures.push(
          `${spec.file}:${v.line}  ${v.id} is marked "${v.status}" but ${detail}. ` +
            `Add the ID to the proving test's name, name the joining title with ` +
            `"via <ID>", or migrate the verdict to gap.`,
        )
      }
      if (resultFiles.length > 0 && MUST_LINK.has(v.status)) {
        const runtimeHits = runtime.records.filter(
          (record) =>
            !record.expectedFailure && joins.some((joinId) => record.ids.has(joinId)),
        )
        if (runtimeHits.length === 0) {
          failures.push(
            `${spec.file}:${v.line}  ${v.id} is marked "${v.status}" but no ` +
              `concrete test carrying ${joins.join(' or ')} was reported by the ` +
              `combined runtime results. Check runner inclusion/report uploads, or ` +
              `migrate the verdict to gap.`,
          )
        } else if (!runtimeHits.some((record) => record.executed)) {
          failures.push(
            `${spec.file}:${v.line}  ${v.id} is marked "${v.status}" but every ` +
              `matching concrete test was skipped or unreported at runtime: ` +
              runtimeHits
                .map((record) => `${record.source} (${record.status}: ${record.title})`)
                .join(', ') +
              `. At least one matching test must execute.`,
          )
        }
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
        const carries = new RegExp(`#${issue}(?!\\d)`)
        const pins = hits.filter(
          (d) => d.executable && d.expectedFailure && carries.test(d.title),
        )
        if (pins.length === 0) {
          const near = hits.length
            ? ` Titles carrying ${v.id}: ` +
              hits.map((d) => `${d.file}:${d.line} (${why(d)})`).join(', ') + '.'
            : ''
          failures.push(
            `${spec.file}:${v.line}  ${v.id} pins #${issue}, but no executable ` +
              `expected-failure test (it.fails/test.fails) has a title carrying ` +
              `both ${v.id} and #${issue} — an issue number in a comment, a ` +
              `skipped test, or a plain test does not pin a defect.${near}`,
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
  for (const [id, decls] of index) {
    if (!families.has(id.split('-')[0])) continue
    if (specIds.has(id) || viaTargets.has(id)) continue
    warnings.push(
      `${decls[0].file}:${decls[0].line}  test names ${id}, which no spec declares ` +
        `(${decls.length} test${decls.length === 1 ? '' : 's'})`,
    )
  }

  const total = [...byStatus.values()].reduce((a, b) => a + b, 0)
  return {
    failures,
    warnings,
    byStatus,
    total,
    specs,
    testFiles,
    runtimeTests: runtime.records.length,
    resultFiles: resultFiles.length,
  }
}

// ---------------------------------------------------------------------- cli

export function main(argv = process.argv) {
  const quiet = argv.includes('--quiet')
  const resultsAt = argv.indexOf('--results')
  const resultFiles =
    resultsAt === -1
      ? []
      : argv.slice(resultsAt + 1).filter((arg) => !arg.startsWith('--'))
  if (resultsAt !== -1 && resultFiles.length === 0) {
    console.error('evidence check FAILED — --results requires at least one JSON result file')
    return 1
  }
  const {
    failures,
    warnings,
    byStatus,
    total,
    specs,
    testFiles,
    runtimeTests,
  } = checkEvidence({ resultFiles })

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
    return 1
  }

  console.log(
    `evidence check passed — ${total} verdicts across ${specs.length} specs ` +
      `(${tally}); ${testFiles} test files scanned` +
      (resultFiles.length ? `; ${runtimeTests} runtime tests checked.` : '.'),
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
