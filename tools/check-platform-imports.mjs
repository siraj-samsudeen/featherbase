#!/usr/bin/env node
/**
 * CI check: the platform never imports app code (ADR 0011's one-way rule,
 * enforced here because ADR 0014 put the apps in this repository).
 *
 * Scans tracked platform source files (apps/server/src, apps/web/src,
 * packages/<package>/src) for every module specifier they load: `import … from`,
 * `export … from`, a bare `import '…'`, `import('…')`, `require('…')`,
 * `require.resolve('…')` and `import.meta.glob('…')`. A specifier fails when it
 *   - resolves to a path under one of APP_FOLDERS, or
 *   - names one of those folders anywhere in it (an alias such as
 *     `@/example-apps/…`), or
 *   - is the npm name of a package that lives under one of them.
 *
 * Tests may point at app and fixture folders by path; they are not platform
 * source and are not scanned. Apps reach a running server only through
 * FEATHERBASE_APP_PATHS, which loads them by a path computed at run time, so a
 * non-literal `import(path)` is not a finding.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_FOLDERS = ['example-apps', 'client-apps', 'test-apps']

const PLATFORM_SOURCE = [/^apps\/(server|web)\/src\//, /^packages\/[^/]+\/src\//]
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

export function isPlatformSource(file) {
  return PLATFORM_SOURCE.some((re) => re.test(file)) && SOURCE_FILE.test(file)
}

const LOADERS = [
  // import x from '…', import { a, b } from '…', import type …, export … from '…'
  // (the clause may span lines; it never contains a quote or a semicolon)
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  // import '…' (side effect only)
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  // import('…'), require('…'), require.resolve('…'), import.meta.glob('…')
  /\b(?:import|require|require\.resolve|import\.meta\.glob(?:Eager)?)\s*\(\s*(['"`])([^'"`\n]+)\1/g,
]

/** Every literal module specifier in a file's text: [{ line, specifier }]. */
export function specifiers(text) {
  const found = new Map()
  for (const re of LOADERS) {
    for (const match of text.matchAll(re)) {
      const at = match.index + match[0].lastIndexOf(match[2])
      const line = text.slice(0, at).split('\n').length
      found.set(`${line}:${match[2]}`, { line, specifier: match[2] })
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line)
}

const underAppFolder = (repoPath) => APP_FOLDERS.some((folder) => repoPath === folder || repoPath.startsWith(`${folder}/`))
const namesAppFolder = (specifier) => APP_FOLDERS.some((folder) => specifier.split(/[\\/]/).includes(folder))

/**
 * Findings for one platform file: [{ line, specifier, reason }]. `file` is its
 * repository path; `appPackageNames` the npm names of packages under the app
 * folders.
 */
export function scan(file, text, appPackageNames = new Set()) {
  const out = []
  for (const { line, specifier } of specifiers(text)) {
    let reason
    if (specifier.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      if (underAppFolder(target)) reason = `resolves to ${target}`
    }
    if (!reason && namesAppFolder(specifier)) reason = 'names an app folder'
    if (!reason) {
      const bare = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (appPackageNames.has(bare)) reason = `is the app package ${bare}`
    }
    if (reason) out.push({ line, specifier, reason })
  }
  return out
}

/** npm names declared by package.json files under the app folders. */
export function appPackageNames(root, files) {
  const names = new Set()
  for (const f of files) {
    if (!underAppFolder(f) || path.posix.basename(f) !== 'package.json' || f.includes('/node_modules/')) continue
    try {
      const { name } = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
      if (name) names.add(name)
    } catch { /* an unreadable fixture manifest names nothing */ }
  }
  return names
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const packages = appPackageNames(root, files)
  const sources = files.filter(isPlatformSource)
  const findings = []
  for (const f of sources) {
    let text
    try { text = fs.readFileSync(path.join(root, f), 'utf8') } catch { continue }
    for (const hit of scan(f, text, packages)) findings.push({ file: f, ...hit })
  }
  if (findings.length) {
    console.error(`check-platform-imports: ${findings.length} import(s) of app code from platform source:`)
    for (const h of findings) console.error(`  ${h.file}:${h.line}  '${h.specifier}' ${h.reason}`)
    console.error(`\nThe platform must not import from ${APP_FOLDERS.map((f) => `${f}/`).join(', ')} (ADR 0011, ADR 0014).`)
    console.error('Move what the platform needs into the platform, or have the app declare it in featherbase.json.')
    process.exit(1)
  }
  console.log(`check-platform-imports: ${sources.length} platform source files import no app code`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
