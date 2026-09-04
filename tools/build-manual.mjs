#!/usr/bin/env node
/**
 * build-manual — the spreadsheet-import field guide, generated.
 *
 *   node tools/build-manual.mjs      (from the repo root)
 *   pnpm manual:build
 *
 * HTML IS A VIEW, NEVER A SOURCE. docs/manual/spreadsheet-import.html used to
 * be hand-authored, which meant the manual and the spec drifted the moment
 * either was edited. This script makes the manual a rendering of exactly one
 * behavioural source — docs/specs/0008-spreadsheet-import.md — so a sentence
 * about what the wizard does exists in one place. Fix the spec, rebuild.
 *
 * The only things this file may add on its own are FRAME: the page chrome,
 * the three lenses, "Before you start", and the session instrument (ticks,
 * observations, matrix, export). Every behavioural claim comes off the spec.
 *
 * Two other inputs, both facts rather than claims:
 *   - docs/manual/fixtures/manifest.json — written by make-fixtures.mjs, so
 *     the fixture catalog describes files that actually exist;
 *   - docs/manual/shots/ — a step whose PNG is on disk shows it.
 *
 * THE PARSER IS DELIBERATELY BORING. When the spec's structure surprises it,
 * it FAILS naming the spec line rather than guessing: a manual that quietly
 * drops a step is worse than a build that stops. Zero dependencies.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // <root>/tools
const ROOT = join(HERE, '..')
const SPEC_REL = 'docs/specs/0008-spreadsheet-import.md'
const OUT_REL = 'docs/manual/spreadsheet-import.html'
const SPEC_DIR = 'docs/specs'
const MANUAL_DIR = 'docs/manual'

/** Stop the build, naming the spec line the parser choked on. */
class SpecShapeError extends Error {}
const fail = (lineNo, message) => {
  throw new SpecShapeError(`${SPEC_REL}:${lineNo} — ${message}`)
}

/* ================================================================== *
 * 1. A small markdown renderer, tuned to this one spec
 * ================================================================== */

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const attr = (s) => esc(s).replace(/"/g, '&quot;')

/** Rewrite a spec-relative link so it still resolves from docs/manual/. */
function rewriteLink(url) {
  if (/^(https?:|mailto:|#)/.test(url)) return url
  return posix.relative(MANUAL_DIR, posix.normalize(posix.join(SPEC_DIR, url)))
}

/** Inline markdown: code, links, bold, italic. Order matters. */
function inline(s) {
  const codes = []
  // Pull code spans out first so their contents are never re-parsed.
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
  s = esc(s)
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t, u) =>
      /^https?:/.test(u)
        ? `<a href="${attr(u)}" target="_blank" rel="noopener">${t}</a>`
        : `<a href="${attr(rewriteLink(u))}">${t}</a>`,
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(—·])\*([^*\n]+)\*(?=[\s).,;:!?—]|$)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`)
}

const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l ?? '')
const splitRow = (l) =>
  l
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())

/** Block markdown: paragraphs, lists (2 levels), tables. */
function renderMd(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) {
      i++
      continue
    }
    if (/^\s*\|/.test(line) && isTableSep(lines[i + 1])) {
      const head = splitRow(line).map(inline)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]).map(inline))
      out.push(
        `<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      )
      continue
    }
    if (/^(\s*)([-*])\s+/.test(line)) {
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*])\s+(.*)$/)
        if (m) {
          items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[3] })
          i++
        } else if (/^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim()
          i++
        } else break
      }
      let html = '<ul>'
      let liOpen = false
      let subOpen = false
      for (const it of items) {
        if (it.depth === 0) {
          if (subOpen) {
            html += '</ul>'
            subOpen = false
          }
          if (liOpen) html += '</li>'
          html += `<li>${inline(it.text)}`
          liOpen = true
        } else {
          if (!liOpen) {
            html += '<li>'
            liOpen = true
          }
          if (!subOpen) {
            html += '<ul>'
            subOpen = true
          }
          html += `<li>${inline(it.text)}</li>`
        }
      }
      if (subOpen) html += '</ul>'
      if (liOpen) html += '</li>'
      out.push(html + '</ul>')
      continue
    }
    const buf = [line]
    i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(\s*\||\s*[-*]\s|#{1,6}\s)/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${inline(buf.map((l) => l.trim()).join(' ').trim())}</p>`)
  }
  return out.join('\n')
}

/* ================================================================== *
 * 2. The spec parser
 * ================================================================== */

// The same grammar tools/check-evidence.mjs reads, so the manual and the
// linkage check can never disagree about what a verdict says.
const VERDICT = /^\s*>\s*evidence(?:\s+([A-Za-z][A-Za-z0-9._-]*))?:\s*(\S+)(.*)$/
const CONTINUATION = /^\s*>(.*)$/
const STATUSES = new Set(['proven', 'gap', 'pinned', 'rule-tier'])

/**
 * One `> evidence:` block, already split into its machine-read head and note.
 * `offset` is where `lines[0]` sits in the whole document, so a refusal names
 * the spec line a reader can open rather than an index into some slice.
 */
function readVerdict(lines, start, defaultId, offset) {
  const m = lines[start].match(VERDICT)
  const [, explicitId, rawStatus] = m
  let rest = m[3]
  let i = start + 1
  while (i < lines.length && CONTINUATION.test(lines[i]) && !VERDICT.test(lines[i])) {
    rest += ' ' + lines[i].match(CONTINUATION)[1]
    i++
  }
  const status = rawStatus.replace(/[.,;:]$/, '')
  if (!STATUSES.has(status)) {
    fail(
      offset + start + 1,
      `evidence verdict has unknown status "${status}" — expected one of ${[...STATUSES].join(', ')}`,
    )
  }
  const flat = rest.replace(/\s+/g, ' ').trim()
  const dash = flat.indexOf('—')
  const head = dash === -1 ? flat : flat.slice(0, dash)
  const note = dash === -1 ? '' : flat.slice(dash + 1).trim()
  const viaMatch = head.match(/(?:^|\s)via\s+(.+)$/)
  const via = viaMatch
    ? viaMatch[1]
        .split(/[,\s]+/)
        .map((t) => t.replace(/^`|[`.,;]+$/g, ''))
        .filter(Boolean)
    : []
  const issues = [...head.matchAll(/#(\d+)/g)].map((x) => Number(x[1]))
  if (!explicitId && !defaultId) fail(offset + start + 1, 'evidence verdict is not under any declared obligation')
  return { end: i, verdict: { id: explicitId ?? defaultId, sub: explicitId ?? null, status, via, issues, note, line: start + 1 } }
}

/**
 * Walk a block of lines, splitting it into ordered markdown chunks and
 * verdicts. A verdict is never left inside the prose, so no section can
 * render its own evidence line twice.
 */
function splitBlocks(lines, offset, defaultId) {
  const blocks = []
  let buf = []
  // One block per paragraph (blank-line separated), so a single paragraph can
  // be shown in some lenses and not others without slicing rendered HTML.
  const flush = () => {
    let group = []
    const emit = () => {
      if (group.join('\n').trim()) blocks.push({ kind: 'md', html: renderMd(dedent(group)) })
      group = []
    }
    for (const l of buf) {
      if (l.trim() === '') emit()
      else group.push(l)
    }
    emit()
    buf = []
  }
  for (let i = 0; i < lines.length; ) {
    if (VERDICT.test(lines[i])) {
      flush()
      const { end, verdict } = readVerdict(lines, i, defaultId, offset)
      // Re-base the line number onto the whole document.
      verdict.line += offset
      blocks.push({ kind: 'verdict', verdict })
      i = end
      continue
    }
    buf.push(lines[i])
    i++
  }
  flush()
  return blocks
}

/** Remove the common leading indentation (invariant/hazard bullet bodies). */
function dedent(lines) {
  const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length)
  const n = widths.length ? Math.min(...widths) : 0
  return lines.map((l) => l.slice(n)).join('\n')
}

export function parseSpec(md) {
  const raw = md.split('\n')

  // Blank out fenced code and pull the one HTML comment aside — a spec that
  // SHOWS the verdict format must not be read as declaring one.
  const lines = []
  const commentLines = []
  let fenced = false
  let inComment = false
  for (const l of raw) {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced
      lines.push('')
      continue
    }
    if (!fenced && /^\s*<!--/.test(l)) inComment = true
    if (inComment) {
      const body = l.replace(/^\s*<!--/, '').replace(/-->\s*$/, '')
      if (!/^[A-Z ,]*$/.test(body) || body.trim()) commentLines.push(body)
      if (/-->\s*$/.test(l)) inComment = false
      lines.push('')
      continue
    }
    lines.push(fenced ? '' : l)
  }

  const title = (lines[0] ?? '').match(/^#\s+(.*)$/)?.[1]
  if (!title) fail(1, 'expected the document to open with a level-1 heading')

  // ---- level-2 sections ------------------------------------------------
  const sections = []
  lines.forEach((l, i) => {
    const m = l.match(/^##\s+(.*)$/)
    if (m) sections.push({ heading: m[1], start: i, body: [] })
  })
  if (!sections.length) fail(1, 'no level-2 sections found')
  sections.forEach((s, n) => {
    s.body = lines.slice(s.start + 1, n + 1 < sections.length ? sections[n + 1].start : lines.length)
  })
  const sectionAt = (test) => sections.find((s) => test(s.heading))

  // ---- front matter ----------------------------------------------------
  const front = {}
  {
    const head = lines.slice(1, sections[0].start)
    let key = null
    for (const l of head) {
      const m = l.match(/^\*\*(IDs|Evidence|Provenance):\*\*\s*(.*)$/)
      if (m) {
        key = m[1]
        front[key] = m[2]
      } else if (key && l.trim()) front[key] += ' ' + l.trim()
      else key = null
    }
    for (const k of ['IDs', 'Evidence', 'Provenance']) {
      if (!front[k]) fail(2, `front matter is missing its **${k}:** field`)
    }
  }

  // ---- the jobs --------------------------------------------------------
  const jobsSection = sectionAt((h) => /^The jobs$/.test(h))
  if (!jobsSection) fail(1, 'no "## The jobs" section')
  const jobs = []
  {
    const text = jobsSection.body.join('\n')
    for (const para of text.split(/\n\s*\n/)) {
      const flat = para.replace(/\s+/g, ' ').trim()
      if (!flat) continue
      const m = flat.match(/^\*\*(IMP-J\d+)\s+—\s+(.*?)\*\*\s*(.*)$/)
      if (!m) fail(jobsSection.start + 1, `"The jobs" paragraph is not **IMP-J<n> — "…"** shaped: ${flat.slice(0, 60)}…`)
      jobs.push({ id: m[1], headline: inline(m[2]), html: inline(m[3]) })
    }
    if (!jobs.length) fail(jobsSection.start + 1, '"The jobs" section declares no journeys')
  }

  // ---- the fixture -----------------------------------------------------
  const fixtureSection = sectionAt((h) => /^The fixture\b/.test(h))
  if (!fixtureSection) fail(1, 'no "## The fixture" section')

  // ---- journeys --------------------------------------------------------
  const STEP_HEADER = ['#', 'Where / do', 'Must observably see', 'Bug if', 'Rules']
  const journeys = []
  for (const s of sections) {
    const m = s.heading.match(/^(IMP-J\d+)\s+—\s+(.*?)(?:\s+\*\((.+)\)\*)?$/)
    if (!m) continue
    const [, id, jTitle, shape] = m
    const body = s.body

    // The step table.
    const tableAt = body.findIndex((l, i) => /^\s*\|\s*#\s*\|/.test(l) && isTableSep(body[i + 1]))
    if (tableAt === -1) fail(s.start + 1, `${id} has no step table (a row starting "| # |")`)
    const header = splitRow(body[tableAt])
    if (header.length !== STEP_HEADER.length || header.some((c, i) => c !== STEP_HEADER[i])) {
      fail(
        s.start + tableAt + 2,
        `${id}'s step table header is [${header.join(' | ')}] — expected [${STEP_HEADER.join(' | ')}]`,
      )
    }
    const steps = []
    let i = tableAt + 2
    for (; i < body.length && /^\s*\|/.test(body[i]); i++) {
      const lineNo = s.start + i + 2
      const cells = splitRow(body[i])
      if (cells.length !== STEP_HEADER.length) {
        fail(lineNo, `${id} step row has ${cells.length} cells, expected ${STEP_HEADER.length}`)
      }
      const [stepId, doCell, seeCell, bugCell, rulesCell] = cells
      if (!/^J\d+\.\d+[a-z]?$/.test(stepId)) fail(lineNo, `"${stepId}" is not a step id (J<journey>.<n>, optional letter suffix)`)
      if (!doCell) fail(lineNo, `${stepId} has an empty "Where / do"`)
      if (!seeCell) fail(lineNo, `${stepId} has an empty "Must observably see"`)
      const slot = `IMP-${stepId}`
      steps.push({
        id: stepId,
        slot,
        doHtml: inline(doCell),
        seeHtml: inline(seeCell),
        bugHtml: bugCell ? inline(bugCell) : '',
        rules: rulesCell
          ? rulesCell
              .split(',')
              .map((r) => r.trim())
              .filter(Boolean)
          : [],
        line: lineNo,
      })
    }
    if (!steps.length) fail(s.start + tableAt + 2, `${id}'s step table has no rows`)

    // Everything else in the section: prose before the table, prose after
    // it, and any verdicts (the section's own, plus sub-verdicts like
    // IMP-J2.hand-picked which sit among the branch paragraphs).
    const lead = splitBlocks(body.slice(0, tableAt), s.start + 1, id)
    const tail = splitBlocks(body.slice(i), s.start + i + 1, id)
    const verdicts = [...lead, ...tail].filter((b) => b.kind === 'verdict').map((b) => b.verdict)
    if (!verdicts.length) fail(s.start + 1, `${id} carries no "> evidence:" verdict`)
    const main = verdicts.find((v) => !v.sub)
    if (!main) fail(s.start + 1, `${id}'s only verdicts are sub-verdicts — the journey itself claims nothing`)

    journeys.push({
      id,
      num: Number(id.slice(5)),
      title: inline(jTitle),
      shape: shape ?? '',
      verdict: main,
      subVerdicts: verdicts.filter((v) => v.sub),
      steps,
      lead: lead.filter((b) => b.kind === 'md'),
      tail,
      line: s.start + 1,
    })
  }
  if (!journeys.length) fail(1, 'no journey sections found')

  // Every declared job must have a section, and every section a job.
  const jobIds = new Set(jobs.map((j) => j.id))
  const journeyIds = new Set(journeys.map((j) => j.id))
  for (const j of jobs) if (!journeyIds.has(j.id)) fail(jobsSection.start + 1, `"The jobs" declares ${j.id} but no section walks it`)
  for (const j of journeys) if (!jobIds.has(j.id)) fail(j.line, `${j.id} has a section but is not declared in "The jobs"`)

  // ---- rules -----------------------------------------------------------
  const rulesSection = sectionAt((h) => /^The rules$/.test(h))
  if (!rulesSection) fail(1, 'no "## The rules" section')
  const rules = []
  let inherited = null
  {
    const body = rulesSection.body
    const heads = []
    body.forEach((l, i) => {
      const h = l.match(/^###\s+(.*)$/)
      if (h) heads.push({ heading: h[1], at: i })
    })
    if (!heads.length) fail(rulesSection.start + 1, '"The rules" has no level-3 subsections')
    heads.forEach((h, n) => {
      const chunk = body.slice(h.at + 1, n + 1 < heads.length ? heads[n + 1].at : body.length)
      const offset = rulesSection.start + h.at + 2
      const m = h.heading.match(/^(IMP-R\d+)\s+—\s+(.*?)(?:\s+·\s+`shape:\s*([a-z-]+)`)?$/)
      if (!m) {
        // The one non-rule subsection is the inherited table.
        if (inherited) fail(offset, `unexpected second non-rule subsection under "The rules": ${h.heading}`)
        inherited = { heading: inline(h.heading), html: renderMd(chunk.join('\n')) }
        return
      }
      const blocks = splitBlocks(chunk, offset, m[1])
      const verdict = blocks.find((b) => b.kind === 'verdict')?.verdict
      if (!verdict) fail(offset, `${m[1]} carries no "> evidence:" verdict`)
      if (!m[3]) fail(offset, `${m[1]} declares no \`shape:\` — expected "· \`shape: …\`" on its heading`)
      rules.push({
        id: m[1],
        name: inline(m[2]),
        shape: m[3],
        verdict,
        blocks: blocks.filter((b) => b.kind === 'md'),
        line: offset,
      })
    })
    if (!inherited) fail(rulesSection.start + 1, '"The rules" declares no inherited-rules subsection')
    if (!rules.length) fail(rulesSection.start + 1, '"The rules" declares no IMP-R rules')
  }

  // ---- invariants and hazards (bullet-declared) ------------------------
  const bulletObligations = (heading, family) => {
    const s = sectionAt((h) => h === heading)
    if (!s) fail(1, `no "## ${heading}" section`)
    const items = []
    let cur = null
    s.body.forEach((l, i) => {
      const m = l.match(/^-\s+\*\*(IMP-[A-Z]\d+)\s+—\s+(.*?)\*\*\s*(.*)$/)
      if (m) {
        if (!m[1].startsWith(`IMP-${family}`)) fail(s.start + i + 2, `${m[1]} is declared under "${heading}"`)
        cur = { id: m[1], name: inline(m[2]), lines: [m[3]], at: s.start + i + 2 }
        items.push(cur)
      } else if (cur) cur.lines.push(l)
      else if (l.trim()) fail(s.start + i + 2, `"${heading}" has prose before its first "- **ID — …**" bullet`)
    })
    if (!items.length) fail(s.start + 1, `"${heading}" declares nothing`)
    return items.map((it) => {
      const blocks = splitBlocks(it.lines, it.at - 1, it.id)
      const verdict = blocks.find((b) => b.kind === 'verdict')?.verdict
      if (!verdict) fail(it.at, `${it.id} carries no "> evidence:" verdict`)
      return { id: it.id, name: it.name, verdict, blocks: blocks.filter((b) => b.kind === 'md'), line: it.at }
    })
  }
  const invariants = bulletObligations('Invariants', 'I')
  const hazards = bulletObligations('Hazards', 'H')

  // ---- open questions --------------------------------------------------
  const qSection = sectionAt((h) => /^Open questions\b/.test(h))
  if (!qSection) fail(1, 'no "## Open questions" section')
  const questions = []
  {
    const body = qSection.body
    const at = body.findIndex((l, i) => /^\s*\|/.test(l) && isTableSep(body[i + 1]))
    if (at === -1) fail(qSection.start + 1, '"Open questions" has no table')
    const header = splitRow(body[at])
    const want = ['#', 'Question', 'Blocked on']
    if (header.length !== 3 || header.some((c, i) => c !== want[i])) {
      fail(qSection.start + at + 2, `"Open questions" header is [${header.join(' | ')}] — expected [${want.join(' | ')}]`)
    }
    for (let i = at + 2; i < body.length && /^\s*\|/.test(body[i]); i++) {
      const cells = splitRow(body[i])
      if (cells.length !== 3) fail(qSection.start + i + 2, `open-question row has ${cells.length} cells, expected 3`)
      if (!/^Q\d+$/.test(cells[0])) fail(qSection.start + i + 2, `"${cells[0]}" is not a question id (Q<n>)`)
      questions.push({ id: cells[0], html: inline(cells[1]), blockedOn: inline(cells[2]) })
    }
    const arbiter = qSection.heading.match(/\*\((.+)\)\*/)?.[1] ?? ''
    if (!questions.length) fail(qSection.start + 1, '"Open questions" table has no rows')
    questions.arbiter = inline(arbiter)
  }

  const closure = sectionAt((h) => /^Closure sweep$/.test(h))
  if (!closure) fail(1, 'no "## Closure sweep" section')

  return {
    title: inline(title.replace(/^Feature:\s*/, '')),
    front,
    // The one HTML comment is a plain-text note to reviewers, not markdown —
    // rendered with its own shape kept rather than reflowed into a paragraph.
    departures: commentLines.length ? `<pre class="specnote">${esc(dedent(commentLines).trim())}</pre>` : '',
    jobs,
    fixture: { heading: inline(fixtureSection.heading), html: renderMd(fixtureSection.body.join('\n')) },
    journeys,
    inherited,
    rules,
    invariants,
    hazards,
    questions,
    closure: { heading: inline(closure.heading), html: renderMd(closure.body.join('\n')) },
  }
}

/* ================================================================== *
 * 3. Verdict badges — witnessed status, derived and never hand-marked
 * ================================================================== */

const REPO = 'https://github.com/siraj-samsudeen/featherbase'

/** proven → witnessed · proven via → witnessed via · gap → unwitnessed. */
function verdictKind(v) {
  if (v.status === 'pinned') return 'pinned'
  if (v.status === 'proven') return v.via.length ? 'proven-via' : 'proven'
  if (v.status === 'rule-tier') return 'rule-tier'
  return 'gap'
}
const KIND_LABEL = {
  proven: 'proven',
  'proven-via': 'proven via',
  gap: 'gap',
  pinned: 'pinned',
  'rule-tier': 'rule tier',
}
const JOURNEY_LABEL = {
  proven: 'witnessed',
  'proven-via': 'witnessed via',
  gap: 'unwitnessed',
  pinned: 'pinned defect',
  'rule-tier': 'rule tier only',
}

function badge(v, labels = KIND_LABEL) {
  const kind = verdictKind(v)
  const via = v.via.length ? ` <span class="via">${v.via.map(esc).join(', ')}</span>` : ''
  const issues = v.issues
    .map((n) => ` <a class="issue" href="${REPO}/issues/${n}" target="_blank" rel="noopener">#${n}</a>`)
    .join('')
  const tip = v.note.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
  return `<span class="badge b-${kind}" title="${attr(tip)}">${labels[kind]}${via}${issues}</span>`
}

function verdictBlock(v) {
  return `<div class="verdict" data-lens-only="build">${badge(v)}${
    v.sub ? `<span class="subid">${esc(v.sub)}</span>` : ''
  }<span class="vnote">${inline(v.note)}</span><span class="vline">${SPEC_REL}:${v.line}</span></div>`
}

/* ================================================================== *
 * 4. The fixture catalog — the manifest joined against what is on disk
 * ================================================================== */

function fixtureCatalog() {
  const dir = join(ROOT, MANUAL_DIR, 'fixtures')
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new SpecShapeError(
      `${MANUAL_DIR}/fixtures/manifest.json is missing — run \`pnpm manual:fixtures\` before building the manual`,
    )
  }
  const { fixtures } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const onDisk = new Set(readdirSync(dir).filter((f) => f !== 'manifest.json' && f !== 'make-fixtures.mjs'))
  for (const f of fixtures) {
    if (!onDisk.has(f.file)) {
      throw new SpecShapeError(`fixtures/manifest.json describes ${f.file}, which is not on disk — re-run \`pnpm manual:fixtures\``)
    }
    onDisk.delete(f.file)
  }
  if (onDisk.size) {
    throw new SpecShapeError(
      `fixtures/ holds files the manifest does not describe: ${[...onDisk].sort().join(', ')} — describe them in make-fixtures.mjs or delete them`,
    )
  }
  return fixtures
}

/* ================================================================== *
 * 5. Render
 * ================================================================== */

const CSS = `
:root {
  --ground: #f5f7f5;
  --surface: #ffffff;
  --surface-2: #eef2ee;
  --ink: #22312a;
  --muted: #5d6c64;
  --faint: #8b978f;
  --line: #dde4df;
  --line-strong: #c3cec7;
  --accent: #1e7a5a;
  --accent-soft: #e2f0e9;
  --accent-ink: #14513c;
  --amber-ink: #8a5a0b;
  --amber-soft: #f8efdd;
  --fail-ink: #a63c2c;
  --fail-soft: #f8e6e1;
  --sketch-ink: #4a5a52;
  --shadow: 0 1px 2px rgba(34, 49, 42, .06), 0 8px 24px rgba(34, 49, 42, .07);
  --display: "Bricolage Grotesque", "Avenir Next", "Trebuchet MS", sans-serif;
  --body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #131916;
    --surface: #1b221e;
    --surface-2: #202924;
    --ink: #e4eae5;
    --muted: #9aa8a0;
    --faint: #74827a;
    --line: #2b352f;
    --line-strong: #3c4841;
    --accent: #52c093;
    --accent-soft: #1d3a2e;
    --accent-ink: #7fd6b2;
    --amber-ink: #e0aa54;
    --amber-soft: #3a2f1a;
    --fail-ink: #e08a76;
    --fail-soft: #3f241e;
    --sketch-ink: #aebbb2;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .25);
  }
}
:root[data-theme="dark"] {
  --ground: #131916;
  --surface: #1b221e;
  --surface-2: #202924;
  --ink: #e4eae5;
  --muted: #9aa8a0;
  --faint: #74827a;
  --line: #2b352f;
  --line-strong: #3c4841;
  --accent: #52c093;
  --accent-soft: #1d3a2e;
  --accent-ink: #7fd6b2;
  --amber-ink: #e0aa54;
  --amber-soft: #3a2f1a;
  --fail-ink: #e08a76;
  --fail-soft: #3f241e;
  --sketch-ink: #aebbb2;
  --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .25);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 2rem; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--body);
  font-size: 1.0625rem;
  line-height: 1.65;
}

.shell {
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  max-width: 1180px;
  margin: 0 auto;
  gap: 2.5rem;
  padding: 0 1.5rem;
}

/* ---------- rail ---------- */
.rail {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100dvh;
  overflow-y: auto;
  padding: 2.2rem 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.brand { font-family: var(--display); }
.brand .eyebrow {
  display: block;
  font-size: .68rem;
  font-weight: 600;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: .3rem;
}
.brand .name { font-size: 1.15rem; font-weight: 700; line-height: 1.25; }

/* ---------- lens switcher ---------- */
.lenses { display: flex; flex-direction: column; gap: .3rem; }
.lenses .lenshead {
  font-family: var(--display);
  font-size: .66rem;
  font-weight: 600;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--faint);
  padding: 0 .1rem;
}
.lensbtns { display: flex; gap: .25rem; background: var(--surface-2); border-radius: 9px; padding: .22rem; }
button.lens {
  flex: 1;
  font-family: var(--display);
  font-size: .76rem;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: .34rem .2rem;
  cursor: pointer;
}
button.lens:hover { color: var(--ink); }
button.lens[aria-pressed="true"] {
  background: var(--surface);
  color: var(--accent-ink);
  border-color: var(--line-strong);
  box-shadow: 0 1px 2px rgba(0,0,0,.06);
}
button.lens:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lenswhat { font-size: .78rem; color: var(--muted); font-family: var(--display); line-height: 1.4; min-height: 2.5em; }

.toc { display: flex; flex-direction: column; gap: .12rem; font-family: var(--display); }
.toc a {
  display: flex;
  align-items: baseline;
  gap: .55rem;
  padding: .3rem .6rem;
  border-radius: 7px;
  color: var(--muted);
  text-decoration: none;
  font-size: .83rem;
  font-weight: 600;
  line-height: 1.3;
}
.toc a:hover { background: var(--surface-2); color: var(--ink); }
.toc .part {
  margin-top: .7rem;
  padding: 0 .6rem;
  font-size: .66rem;
  font-weight: 600;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--faint);
}
.toc .jnum { font-family: var(--mono); font-size: .7rem; color: var(--faint); min-width: 1.1em; }
.toc .prog {
  margin-left: auto;
  font-family: var(--mono);
  font-size: .66rem;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.toc .prog.done { color: var(--accent); font-weight: 600; }
.rail-tools {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: .6rem;
  border-top: 1px solid var(--line);
  padding-top: 1.1rem;
}
.switch {
  display: flex;
  align-items: center;
  gap: .55rem;
  font-family: var(--display);
  font-size: .78rem;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.switch input { position: absolute; opacity: 0; }
.switch .track {
  flex: none;
  width: 30px; height: 17px;
  border-radius: 999px;
  background: var(--line-strong);
  position: relative;
  transition: background .15s;
}
.switch .track::after {
  content: "";
  position: absolute;
  top: 2px; left: 2px;
  width: 13px; height: 13px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform .15s;
}
.switch input:checked + .track { background: var(--amber-ink); }
.switch input:checked + .track::after { transform: translateX(13px); }
.switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---------- main column ---------- */
main { padding: 2.6rem 0 5rem; max-width: 46rem; }
header.hero { margin-bottom: 2.2rem; }
h1 {
  font-family: var(--display);
  font-size: clamp(1.9rem, 4vw, 2.6rem);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -.015em;
  margin: 0 0 .9rem;
  text-wrap: balance;
}
.hero p.lede { font-size: 1.13rem; color: var(--muted); margin: 0 0 1.2rem; max-width: 40rem; }
h2 {
  font-family: var(--display);
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -.01em;
  line-height: 1.2;
  margin: 3rem 0 1rem;
  text-wrap: balance;
}
h2 .partno {
  display: block;
  font-size: .68rem;
  font-weight: 600;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: .35rem;
}
h3 { font-family: var(--display); font-size: 1.08rem; font-weight: 700; margin: 1.8rem 0 .6rem; }
h4 { font-family: var(--display); font-size: .95rem; font-weight: 700; margin: 1.2rem 0 .4rem; }
p { margin: 0 0 1rem; }
a { color: var(--accent-ink); text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); text-underline-offset: 2px; }
a:hover { text-decoration-color: var(--accent); }
strong { font-weight: 600; }
code, .mono { font-family: var(--mono); font-size: .86em; }
code {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: .06em .32em;
}
ul { padding-left: 1.2rem; margin: 0 0 1rem; }
li { margin-bottom: .45rem; }

/* ---------- badges ---------- */
.badge {
  display: inline-block;
  font-family: var(--display);
  font-size: .68rem;
  font-weight: 600;
  letter-spacing: .06em;
  padding: .1rem .5rem .14rem;
  border-radius: 999px;
  vertical-align: .12em;
  white-space: nowrap;
  border: 1px solid transparent;
}
.badge .via { font-family: var(--mono); font-size: .92em; font-weight: 400; opacity: .85; }
.badge .issue { color: inherit; text-decoration: underline; }
.b-proven { background: var(--accent-soft); color: var(--accent-ink); }
.b-proven-via { background: transparent; color: var(--accent-ink); border-color: var(--accent); }
.b-gap { background: var(--surface-2); color: var(--muted); border: 1px dashed var(--line-strong); }
.b-pinned { background: var(--amber-soft); color: var(--amber-ink); }
.b-rule-tier { background: var(--surface-2); color: var(--amber-ink); border-color: var(--amber-ink); }

.verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: .45rem;
  font-size: .84rem;
  color: var(--muted);
  background: var(--surface-2);
  border-radius: 8px;
  padding: .5rem .7rem;
  margin: .5rem 0 1rem;
}
.verdict .vnote { flex: 1 1 14rem; min-width: 0; }
.verdict .vline, .verdict .subid { font-family: var(--mono); font-size: .72rem; color: var(--faint); }

/* ---------- tables ---------- */
.tablewrap { overflow-x: auto; margin: 0 0 1.3rem; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); }
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
th {
  font-family: var(--display);
  font-size: .7rem;
  font-weight: 600;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
  text-align: left;
  padding: .6rem .85rem;
  border-bottom: 1px solid var(--line-strong);
  background: var(--surface-2);
}
td { padding: .55rem .85rem; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: none; }
td .mono { font-size: .78rem; color: var(--accent-ink); }

/* ---------- panels & journeys ---------- */
section.panel, section.journey {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 1.5rem 1.8rem 1.2rem;
  margin: 0 0 1.6rem;
}
section.journey h2, section.panel h2 { margin: 0 0 .3rem; font-size: 1.3rem; }
.jmeta { font-size: .85rem; color: var(--muted); font-style: italic; margin-bottom: .6rem; }
.jsetup {
  font-family: var(--display);
  font-size: .8rem;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface-2);
  border-radius: 8px;
  padding: .5rem .8rem;
  margin: .8rem 0 1.1rem;
}
.jsetup b { color: var(--ink); }
.jprose { border-top: 1px dashed var(--line-strong); margin-top: 1.1rem; padding-top: .9rem; font-size: .96rem; color: var(--muted); }
.jprose + .jprose { border-top: none; margin-top: 0; padding-top: 0; }
pre.specnote {
  font-family: var(--mono);
  font-size: .78rem;
  line-height: 1.55;
  color: var(--sketch-ink);
  background: var(--surface-2);
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: .9rem 1.1rem;
  white-space: pre-wrap;
  overflow-x: auto;
}
.jprose strong { color: var(--ink); }

/* ---------- steps ---------- */
.step { display: grid; grid-template-columns: 1.55rem minmax(0, 1fr); gap: .7rem; padding: .75rem 0; border-top: 1px solid var(--line); }
/* Outside the Test lens the tick box is display:none, so the body would fall
   into the 1.55rem column and wrap one word per line. Collapse the gutter. */
body:not([data-lens="test"]) .step { grid-template-columns: minmax(0, 1fr); }
.step:first-of-type { border-top: none; }
.step > input[type="checkbox"] {
  appearance: none;
  margin: .2rem 0 0;
  width: 1.15rem; height: 1.15rem;
  border: 1.5px solid var(--line-strong);
  border-radius: 5px;
  background: var(--surface);
  cursor: pointer;
  position: relative;
  flex: none;
}
.step > input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
.step > input[type="checkbox"]:checked::after {
  content: "";
  position: absolute; inset: 2px 3px 4px;
  border: solid var(--surface);
  border-width: 0 2px 2px 0;
  transform: rotate(40deg) translate(1px, -1px);
}
.step > input[type="checkbox"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.step.checked .steptitle { color: var(--muted); }
.steptitle { font-weight: 600; font-family: var(--display); font-size: .95rem; display: block; }
body[data-lens="test"] .steptitle { cursor: pointer; }
.stepno, .stepid { font-family: var(--mono); font-size: .78rem; color: var(--faint); margin-right: .45rem; font-weight: 400; }
.see {
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 8px 8px 0;
  padding: .5rem .8rem;
  font-size: .92rem;
  margin: .5rem 0 .6rem;
}
.see b { font-family: var(--display); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--accent-ink); display: block; margin-bottom: .15rem; }
.bugif {
  border-left: 3px solid var(--fail-ink);
  background: var(--fail-soft);
  border-radius: 0 8px 8px 0;
  padding: .5rem .8rem;
  font-size: .92rem;
  margin: .5rem 0 .6rem;
}
.bugif b { font-family: var(--display); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--fail-ink); display: block; margin-bottom: .15rem; }
.steprules { display: flex; flex-wrap: wrap; gap: .3rem; margin: .45rem 0 .3rem; }
.steprules .rid {
  font-family: var(--mono);
  font-size: .72rem;
  color: var(--accent-ink);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: .08rem .38rem;
  text-decoration: none;
}
.steprules a.rid:hover { border-color: var(--accent); }
.obs { display: block; margin: .5rem 0 .2rem; }
.obs span {
  display: block;
  font-family: var(--display);
  font-size: .68rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: .2rem;
}
.obs input {
  width: 100%;
  font-family: var(--body);
  font-size: .92rem;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: .4rem .6rem;
}
.obs input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.obs input:not(:placeholder-shown) { border-color: var(--amber-ink); background: var(--amber-soft); }

/* ---------- shots ---------- */
figure.shot { margin: .6rem 0 .4rem; }
figure.shot img {
  max-width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  cursor: zoom-in;
  display: block;
}
figure.shot figcaption { font-size: .78rem; color: var(--faint); font-family: var(--mono); margin-top: .3rem; }
dialog.lightbox { border: none; border-radius: 10px; padding: 0; background: transparent; max-width: min(96vw, 1280px); }
dialog.lightbox img { width: 100%; display: block; border-radius: 10px; cursor: zoom-out; }
dialog.lightbox::backdrop { background: rgba(10, 16, 13, .82); }

/* ---------- charters ---------- */
.charter {
  border: 1px solid var(--line);
  border-left: 3px solid var(--amber-ink);
  border-radius: 0 12px 12px 0;
  background: var(--surface);
  padding: 1rem 1.2rem .6rem;
  margin: 0 0 1rem;
  box-shadow: var(--shadow);
}
.charter h3 { margin: 0 0 .4rem; font-size: 1rem; }
.charter h3 .cid { font-family: var(--mono); font-size: .78rem; color: var(--faint); margin-right: .5rem; font-weight: 400; }
.charter .invite { font-family: var(--display); font-size: .95rem; font-weight: 600; color: var(--amber-ink); margin: 0 0 .5rem; }
.charter .body { font-size: .94rem; color: var(--muted); }
.charter .body strong { color: var(--ink); }

/* ---------- matrix ---------- */
.matrix select, .matrix input[type="text"] {
  font-family: var(--display);
  font-size: .84rem;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: .3rem .45rem;
  width: 100%;
}
.matrix select:focus-visible, .matrix input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.matrix table { font-size: .84rem; table-layout: fixed; }
.matrix td { vertical-align: middle; }
.matrix .jcell { width: 11rem; line-height: 1.35; }
.matrix .jcell .mono { font-size: .74rem; color: var(--faint); }
.matrix th:nth-child(2), .matrix td:nth-child(2) { width: 4rem; }
.matrix th:nth-child(3), .matrix td:nth-child(3) { width: 8rem; }
.matrix th:nth-child(4), .matrix td:nth-child(4) { width: 7rem; }
.matrix .datecell { margin-top: .25rem; }
/* A "witnessed via IMP-010, IMP-013" badge wraps in this column, and a
   999px radius on a three-line pill spills its own text. */
.matrix .badge { white-space: normal; border-radius: 7px; padding: .18rem .45rem; line-height: 1.4; }
.matrix .rollup { font-family: var(--mono); font-size: .78rem; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.matrix .rollup.full { color: var(--accent); font-weight: 600; }
.matrix .datecell { font-family: var(--mono); font-size: .76rem; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.matrix tr.r-pass select { color: var(--accent-ink); background: var(--accent-soft); border-color: transparent; font-weight: 600; }
.matrix tr.r-fail select { color: var(--fail-ink); background: var(--fail-soft); border-color: transparent; font-weight: 600; }
.matrix tr.r-confused select { color: var(--amber-ink); background: var(--amber-soft); border-color: transparent; font-weight: 600; }
.btnrow { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; margin: 1rem 0; }
button.btn {
  font-family: var(--display);
  font-size: .84rem;
  font-weight: 600;
  color: var(--accent-ink);
  background: var(--accent-soft);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: .5rem .95rem;
  cursor: pointer;
}
button.btn:hover { border-color: var(--accent); }
button.btn.quiet { background: var(--surface-2); color: var(--muted); }
button.btn.quiet:hover { border-color: var(--line-strong); color: var(--ink); }
button.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#copynote { font-family: var(--display); font-size: .8rem; color: var(--accent-ink); }

footer.colophon {
  margin-top: 3rem;
  border-top: 1px solid var(--line);
  padding-top: 1.2rem;
  font-size: .88rem;
  color: var(--muted);
}
footer.colophon code { font-size: .8em; }

/* ================= THE LENSES =================
   One DOM. data-lens-only names the lenses a node belongs to; everything
   without the attribute belongs to all three. Nothing is duplicated, so a
   tick made in one lens is the same tick in the next. */
body[data-lens="read"] [data-lens-only]:not([data-lens-only~="read"]),
body[data-lens="test"] [data-lens-only]:not([data-lens-only~="test"]),
body[data-lens="build"] [data-lens-only]:not([data-lens-only~="build"]) { display: none !important; }

/* re-test: the tenth run wants a flat checklist, not the prose again. */
body[data-compact="1"] .step .see,
body[data-compact="1"] .step .bugif,
body[data-compact="1"] .step figure.shot,
body[data-compact="1"] .jprose,
body[data-compact="1"] .jsetup,
body[data-compact="1"] section.journey > .verdict { display: none !important; }
body[data-compact="1"] .step { padding: .3rem 0; }
body[data-compact="1"] .obs { margin: .25rem 0 0; }
body[data-compact="1"] .obs span { display: none; }
body[data-compact="1"] .obs input { padding: .18rem .45rem; font-size: .84rem; }
body:not([data-lens="test"]) #compactwrap { display: none; }

@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; gap: 0; }
  .rail { position: static; height: auto; padding-bottom: 0; }
  .toc { display: none; }
  .rail-tools { border-top: none; padding-top: 0; margin-top: .4rem; }
  main { padding-top: 1rem; }
  section.panel, section.journey { padding: 1.2rem 1.1rem 1rem; }
}
`

const JS = `
(function () {
  'use strict'
  var KEY = 'fb-import-manual-v2'
  var LENSES = ['read', 'test', 'build']
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch (e) {} }
  var state = load()
  state.steps = state.steps || {}
  state.obs = state.obs || {}
  state.matrix = state.matrix || {}

  var journeys = window.__JOURNEYS__

  // ---- lenses ----------------------------------------------------------
  var lensWhat = document.getElementById('lenswhat')
  var WHAT = {
    read: 'The manual. What the wizard does, in the order a person meets it.',
    test: 'The instrument. Tick a step, write what you actually saw.',
    build: 'The layer underneath. Rule IDs, evidence verdicts, open questions.'
  }
  function setLens(l) {
    if (LENSES.indexOf(l) === -1) l = 'read'
    document.body.setAttribute('data-lens', l)
    LENSES.forEach(function (k) {
      var b = document.getElementById('lens-' + k)
      if (b) b.setAttribute('aria-pressed', String(k === l))
    })
    lensWhat.textContent = WHAT[l]
    state.lens = l
    save()
  }
  LENSES.forEach(function (k) {
    var b = document.getElementById('lens-' + k)
    if (b) b.addEventListener('click', function () { setLens(k) })
  })
  setLens(state.lens || 'read')

  var compact = document.getElementById('compact')
  function setCompact(on) {
    document.body.setAttribute('data-compact', on ? '1' : '0')
    compact.checked = !!on
    state.compact = !!on
    save()
  }
  compact.addEventListener('change', function () { setCompact(compact.checked) })
  setCompact(state.compact)

  // ---- steps -----------------------------------------------------------
  var boxes = [].slice.call(document.querySelectorAll('.step > input[type="checkbox"]'))
  var obsInputs = [].slice.call(document.querySelectorAll('input[data-obs]'))

  function rollup(jid) {
    var section = document.querySelector('section[data-j="' + jid + '"]')
    if (!section) return { done: 0, all: 0, notes: 0 }
    var all = section.querySelectorAll('.step > input[type="checkbox"]')
    var done = section.querySelectorAll('.step > input[type="checkbox"]:checked')
    var notes = 0
    section.querySelectorAll('input[data-obs]').forEach(function (i) { if (i.value.trim()) notes++ })
    return { done: done.length, all: all.length, notes: notes }
  }
  function refresh() {
    journeys.forEach(function (j) {
      var r = rollup(j.id)
      var prog = document.querySelector('[data-prog="' + j.id + '"]')
      if (prog) {
        prog.textContent = r.done ? r.done + '/' + r.all : ''
        prog.classList.toggle('done', r.all > 0 && r.done === r.all)
      }
      var cell = document.querySelector('[data-rollup="' + j.id + '"]')
      if (cell) {
        cell.textContent = r.done + '/' + r.all + (r.notes ? '  ·  ' + r.notes + ' noted' : '')
        cell.classList.toggle('full', r.all > 0 && r.done === r.all)
      }
    })
  }
  boxes.forEach(function (box) {
    var id = box.getAttribute('data-step')
    if (state.steps[id]) box.checked = true
    box.closest('.step').classList.toggle('checked', box.checked)
    box.addEventListener('change', function () {
      state.steps[id] = box.checked
      box.closest('.step').classList.toggle('checked', box.checked)
      save(); refresh()
    })
  })
  obsInputs.forEach(function (input) {
    var id = input.getAttribute('data-obs')
    if (state.obs[id]) input.value = state.obs[id]
    input.addEventListener('input', function () {
      state.obs[id] = input.value
      save(); refresh()
    })
  })
  // The step title toggles its tick, but only where a tick means something.
  document.querySelectorAll('.steptitle').forEach(function (t) {
    t.addEventListener('click', function () {
      if (document.body.getAttribute('data-lens') !== 'test') return
      var box = t.closest('.step').querySelector('input[type="checkbox"]')
      box.checked = !box.checked
      box.dispatchEvent(new Event('change'))
    })
  })

  // ---- matrix ----------------------------------------------------------
  var rows = [].slice.call(document.querySelectorAll('#matrixtable tbody tr'))
  rows.forEach(function (tr) {
    var jid = tr.getAttribute('data-j')
    var sel = tr.querySelector('select')
    var note = tr.querySelector('input[type="text"]')
    var date = tr.querySelector('.datecell')
    var m = state.matrix[jid] || {}
    if (m.result) sel.value = m.result
    if (m.note) note.value = m.note
    date.textContent = m.date || ''
    tr.className = m.result ? 'r-' + m.result : ''
    function update(stamp) {
      var entry = state.matrix[jid] = state.matrix[jid] || {}
      entry.result = sel.value
      entry.note = note.value
      if (stamp && sel.value) entry.date = new Date().toISOString().slice(0, 10)
      if (!sel.value) entry.date = ''
      date.textContent = entry.date || ''
      tr.className = entry.result ? 'r-' + entry.result : ''
      save()
    }
    sel.addEventListener('change', function () { update(true) })
    note.addEventListener('input', function () { update(false) })
  })

  // ---- export ----------------------------------------------------------
  document.getElementById('copybtn').addEventListener('click', function () {
    var today = new Date().toISOString().slice(0, 10)
    var out = ['# Spreadsheet import — testing session ' + today, '']
    journeys.forEach(function (j) {
      var r = rollup(j.id)
      var m = state.matrix[j.id] || {}
      out.push('## ' + j.id + ' — ' + j.title)
      out.push('')
      out.push('- steps ticked: ' + r.done + '/' + r.all)
      out.push('- verdict in the spec: ' + j.evidence)
      out.push('- result: ' + (m.result || '—') + (m.date ? ' (' + m.date + ')' : ''))
      if (m.note) out.push('- note: ' + m.note)
      out.push('')
      j.steps.forEach(function (s) {
        var ticked = state.steps[s.id] ? 'x' : ' '
        var seen = (state.obs[s.id] || '').trim()
        out.push('- [' + ticked + '] ' + s.id + ' — ' + s.title + (seen ? '\\n      saw: ' + seen : ''))
      })
      out.push('')
    })
    out.push('## Matrix', '')
    out.push('| Journey | Steps | Observations | Result | Date | Notes |')
    out.push('|---|---|---|---|---|---|')
    journeys.forEach(function (j) {
      var r = rollup(j.id)
      var m = state.matrix[j.id] || {}
      out.push('| ' + j.id + ' — ' + j.title + ' | ' + r.done + '/' + r.all + ' | ' + r.notes + ' | '
        + (m.result || '—') + ' | ' + (m.date || '') + ' | ' + (m.note || '').replace(/\\|/g, '\\\\|') + ' |')
    })
    var text = out.join('\\n')
    var note = document.getElementById('copynote')
    var dump = document.getElementById('exportdump')
    dump.value = text
    function ok() { note.textContent = 'Copied.'; setTimeout(function () { note.textContent = '' }, 2500) }
    function fallback() {
      dump.hidden = false
      dump.select()
      note.textContent = 'Clipboard refused — the markdown is below, select and copy.'
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback)
    } else fallback()
  })

  // ---- reset -----------------------------------------------------------
  document.getElementById('resetbtn').addEventListener('click', function () {
    if (!confirm('Untick every step, clear every observation and the matrix?')) return
    state = { steps: {}, obs: {}, matrix: {}, lens: state.lens, compact: state.compact }
    save()
    boxes.forEach(function (b) { b.checked = false; b.closest('.step').classList.remove('checked') })
    obsInputs.forEach(function (i) { i.value = '' })
    rows.forEach(function (tr) {
      tr.querySelector('select').value = ''
      tr.querySelector('input[type="text"]').value = ''
      tr.querySelector('.datecell').textContent = ''
      tr.className = ''
    })
    refresh()
  })

  // ---- lightbox --------------------------------------------------------
  var lb = document.getElementById('lightbox')
  var lbimg = document.getElementById('lightboximg')
  document.querySelectorAll('figure.shot img').forEach(function (img) {
    img.addEventListener('click', function () {
      lbimg.src = img.src
      lbimg.alt = img.alt
      lb.showModal()
    })
  })
  lb.addEventListener('click', function () { lb.close() })

  refresh()
})()
`

/** A journey's step, in all three lenses at once. */
function renderStep(step, index, shotsOnDisk) {
  const hasShot = shotsOnDisk.has(`${step.slot}.png`)
  const rules = step.rules.length
    ? `<div class="steprules" data-lens-only="build">${step.rules
        .map((r) => {
          const anchor = /^(?:IMP-)?R\d+$/.test(r) ? `#rule-IMP-R${r.replace(/^(?:IMP-)?R/, '')}` : null
          return anchor
            ? `<a class="rid" href="${anchor}">${esc(r)}</a>`
            : `<span class="rid">${esc(r)}</span>`
        })
        .join('')}</div>`
    : ''
  // The slot comment stays in the emitted HTML whether or not the PNG is
  // there — tooling finds slots by reading it.
  const shot = `<!-- slot: ${step.slot} -> shots/${step.slot}.png -->
      <figure class="shot"${hasShot ? '' : ' hidden'}><img src="shots/${attr(step.slot)}.png" alt="${attr(
        step.slot,
      )}" loading="lazy" onerror="this.closest('figure').hidden=true"><figcaption>${esc(step.slot)}</figcaption></figure>`
  return `    <div class="step" id="step-${attr(step.slot)}">
      <input type="checkbox" data-step="${attr(step.slot)}" data-lens-only="test" aria-label="${attr(
        `${step.id} — ${step.doHtml.replace(/<[^>]+>/g, '')}`,
      )}">
      <div class="stepbody">
        <span class="steptitle"><span class="stepno" data-lens-only="read">${index + 1}</span><span class="stepid" data-lens-only="test build">${esc(
          step.id,
        )}</span>${step.doHtml}</span>
        <div class="see"><b>You should see</b>${step.seeHtml}</div>
        ${step.bugHtml ? `<div class="bugif" data-lens-only="test build"><b>Bug if</b>${step.bugHtml}</div>` : ''}
        ${rules}
        ${shot}
        <label class="obs" data-lens-only="test"><span>Observation</span><input type="text" data-obs="${attr(
          step.slot,
        )}" placeholder="what you actually saw…"></label>
      </div>
    </div>`
}

function renderJourney(j, shotsOnDisk) {
  const kind = verdictKind(j.verdict)
  const chip = `<span class="badge b-${kind}">${JOURNEY_LABEL[kind]}</span>`
  const lead = j.lead.map((b) => `<div class="jprose" data-lens-only="build">${b.html}</div>`).join('\n')
  // "Isolation strategy" is how the journey is made repeatable, which is a
  // tester's and a builder's concern — a reader of the manual never needs it.
  const tail = j.tail
    .map((b) =>
      b.kind === 'verdict'
        ? verdictBlock(b.verdict)
        : `<div class="jprose"${
            /^<p><strong>Isolation strategy/.test(b.html) ? ' data-lens-only="test build"' : ''
          }>${b.html}</div>`,
    )
    .join('\n')
  return `<section class="journey" id="${attr(j.id.toLowerCase())}" data-j="${attr(j.id)}">
  <h2><span class="partno">Journey ${j.num}${j.shape ? ` · ${esc(j.shape)}` : ''}</span>${j.title} ${chip}</h2>
  <p class="jmeta" data-lens-only="build"><code>${SPEC_REL}:${j.line}</code> · ${esc(j.id)}</p>
  ${verdictBlock(j.verdict)}
${lead}
${j.steps.map((s, i) => renderStep(s, i, shotsOnDisk)).join('\n')}
${tail}
</section>`
}

function render(spec, fixtures, shotsOnDisk) {
  const journeyData = spec.journeys.map((j) => ({
    id: j.id,
    title: j.title.replace(/<[^>]+>/g, ''),
    evidence: `${j.verdict.status}${j.verdict.via.length ? ' via ' + j.verdict.via.join(', ') : ''}`,
    steps: j.steps.map((s) => ({ id: s.slot, title: s.doHtml.replace(/<[^>]+>/g, '') })),
  }))

  const toc = [
    '<span class="part">Ground</span>',
    '<a href="#before"><span class="jnum">·</span> Before you start</a>',
    '<a href="#jobs"><span class="jnum">·</span> The jobs</a>',
    '<a href="#fixtures"><span class="jnum">·</span> The fixtures</a>',
    '<span class="part">Journeys</span>',
    ...spec.journeys.map(
      (j) =>
        `<a href="#${j.id.toLowerCase()}"><span class="jnum">${j.num}</span> ${j.title
          .replace(/<[^>]+>/g, '')
          .replace(/:.*$/, '')} <span class="prog" data-prog="${attr(j.id)}"></span></a>`,
    ),
    '<span class="part" data-lens-only="build">Underneath</span>',
    '<a href="#rules" data-lens-only="build"><span class="jnum">·</span> The rules</a>',
    '<a href="#invariants" data-lens-only="build"><span class="jnum">·</span> Invariants</a>',
    '<a href="#hazards" data-lens-only="build"><span class="jnum">·</span> Hazards</a>',
    '<a href="#questions" data-lens-only="build"><span class="jnum">·</span> Open questions</a>',
    '<a href="#closure" data-lens-only="build"><span class="jnum">·</span> Closure sweep</a>',
    '<span class="part">Afterwards</span>',
    '<a href="#break"><span class="jnum">·</span> Try to break it</a>',
    '<a href="#matrix" data-lens-only="test"><span class="jnum">·</span> The tracking matrix</a>',
  ].join('\n    ')

  const fixtureRows = fixtures
    .map(
      (f) => `    <tr>
      <td><a href="fixtures/${attr(f.file)}" download><span class="mono">${esc(f.file)}</span></a></td>
      <td>${esc(f.shape)}</td>
      <td class="mono">${f.journeys.map(esc).join(' ')}</td>
      <td>${f.provokes}</td>
    </tr>`,
    )
    .join('\n')

  const sheetRows = fixtures
    .filter((f) => f.sheets)
    .map(
      (f) => `    <tr>
      <td class="mono">${esc(f.file)}</td>
      <td>${f.sheets
        .map(
          (s) =>
            `<div><b>${esc(s.name)}</b> <span class="mono">${s.rows} rows</span>${
              s.visibility === 'visible' ? '' : ` <span class="badge b-gap">${esc(s.visibility)}</span>`
            }<br><span class="mono">${s.headers.map(esc).join(' · ')}</span></div>`,
        )
        .join('')}</td>
    </tr>`,
    )
    .join('\n')

  // "Try to break it" — one charter per hazard, one per open question. The
  // invitation is a fixed frame around the spec's own words; nothing about
  // what to look for is invented here.
  const charters = [
    ...spec.hazards.map(
      (h) => `<div class="charter">
    <h3><span class="cid">${esc(h.id)}</span>Try to make it happen: ${h.name}</h3>
    <p class="invite">The spec says this must not be possible. Go and find out.</p>
    <div class="body">${h.blocks.map((b) => b.html).join('\n')}</div>
    ${verdictBlock(h.verdict)}
  </div>`,
    ),
    ...spec.questions.map(
      (q) => `<div class="charter">
    <h3><span class="cid">${esc(q.id)}</span>Unsettled — try to reach it</h3>
    <p class="invite">Nobody has ruled on this yet. Produce the situation and say what you think.</p>
    <div class="body">${q.html}<p class="mono" style="margin-top:.5rem">blocked on: ${q.blockedOn}</p></div>
  </div>`,
    ),
  ].join('\n  ')

  const matrixRows = spec.journeys
    .map(
      (j) => `      <tr data-j="${attr(j.id)}">
        <td class="jcell"><span class="mono">${esc(j.id)}</span><br>${j.title}</td>
        <td class="rollup" data-rollup="${attr(j.id)}"></td>
        <td>${badge(j.verdict, JOURNEY_LABEL)}</td>
        <td><select><option value="">—</option><option>pass</option><option>fail</option><option>confused</option></select><div class="datecell"></div></td>
        <td><input type="text" placeholder="what you concluded…"></td>
      </tr>`,
    )
    .join('\n')

  return `<!doctype html>
<!--
  GENERATED by tools/build-manual.mjs from docs/specs/0008-spreadsheet-import.md
  — do not edit by hand; edit the spec and rebuild.

    pnpm manual:build      # this page
    pnpm manual:fixtures   # docs/manual/fixtures/

  Open it from a local server so the relative links work, e.g. from the repo
  root:  python3 -m http.server 4317 -d docs/manual
         then http://localhost:4317/spreadsheet-import.html

  Slot contract (unchanged): every screenshot lives at shots/<step-id>.png,
  declared as a "slot: <id> -> shots/<id>.png" comment beside its figure. A
  slot whose PNG is missing renders nothing at all; running a journey's e2e
  test with SNAP=1 writes real screenshots into the slots.

  Your ticks, observations and matrix entries live in this browser's
  localStorage only — use "Copy session as Markdown" to take them with you.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Spreadsheet Import Field Guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${CSS}</style>
</head>
<body data-lens="read">
<div class="shell">

<nav class="rail" aria-label="Contents">
  <div class="brand">
    <span class="eyebrow">Featherbase · Manual</span>
    <span class="name">Spreadsheet Import Field&nbsp;Guide</span>
  </div>
  <div class="lenses">
    <span class="lenshead">Lens</span>
    <div class="lensbtns" role="group" aria-label="Lens">
      <button class="lens" id="lens-read" type="button" aria-pressed="true">Read</button>
      <button class="lens" id="lens-test" type="button" aria-pressed="false">Test</button>
      <button class="lens" id="lens-build" type="button" aria-pressed="false">Build</button>
    </div>
    <p class="lenswhat" id="lenswhat"></p>
  </div>
  <div class="toc" id="toc">
    ${toc}
  </div>
  <div class="rail-tools">
    <label class="switch" id="compactwrap" title="Collapse the prose — the tenth run is a flat checklist">
      <input type="checkbox" id="compact">
      <span class="track"></span>
      Re-test (compact)
    </label>
    <button class="btn quiet" id="resetbtn" type="button">Reset this session</button>
  </div>
</nav>

<main>
<header class="hero">
  <h1>${spec.title}</h1>
  <p class="lede">One page, three lenses. <strong>Read</strong> is the manual.
  <strong>Test</strong> turns the same page into the instrument for a session —
  tick a step, write down what you actually saw. <strong>Build</strong> shows
  the layer underneath: the rule each step cites, and what has and has not been
  proved.</p>
  <p data-lens-only="build"><strong>Provenance.</strong> ${inline(spec.front.Provenance)}</p>
  <p data-lens-only="build"><strong>IDs.</strong> ${inline(spec.front.IDs)}<br>
  <strong>Evidence.</strong> ${inline(spec.front.Evidence)}</p>
</header>

<section class="panel" id="before">
  <h2><span class="partno">Ground</span>Before you start</h2>
  <ul>
    <li><strong>Bring the app up.</strong> <code>./init.sh</code> from the repo
    root — it starts Postgres if nothing is answering, then the API on
    <code>:8000</code> and the web app on <code>:5173</code>.</li>
    <li><strong>Sign in</strong>, then click <strong>Import Data</strong> in the
    sidebar. That screen is where every journey below starts.</li>
    <li><strong>The files live beside this page</strong>, in
    <a href="fixtures/">fixtures/</a> — one workbook per journey, listed below
    with what each exists to provoke. Regenerate them with
    <code>pnpm manual:fixtures</code>; never hand-edit them.</li>
    <li><strong>Resetting the app:</strong> a journey that has already run
    leaves Tables behind, and the wizard suggests an existing Table by column
    overlap — so delete the Tables a journey created before running it again.
    <strong>Past imports</strong> in the sidebar deletes the Tables one import
    created, in one act; the import history undoes the rows of one run.</li>
    <li><strong>Resetting this page:</strong> your ticks, observations and
    matrix entries live in this browser only. <em>Reset this session</em> in the
    sidebar clears them; <em>Copy session as Markdown</em> (Test lens) takes
    them with you first.</li>
  </ul>
</section>

<section class="panel" id="jobs">
  <h2><span class="partno">Ground</span>The jobs</h2>
  <p>Seven jobs a person actually arrives with. Each is a journey below.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Journey</th><th>The job, in the user's words</th><th>What the wizard owes them</th></tr></thead>
    <tbody>
${spec.jobs
  .map(
    (j) => `      <tr><td class="mono"><a href="#${j.id.toLowerCase()}">${esc(j.id)}</a></td><td>${j.headline}</td><td>${j.html}</td></tr>`,
  )
  .join('\n')}
    </tbody>
  </table></div>
</section>

<section class="panel" id="fixtures">
  <h2><span class="partno">Ground</span>${spec.fixture.heading}</h2>
  ${spec.fixture.html}
  <h3>What is on disk</h3>
  <div class="tablewrap"><table>
    <thead><tr><th>File</th><th>Shape</th><th>Used by</th><th>What it exists to provoke</th></tr></thead>
    <tbody>
${fixtureRows}
    </tbody>
  </table></div>
  <h3>The workbooks, sheet by sheet</h3>
  <p>So you know what “correct” looks like before you drop one.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Workbook</th><th>Sheets</th></tr></thead>
    <tbody>
${sheetRows}
    </tbody>
  </table></div>
</section>

${spec.journeys.map((j) => renderJourney(j, shotsOnDisk)).join('\n\n')}

<section class="panel" id="rules" data-lens-only="build">
  <h2><span class="partno">Underneath</span>The rules</h2>
  <h3>${spec.inherited.heading}</h3>
  ${spec.inherited.html}
${spec.rules
  .map(
    (r) => `  <h3 id="rule-${attr(r.id)}">${esc(r.id)} — ${r.name} <span class="mono">shape: ${esc(r.shape)}</span></h3>
  ${verdictBlock(r.verdict)}
  ${r.blocks.map((b) => b.html).join('\n')}`,
  )
  .join('\n')}
</section>

<section class="panel" id="invariants" data-lens-only="build">
  <h2><span class="partno">Underneath</span>Invariants</h2>
${spec.invariants
  .map(
    (v) => `  <h3 id="inv-${attr(v.id)}">${esc(v.id)} — ${v.name}</h3>
  ${verdictBlock(v.verdict)}
  ${v.blocks.map((b) => b.html).join('\n')}`,
  )
  .join('\n')}
</section>

<section class="panel" id="hazards" data-lens-only="build">
  <h2><span class="partno">Underneath</span>Hazards</h2>
${spec.hazards
  .map(
    (h) => `  <h3 id="haz-${attr(h.id)}">${esc(h.id)} — ${h.name}</h3>
  ${verdictBlock(h.verdict)}
  ${h.blocks.map((b) => b.html).join('\n')}`,
  )
  .join('\n')}
</section>

<section class="panel" id="questions" data-lens-only="build">
  <h2><span class="partno">Underneath</span>Open questions</h2>
  <p>Arbiter: ${spec.questions.arbiter || 'owner'}. None of these is a defect
  yet; each is a thing nobody has ruled on.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>#</th><th>Question</th><th>Blocked on</th></tr></thead>
    <tbody>
${spec.questions
  .map((q) => `      <tr><td class="mono">${esc(q.id)}</td><td>${q.html}</td><td>${q.blockedOn}</td></tr>`)
  .join('\n')}
    </tbody>
  </table></div>
</section>

<section class="panel" id="closure" data-lens-only="build">
  <h2><span class="partno">Underneath</span>${spec.closure.heading}</h2>
  ${spec.closure.html}
  ${spec.departures ? `<h3>Two deliberate departures from the template</h3>\n  ${spec.departures}` : ''}
</section>

<section class="panel" id="break">
  <h2><span class="partno">Afterwards</span>Try to break it</h2>
  <p>Unscripted. The journeys above are the paths somebody already thought
  about; these are the ones the spec is <em>worried</em> about. There is no
  tick box — go off the path, and write down anything that surprises you.</p>
  ${charters}
</section>

<section class="panel matrix" id="matrix" data-lens-only="test">
  <h2><span class="partno">Record</span>The tracking matrix</h2>
  <p>Steps and observations roll up here on their own — you only supply the
  verdict. <strong>Confused is a first-class outcome</strong>; for this feature
  it is the more valuable one. The <em>spec says</em> column is the spec's own
  evidence verdict, so you can see at a glance whether you are re-checking
  something already proven or witnessing something for the first time.</p>
  <div class="tablewrap"><table id="matrixtable">
    <thead><tr><th>Journey</th><th>Steps</th><th>Spec says</th><th>Result</th><th>Notes</th></tr></thead>
    <tbody>
${matrixRows}
    </tbody>
  </table></div>
  <div class="btnrow">
    <button class="btn" id="copybtn" type="button">Copy session as Markdown</button>
    <span id="copynote" role="status"></span>
  </div>
  <textarea id="exportdump" hidden rows="12" style="width:100%;font-family:var(--mono);font-size:.78rem" readonly></textarea>
</section>

<footer class="colophon">
  <p>This page is generated. Its every claim about what the wizard does comes
  from <code>${SPEC_REL}</code>; edit that and run <code>pnpm manual:build</code>.
  Screenshots are produced by the journey tests —
  <code>SNAP=1 pnpm exec playwright test</code> writes into the slots, and a
  slot with no PNG simply renders nothing.</p>
  <p>Deeper reading: <a href="../specs/0004-import-upsert.md">spec 0004 — upsert</a>,
  <a href="../specs/0005-import-revert.md">spec 0005 — revert</a>,
  <a href="../adr/0008-import-inference-thresholds.md">ADR&nbsp;0008 — inference thresholds</a>,
  <a href="../design/requirements-framework.md">the requirements framework</a>.</p>
</footer>
</main>
</div>

<dialog class="lightbox" id="lightbox"><img alt="" id="lightboximg"></dialog>

<script>window.__JOURNEYS__ = ${JSON.stringify(journeyData).replace(/</g, '\\u003c')};</script>
<script>${JS}</script>
</body>
</html>
`
}

/* ================================================================== *
 * 6. Run
 * ================================================================== */

function main() {
  const md = readFileSync(join(ROOT, SPEC_REL), 'utf8')
  const spec = parseSpec(md)
  const fixtures = fixtureCatalog()
  const shotsDir = join(ROOT, MANUAL_DIR, 'shots')
  const shotsOnDisk = new Set(existsSync(shotsDir) ? readdirSync(shotsDir) : [])
  const html = render(spec, fixtures, shotsOnDisk)
  writeFileSync(join(ROOT, OUT_REL), html)

  const stepCount = spec.journeys.reduce((n, j) => n + j.steps.length, 0)
  const slots = spec.journeys.flatMap((j) => j.steps).filter((s) => shotsOnDisk.has(`${s.slot}.png`)).length
  const verdicts =
    spec.journeys.reduce((n, j) => n + 1 + j.subVerdicts.length, 0) +
    spec.rules.length +
    spec.invariants.length +
    spec.hazards.length
  console.log(`${OUT_REL}  ${Math.round(Buffer.byteLength(html) / 1024)} KB`)
  console.log(
    `journeys ${spec.journeys.length} · steps ${stepCount} · rules ${spec.rules.length} · ` +
      `invariants ${spec.invariants.length} · hazards ${spec.hazards.length} · ` +
      `questions ${spec.questions.length} · verdicts ${verdicts} · ` +
      `fixtures ${fixtures.length} · screenshots ${slots}/${stepCount}`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (err) {
    if (err instanceof SpecShapeError) {
      console.error(`build-manual: stopping rather than guessing.\n  ${err.message}`)
      console.error('  Nothing was written. Fix the input (or this build) — a manual that')
      console.error('  quietly drops a step is worse than a build that stops.')
      process.exit(1)
    }
    throw err
  }
}
