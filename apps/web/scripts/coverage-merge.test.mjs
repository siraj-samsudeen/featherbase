import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import vm from 'node:vm'
import { transformWithOxc } from 'vite'
import * as coverage from '@vitest/istanbul-lib-coverage'
import * as sourceMaps from '@vitest/istanbul-lib-source-maps'

const require = createRequire(import.meta.resolve('@vitest/coverage-istanbul'))
const { createInstrumenter } = require('@vitest/istanbul-lib-instrument')

test('merges genuine executions without dropping an implicit else, and rejects changed source maps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'web-coverage-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await mkdir(path.join(root, 'src'))
    await mkdir(path.join(root, '.nyc_output'))
    await symlink(path.resolve(import.meta.dirname, '../node_modules'), path.join(root, 'node_modules'), 'junction')
    const script = path.join(root, 'scripts/coverage-merge.mjs')
    await copyFile(new URL('./coverage-merge.mjs', import.meta.url), script)
    const file = path.join(root, 'src/minimal.ts')
    const source = 'function choose(value: boolean) {\n  if (value) return "yes";\n  return "no";\n}\n'
    await writeFile(file, source)
    const compiled = await transformWithOxc(source, file, { sourcemap: true })
    const instrumented = createInstrumenter().instrumentSync(compiled.code, file, compiled.map)
    function execute(value) {
      const context = vm.createContext({})
      assert.equal(vm.runInContext(`${instrumented}\nchoose(${value})`, context), value ? 'yes' : 'no')
      return coverage.createCoverageMap(context.__coverage__)
    }
    const component = await sourceMaps.createSourceMapStore().transformCoverage(execute(true))
    await writeFile(path.join(root, '.nyc_output/jsdom.json'), JSON.stringify(component))
    await writeFile(path.join(root, '.nyc_output/e2e-browser.json'), JSON.stringify(execute(false)))
    const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    const merged = coverage.createCoverageMap(JSON.parse(await readFile(path.join(root, '.coverage/merged.json'), 'utf8')))
    assert.deepEqual(merged.files(), [file])
    assert.deepEqual(merged.getCoverageSummary().branches, { total: 2, covered: 2, skipped: 0, pct: 100 })

    // A different real instrumentation result must not be combined with the
    // first source's counters, even when the source path is unchanged.
    const other = createInstrumenter().instrumentSync('function choose(value) { return value ? "yes" : "no" }\nchoose(false)', file)
    const context = vm.createContext({})
    vm.runInContext(other, context)
    await writeFile(path.join(root, '.nyc_output/e2e-browser.json'), JSON.stringify(context.__coverage__))
    const incompatible = run()
    assert.equal(incompatible.status, 1)
    assert.match(incompatible.stderr, /Incompatible (statementMap|fnMap|branchMap)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
