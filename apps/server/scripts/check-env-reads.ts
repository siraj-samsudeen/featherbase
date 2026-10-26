/* Static guard: src/env.ts is the only server module that reads process.env
 * (instance-settings-as-code D6, #465).
 *
 *   pnpm --filter server lint:env
 *
 * The registry in env.ts is what the release checks, the DEPLOY.md table and
 * .env.example are built from; a read anywhere else is a variable none of them
 * knows about. Read through env.ts instead: `readVariable('NAME')` after
 * declaring NAME in VARIABLES, or `readNamedVariable(name)` when the name is
 * data (a Data Source's url_env).
 *
 * Scope is apps/server/src only. Tests, scripts and the web app's configs
 * (playwright.config.ts reads CHROMIUM_PATH) are tooling, not the server.
 * Comments are skipped, and so are Railway's own RAILWAY_* variables, which
 * the platform sets and no deployment configures.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))
const ALLOWED_FILE = 'env.ts'

export type EnvReadHit = { file: string; line: number; text: string }

/** Every `process.env` read in `source`, outside comments. */
export function scanSource(source: string): Omit<EnvReadHit, 'file'>[] {
  const hits: Omit<EnvReadHit, 'file'>[] = []
  let inBlock = false
  source.split('\n').forEach((raw, i) => {
    let text = raw
    if (inBlock) {
      const end = text.indexOf('*/')
      if (end === -1) return
      text = text.slice(end + 2)
      inBlock = false
    }
    text = text.replace(/\/\*.*?\*\//g, '')
    const open = text.indexOf('/*')
    if (open !== -1) {
      inBlock = true
      text = text.slice(0, open)
    }
    const comment = text.indexOf('//')
    if (comment !== -1 && !/['"`][^'"`]*\/\//.test(text.slice(0, comment + 2))) text = text.slice(0, comment)
    for (const m of text.matchAll(/process\s*\.\s*env\b(\s*(?:\.\s*|\[\s*['"`])([A-Za-z_][A-Za-z0-9_]*))?/g)) {
      if (m[2]?.startsWith('RAILWAY_')) continue
      hits.push({ line: i + 1, text: raw.trim() })
    }
  })
  return hits
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx|mts|cts|js|mjs)$/.test(name) ? [full] : []
  })
}

/** Scan every source file under `dir` except env.ts. Empty means clean. */
export function checkEnvReads(dir: string = SRC_DIR): EnvReadHit[] {
  return walk(dir)
    .filter((file) => path.relative(dir, file) !== ALLOWED_FILE)
    .sort()
    .flatMap((file) => scanSource(readFileSync(file, 'utf8')).map((hit) => ({ file: path.relative(dir, file), ...hit })))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const hits = checkEnvReads()
  if (hits.length === 0) {
    console.log('check-env-reads: clean — only src/env.ts reads process.env')
    process.exit(0)
  }
  console.error(`check-env-reads: ${hits.length} read(s) of process.env outside src/env.ts.\nDeclare the variable in env.ts VARIABLES and read it with readVariable() (or readNamedVariable() for a name that is data).\n`)
  for (const hit of hits) console.error(`  src/${hit.file}:${hit.line}  ${hit.text}`)
  process.exit(1)
}
