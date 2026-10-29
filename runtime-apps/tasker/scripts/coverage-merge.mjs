// Run after test:coverage. Supply raw browser and/or server JSON maps as
// arguments, or --browser-dir <directory> for Playwright's mixed worker maps.
// The standalone report supplies untouched files, so absent integration
// counters cannot turn an unexecuted source file into an exclusion.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import libCoverage from 'istanbul-lib-coverage'
import libSourceMaps from 'istanbul-lib-source-maps'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(root, '../../coverage/tasker')
const baseline = path.join(output, 'unit/coverage-final.json')
const merged = libCoverage.createCoverageMap({})
const sources = [path.join(root, 'src') + path.sep, path.join(root, 'public') + path.sep]
const groups = [[baseline]]
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--browser-dir') {
    groups.push([args[index]])
    continue
  }
  const directory = args[++index]
  if (!directory) throw new Error('--browser-dir requires a directory')
  const files = fs.readdirSync(directory).filter(file => /^e2e-.*\.json$/.test(file))
  if (!files.length) throw new Error(`No browser coverage maps in ${directory}`)
  groups.push(files.map(file => path.join(directory, file)))
}
for (const inputs of groups) {
  let matchingFiles = 0
  for (const input of inputs) {
    const raw = JSON.parse(fs.readFileSync(input, 'utf8'))
    const map = await libSourceMaps.createSourceMapStore().transformCoverage(libCoverage.createCoverageMap(raw))
    map.filter((file) => sources.some((prefix) => file.startsWith(prefix)) && !/\.test\.[tj]sx?$/.test(file))
    matchingFiles += map.files().length
    for (const file of map.files()) {
      const data = map.fileCoverageFor(file).data
      // JSON writes remapped Infinity columns as null. Location-based merging
      // must use the same representation for both in-memory and persisted maps.
      for (const loc of [
        ...Object.values(data.statementMap),
        ...Object.values(data.fnMap).flatMap((f) => [f.decl, f.loc]),
        ...Object.values(data.branchMap).flatMap((b) => [b.loc, ...b.locations]),
      ]) {
        for (const end of [loc?.start, loc?.end]) if (end?.column === null) end.column = Infinity
      }
    }
    for (const file of map.files()) {
      if (!merged.files().includes(file)) continue
      const previous = merged.fileCoverageFor(file).data
      const current = map.fileCoverageFor(file).data
      for (const kind of ['statementMap', 'fnMap', 'branchMap']) {
        if (JSON.stringify(Object.values(previous[kind])) !== JSON.stringify(Object.values(current[kind])))
          throw new Error(`Incompatible ${kind} for ${file} in ${input}; use the same Istanbul instrumentation, not V8 counters`)
      }
    }
    merged.merge(map)
    console.log(`${input}: ${map.files().length} Tasker source files`)
  }
  if (!matchingFiles) throw new Error(`No Tasker source coverage in ${inputs.join(', ')}; check checkout paths and source maps`)
}
const context = libReport.createContext({ dir: path.join(output, 'merged'), coverageMap: merged })
for (const name of ['text', 'json', 'json-summary', 'html']) reports.create(name).execute(context)
