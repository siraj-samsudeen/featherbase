#!/usr/bin/env node
// Merge the web suites' Istanbul coverage into one map (ADR 0012).
//
// Inputs: every `*.json` in apps/web/.nyc_output — `e2e-*.json` written by the
// Playwright fixtures (raw browser counters, still in the coordinates of the
// code Vite served, each file carrying its `inputSourceMap`) and `jsdom.json`
// written by `vitest --coverage` (already remapped to the original source).
// Output: .coverage/merged.json, which `nyc report --temp-dir .coverage` reads.
//
// Why not `nyc merge`: it merges first and remaps after, so the browser's
// served-code counters and the jsdom run's source-level counters would be
// summed as if they described the same ranges. Remapping each input first and
// merging afterwards keys every counter by its original source location.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import libCoverage from 'istanbul-lib-coverage'
import libSourceMaps from 'istanbul-lib-source-maps'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = path.join(root, '.nyc_output')
const output = path.join(root, '.coverage', 'merged.json')
const src = path.join(root, 'src') + path.sep

const files = fs.existsSync(input) ? fs.readdirSync(input).filter((f) => f.endsWith('.json')) : []
if (!files.includes('jsdom.json') || !files.some((f) => f.startsWith('e2e-'))) {
  console.error(`incomplete coverage in ${input} — run both test:coverage and coverage:e2e first`)
  process.exit(1)
}

// JSON has no Infinity, so a range that runs to the end of its line (end
// column Infinity after remapping) comes back from a file as `null`. Counters
// are merged by location, so both spellings must agree before merging.
function normalise(map) {
  for (const file of map.files()) {
    const data = map.fileCoverageFor(file).data
    const locs = [
      ...Object.values(data.statementMap),
      ...Object.values(data.fnMap).flatMap((f) => [f.decl, f.loc]),
      ...Object.values(data.branchMap).flatMap((b) => [b.loc, ...b.locations]),
    ]
    for (const loc of locs)
      for (const end of [loc?.start, loc?.end]) if (end && end.column === null) end.column = Infinity
  }
  return map
}

const merged = libCoverage.createCoverageMap({})
for (const f of files.sort()) {
  const raw = JSON.parse(fs.readFileSync(path.join(input, f), 'utf8'))
  const map = await libSourceMaps.createSourceMapStore().transformCoverage(libCoverage.createCoverageMap(raw))
  // Browser-only entry points belong in the denominator too.
  map.filter((file) => file.startsWith(src) && !/\.test\.[tj]sx?$/.test(file) && !file.endsWith('.d.ts'))
  merged.merge(normalise(map))
  console.log(`${f}: ${map.files().length} files`)
}

// Vitest supplies zero counters for unvisited source. Refuse a partial input
// that silently omits executable files; type declarations and pure re-export
// barrels have no Istanbul counters and are identified by syntax, not names.
const missing = fs.readdirSync(src, { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !/\.d\.ts$|\.test\.tsx?$/.test(file))
  .map((file) => path.join(src, file))
  .filter((file) => !merged.files().includes(file))
  .filter((file) => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
    return source.statements.some((statement) => !(
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)
    ))
  })
if (missing.length) throw new Error(`coverage is missing executable source:\n${missing.join('\n')}`)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(merged))
console.log(`merged ${files.length} inputs (${merged.files().length} source files) into ${path.relative(root, output)}`)
