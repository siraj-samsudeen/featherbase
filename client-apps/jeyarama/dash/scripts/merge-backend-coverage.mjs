import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createCoverageMap } from '@vitest/istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'
import { app, backendSources } from './backend-coverage.mjs'

const directory = resolve(app, '../../../coverage/dash-backend')
const inputs = process.argv.slice(2)
if (inputs.length !== 0 && inputs.length !== 2)
  throw new Error('Supply exactly two reports (unit and platform), or no arguments for their default paths')
const filenames = inputs.length ? inputs : ['unit', 'platform'].map(profile => resolve(directory, profile, 'coverage-final.json'))
const sources = backendSources()
// Validate every input before adding any counters. Istanbul's permissive merge
// is not a compatibility check, and missing sources must never shrink scope.
const maps = filenames.map(filename => {
  const map = createCoverageMap(JSON.parse(readFileSync(filename, 'utf8')))
  if (!isDeepStrictEqual(map.files().sort(), sources))
    throw new Error(`Dash backend source inventory mismatch in ${filename}`)
  return map
})
for (const file of sources) {
  const baseline = maps[0].fileCoverageFor(file).data
  for (const [index, map] of maps.entries()) {
    const data = map.fileCoverageFor(file).data
    for (const kind of ['statementMap', 'fnMap', 'branchMap'])
      if (!isDeepStrictEqual(baseline[kind], data[kind]))
        throw new Error(`Incompatible ${kind} for ${file} in ${filenames[index]}`)
    for (const [counter, locations] of [['s', 'statementMap'], ['f', 'fnMap'], ['b', 'branchMap']]) {
      if (!isDeepStrictEqual(Object.keys(data[counter]), Object.keys(data[locations])))
        throw new Error(`Invalid ${counter} counter inventory for ${file} in ${filenames[index]}`)
      for (const [id, value] of Object.entries(data[counter])) {
        const values = counter === 'b' ? value : [value]
        if (!Array.isArray(values) || (counter === 'b' && values.length !== data.branchMap[id].locations.length)
          || values.some(count => !Number.isSafeInteger(count) || count < 0))
          throw new Error(`Invalid ${counter}[${id}] counters for ${file} in ${filenames[index]}`)
      }
    }
  }
}
const merged = createCoverageMap({})
for (const map of maps) merged.merge(map)
const context = libReport.createContext({ dir: resolve(directory, 'merged'), coverageMap: merged })
for (const name of ['text', 'json', 'json-summary']) reports.create(name).execute(context)
const summary = merged.getCoverageSummary()
// ADR 0017: fresh CI run 41391014265, without removing any measured source.
// Tighten these maximum uncovered counts as coverage improves.
const maximumUncovered = { statements: 2, functions: 2, branches: 17, lines: 0 }
let failed = false
for (const metric of ['statements', 'functions', 'branches', 'lines']) {
  const { covered, total, pct } = summary[metric]
  const uncovered = total - covered
  console.log(`Dash backend ${metric}: ${covered}/${total} (${pct}%), ${uncovered} uncovered (maximum ${maximumUncovered[metric]})`)
  if (total <= 0 || uncovered > maximumUncovered[metric]) failed = true
}
if (failed) throw new Error('Dash backend exceeds its uncovered-count baseline or has an empty metric; reports retain the exact remaining gaps')
