#!/usr/bin/env node
/**
 * CI check: retired product words must not creep back (#485).
 *
 * Scans tracked text files under apps/<app>/.../src, openspec/, docs/ and the
 * root *.md files for each word in RETIRED_WORDS (whole word, any case) and
 * prints the file, the line and the word to use instead.
 *
 * A line passes when it matches one of that word's allowLines patterns, or
 * carries an explicit `vocabulary-allow` comment. Files in SKIP_FILES are
 * frozen history or the glossary's own "Avoid" line, and are not scanned.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Add a retired word here: what to flag, what to say instead, and which lines
// legitimately use it (someone else's product, not ours).
export const RETIRED_WORDS = [
  {
    word: 'Desk',
    replacement: 'Admin',
    allowLines: [/Frappe'?s Desk/i, /Help ?Desk/i, /formerly Frappe/i],
  },
]

const IN_SCOPE = [/^apps\/.+\/src\//, /^openspec\//, /^docs\//, /^[^/]+\.md$/]
const SKIP_FILES = [/^CONTEXT\.md$/]
const ALLOW_MARK = /vocabulary-allow/

export function inScope(file) {
  return IN_SCOPE.some((re) => re.test(file)) && !SKIP_FILES.some((re) => re.test(file))
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Findings for one file's text: [{ line, word, replacement, text }]. */
export function scan(text) {
  const out = []
  const lines = text.split('\n')
  for (const { word, replacement, allowLines } of RETIRED_WORDS) {
    const re = new RegExp(`\\b${escape(word)}\\b`, 'i')
    lines.forEach((line, i) => {
      if (!re.test(line) || ALLOW_MARK.test(line) || allowLines.some((a) => a.test(line))) return
      out.push({ line: i + 1, word, replacement, text: line })
    })
  }
  return out.sort((a, b) => a.line - b.line)
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(inScope)
  const findings = []
  for (const f of files) {
    let buf
    try { buf = fs.readFileSync(path.join(root, f)) } catch { continue }
    if (buf.includes(0)) continue // binary
    for (const hit of scan(buf.toString('utf8'))) findings.push({ file: f, ...hit })
  }
  if (findings.length) {
    console.error(`check-vocabulary: ${findings.length} retired word(s) found:`)
    for (const h of findings) {
      console.error(`  ${h.file}:${h.line}  "${h.word}" → use "${h.replacement}"`)
      console.error(`      ${h.text.trim()}`)
    }
    console.error('\nReplace the word. If the line means someone else\'s product, add a')
    console.error('`vocabulary-allow` comment to it (see tools/check-vocabulary.mjs).')
    process.exit(1)
  }
  console.log(`check-vocabulary: ${files.length} files clean`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
