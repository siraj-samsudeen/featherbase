#!/usr/bin/env node
/**
 * CI check: this repository is public, so tracked files must not carry
 * personal data of real people (owner's rule, 23-Oct-2026).
 *
 * What it covers, in tracked TEXT files only:
 *   - Aadhaar-like numbers: 12 digits, first digit 2-9, optional 4-4-4
 *     spacing, AND a valid Verhoeff check digit (cuts false positives);
 *   - Indian mobile numbers: optional +91 / 91 / 0 prefix, then 10 digits
 *     starting 6-9, not part of a longer digit run, a decimal or a word;
 *   - any email address at a client domain (CLIENT_DOMAINS — extend that
 *     list to widen the guard's reach).
 *
 * What it does NOT cover — these rely on review: real names, employee codes,
 * record numbers, statistics about people, security-exposure statements, and
 * binary files (pdf, xlsx, docx, images, archives), which are skipped.
 *
 * Intentional synthetic values go in tools/check-sensitive.allow, one per
 * line (digits only for numbers, lower-case for emails, `#` comments).
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CLIENT_DOMAINS = ['jeyarama.com', 'jeyarama.in', 'rct.in', 'theramachandran.com', 'jeyachandrangroup.com']

const SKIP_PATH = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)dist\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|xlsx|docx)$/i,
]

// Verhoeff tables (Aadhaar's check-digit scheme).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

export function verhoeffValid(digits) {
  let c = 0
  const r = digits.split('').reverse()
  for (let i = 0; i < r.length; i++) c = D[c][P[i % 8][Number(r[i])]]
  return c === 0
}

const AADHAAR = /(?<![\d.\w])([2-9]\d{3})([ -]?)(\d{4})\2(\d{4})(?![\d\w])/g
// The lookbehind is deliberate: a number glued to a word character, digit,
// '.' or '+' (ids like `name_9876543210`, decimals, longer digit runs) is not
// flagged — this trades a little recall for far fewer false positives.
const MOBILE = /(?<![\d.\w+])(?:\+?91[ -]?|0)?([6-9]\d{4})[ -]?(\d{5})(?![\d\w])/g
const domainAlt = CLIENT_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')
const EMAIL = new RegExp(`[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\\.)*(?:${domainAlt})(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`, 'gi')

/** Findings for one file's text: [{ line, kind, value }]. Values are returned
 *  for the allowlist comparison only; the CLI never prints them in full. */
export function scan(text, allow = new Set()) {
  const out = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(AADHAAR)) {
      const digits = m[1] + m[3] + m[4]
      if (verhoeffValid(digits) && !allow.has(digits)) out.push({ line: i + 1, kind: 'aadhaar-like number', value: digits })
    }
    for (const m of line.matchAll(MOBILE)) {
      const digits = m[1] + m[2]
      if (!allow.has(digits)) out.push({ line: i + 1, kind: 'Indian mobile number', value: digits })
    }
    for (const m of line.matchAll(EMAIL)) {
      const email = m[0].toLowerCase()
      if (!allow.has(email)) out.push({ line: i + 1, kind: 'client-domain email', value: email })
    }
  })
  return out
}

export function loadAllow(file) {
  if (!fs.existsSync(file)) return new Set()
  return new Set(
    fs.readFileSync(file, 'utf8').split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map((v) => (v.includes('@') ? v.toLowerCase() : v.replace(/\D/g, ''))),
  )
}

function mask(v) {
  // Conservative: an email shows only its domain, a number only its last 2 digits.
  return v.includes('@') ? '***@' + v.split('@').pop() : '*'.repeat(Math.max(0, v.length - 2)) + v.slice(-2)
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const allow = loadAllow(path.join(root, 'tools/check-sensitive.allow'))
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const findings = []
  for (const f of files) {
    if (SKIP_PATH.some((re) => re.test(f))) continue
    const full = path.join(root, f)
    let buf
    try { buf = fs.readFileSync(full) } catch { continue }
    if (buf.includes(0)) continue // binary
    for (const hit of scan(buf.toString('utf8'), allow)) findings.push({ file: f, ...hit })
  }
  if (findings.length) {
    console.error(`check-sensitive: ${findings.length} possible personal-data value(s) in tracked files:`)
    for (const h of findings) console.error(`  ${h.file}:${h.line}  ${h.kind}  (${mask(h.value)})`)
    console.error('\nReplace real values with synthetic ones. If a value is already synthetic,')
    console.error('add it to tools/check-sensitive.allow.')
    process.exit(1)
  }
  console.log(`check-sensitive: ${files.length} tracked files clean`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
