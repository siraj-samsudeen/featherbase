/* Static guard: no .sql migration may write a literal backslash-n into a
 * plain single-quoted string literal.
 *
 *   pnpm --filter server lint:sql
 *
 * Postgres runs with `standard_conforming_strings = on`, so in a .sql file
 * `'basic\nrestricted'` is a backslash followed by an `n` — NOT a newline.
 * Only the E-prefixed form, `E'basic\nrestricted'`, interprets the escape.
 *
 * That distinction is invisible at a glance and bit us in #93: five sites in
 * 0004_bootstrap.sql and 0055_terminology_rename.sql dropped the `E` while
 * their immediate neighbours kept it. Because `choices` is a newline-separated
 * list that `tableSchemaToZod` splits on '\n', the generated Choice enum
 * collapsed to a single member and every affected save failed with 417
 * ValidationError ("Expected 'basic\nrestricted', received 'basic'"). It
 * corrupted Table.kind, Column.tier and Permission.tier, and broke 63 server
 * tests. The .ts migrations were never at risk — '\n' in TypeScript source is
 * already a real newline.
 *
 * The scanner is deliberately quote-aware rather than a grep: it has to skip
 * `--` and block comments (0063_fix_literal_newline_choices.sql explains this
 * very bug in prose, backslash-n and all, and a naive grep flags its own
 * comments), and it has to survive multi-line literals and the `do $$ ... $$`
 * plpgsql blocks in 0010_rls.sql and 0055_terminology_rename.sql. Literals
 * *inside* a dollar-quoted body are ordinary SQL literals subject to the same
 * rule, so they are scanned rather than skipped.
 *
 * Only backslash-n is reported. Other escapes are legitimately written
 * unescaped here — `regexp_replace(..., '\s+', ...)` in 0010 and 0055 wants a
 * real backslash to reach the regex engine — so flagging every backslash
 * would be noise.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export type SqlEscapeHit = {
  /** Migration filename, e.g. `0004_bootstrap.sql`. */
  file: string
  /** 1-based line the literal opens on. */
  line: number
  /** The literal's contents, without the surrounding quotes. */
  literal: string
}

/**
 * A deliberate literal backslash-n that must NOT be flagged, as
 * `file:line:literal`. Expected to stay empty: the only plausible legitimate
 * case is a regex pattern where the backslash is meant to reach the regex
 * engine. If you add an entry, say in a comment why the raw backslash is
 * correct there — the default answer is that the literal wants an `E` prefix.
 */
export const ALLOWED: ReadonlySet<string> = new Set<string>()

/** Character that opens the escape-string form: E'...' (or the lowercase e). */
function isEscapePrefix(source: string, quoteAt: number): boolean {
  const prev = source[quoteAt - 1]
  if (prev !== 'E' && prev !== 'e') return false
  // Must be a standalone prefix, not the tail of an identifier or keyword —
  // `... where value='x'` ends in `e` but is not an escape string.
  const before = source[quoteAt - 2] ?? ' '
  return !/[A-Za-z0-9_$]/.test(before)
}

/** Every plain (non-E) single-quoted literal in `source` containing `\n`. */
export function scanSql(source: string): Omit<SqlEscapeHit, 'file'>[] {
  const hits: Omit<SqlEscapeHit, 'file'>[] = []
  let i = 0
  let line = 1

  while (i < source.length) {
    const c = source[i]

    if (c === '\n') {
      line++
      i++
      continue
    }

    // `-- comment` runs to end of line. Skipped before any quote handling so
    // an apostrophe in prose ("doesn't") cannot unbalance the scan.
    if (c === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    // `/* block comment */`, which may span lines.
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      for (let k = i; k < stop; k++) if (source[k] === '\n') line++
      i = stop
      continue
    }

    if (c === "'") {
      const openedOn = line
      const escaped = isEscapePrefix(source, i)
      i++
      let literal = ''
      while (i < source.length) {
        if (source[i] === "'") {
          // '' is an escaped quote and stays inside the literal.
          if (source[i + 1] === "'") {
            literal += "'"
            i += 2
            continue
          }
          break
        }
        if (source[i] === '\n') line++
        literal += source[i]
        i++
      }
      i++ // past the closing quote
      if (!escaped && literal.includes('\\n')) hits.push({ line: openedOn, literal })
      continue
    }

    i++
  }

  return hits
}

/** Scan every .sql migration on disk. Empty result means clean. */
export function checkMigrations(dir: string = MIGRATIONS_DIR): SqlEscapeHit[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return files.flatMap((file) =>
    scanSql(readFileSync(path.join(dir, file), 'utf8'))
      .map((hit) => ({ file, ...hit }))
      .filter((hit) => !ALLOWED.has(`${hit.file}:${hit.line}:${hit.literal}`)),
  )
}

/** One-line, copy-pasteable description of a hit. */
export function formatHit(hit: SqlEscapeHit): string {
  const shown = hit.literal.length > 80 ? `${hit.literal.slice(0, 77)}...` : hit.literal
  return `${hit.file}:${hit.line}  '${shown}'  -> write E'...' instead`
}

// CLI entry point. Importers (the test suite) get the functions only.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const hits = checkMigrations()
  if (hits.length === 0) {
    console.log('check-sql-escapes: clean — no unescaped backslash-n literals')
    process.exit(0)
  }
  console.error(
    `check-sql-escapes: ${hits.length} literal(s) contain a backslash-n but lack the E prefix.\n` +
      "With standard_conforming_strings = on these store a backslash and an 'n', not a newline.\n",
  )
  for (const hit of hits) console.error(`  ${formatHit(hit)}`)
  process.exit(1)
}
