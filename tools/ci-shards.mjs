// File partitioning, with successful-execution receipts. The merge
// validates the complete file inventory and every artifact before reading it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const web = resolve(root, 'apps/web')
export const shardCount = 3
const suites = ['component', 'browser']
function run(args, capture = false) {
  const result = spawnSync('pnpm', ['--filter', 'web', 'exec', ...args], {
    cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  })
  assert.equal(result.status, 0, `${args.join(' ')} failed\n${result.stderr ?? ''}`)
  return capture ? JSON.parse(result.stdout) : undefined
}
function browserFiles(report) {
  const files = new Set()
  function visit(suite) {
    for (const spec of suite.specs ?? []) files.add(`e2e/${spec.file}`)
    for (const child of suite.suites ?? []) visit(child)
  }
  visit(report)
  return [...files].sort()
}
export async function enumerate(suite, shard) {
  assert(suites.includes(suite), 'Unknown suite')
  if (suite === 'browser') {
    // Playwright's native shard groups can split a file across runners (e.g.
    // tests with different fixture options). Keep the entire file together.
    const files = browserFiles(run(['playwright', 'test', '--list', '--reporter=json'], true))
    return shard ? files.filter((_, index) => index % shardCount === shard - 1) : files
  }
  // Vitest's `list --filesOnly` ignores --shard. Use its public sequencer
  // with real specifications instead of copying its hash/range algorithm.
  const requireWeb = createRequire(resolve(web, 'package.json'))
  const { createVitest, BaseSequencer } = await import(pathToFileURL(requireWeb.resolve('vitest/node')))
  const ctx = await createVitest({ root: web, watch: false,
    ...(shard ? { shard: `${shard}/${shardCount}` } : {}) })
  try {
    const files = await ctx.globTestSpecifications()
    const selected = shard ? await new BaseSequencer(ctx).shard(files) : files
    return selected.map(file => relative(web, file.moduleId)).sort()
  } finally { await ctx.close() }
}
function hashes(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'receipt.json')
    .map(entry => {
      const file = resolve(entry.parentPath, entry.name)
      return [relative(directory, file), createHash('sha256').update(readFileSync(file)).digest('hex')]
    }).sort(([a], [b]) => a.localeCompare(b)))
}
function head() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0)
  return result.stdout.trim()
}
export function validate(receipts, suite, files, commit) {
  assert.equal(receipts.length, shardCount, 'Missing or duplicate producers')
  const seen = new Set()
  for (const receipt of receipts) {
    assert.equal(receipt.suite, suite, 'Unexpected producer')
    assert.equal(receipt.head, commit, 'Stale producer')
    assert.equal(receipt.total, shardCount)
    assert(Number.isInteger(receipt.shard) && receipt.shard >= 1 && receipt.shard <= shardCount)
    assert(!seen.has(receipt.shard), 'Duplicate producer')
    seen.add(receipt.shard)
    assert(receipt.files.length > 0, 'Empty producer')
    assert(Object.keys(receipt.artifacts).length > 0, 'Missing coverage artifacts')
  }
  const produced = receipts.flatMap(receipt => receipt.files).sort()
  assert.equal(new Set(produced).size, produced.length, 'A file ran more than once')
  assert.deepEqual(produced, files, 'Missing or unexpected test files')
}
async function execute(suite, shard) {
  assert(Number.isInteger(shard) && shard >= 1 && shard <= shardCount)
  const files = await enumerate(suite, shard)
  assert(files.length, 'Empty shard')
  const directory = resolve(root, '.ci-shards', `${suite}-${shard}`)
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  const selection = `--shard=${shard}/${shardCount}`
  const report = resolve(directory, 'results.json')
  if (suite === 'component') {
    run(['vitest', 'run', selection, '--coverage', '--maxWorkers=1',
      '--coverage.thresholds.lines=0', '--coverage.thresholds.statements=0',
      '--coverage.thresholds.functions=0', '--coverage.thresholds.branches=0',
      '--reporter=default', '--reporter=blob', '--reporter=json',
      `--outputFile.blob=${directory}/blob.json`, `--outputFile.json=${report}`])
    const result = JSON.parse(readFileSync(report))
    assert(result.success && result.numPassedTests > 0, 'No successful component execution')
    assert.deepEqual([...new Set(result.testResults.map(test => relative(web, test.name)))].sort(), files)
  } else {
    const filters = files.map(file => `/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    const result = spawnSync('pnpm', ['--filter', 'web', 'coverage:e2e', ...filters,
      '--trace=retain-on-failure', '--reporter=list,json'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
    })
    assert.equal(result.status, 0, 'Browser shard failed')
    const results = JSON.parse(readFileSync(report))
    assert(results.stats.expected > 0 && results.stats.unexpected === 0, 'No successful browser execution')
    assert.deepEqual(browserFiles(results), files)
    mkdirSync(resolve(directory, 'coverage'))
    for (const file of readdirSync(resolve(web, '.nyc_output')).filter(file => /^e2e-.*\.json$/.test(file)))
      cpSync(resolve(web, '.nyc_output', file), resolve(directory, 'coverage', file))
    assert(readdirSync(resolve(directory, 'coverage')).some(file => /^e2e-.*\.json$/.test(file)), 'Missing browser coverage')
  }
  writeFileSync(resolve(directory, 'receipt.json'), JSON.stringify({
    suite, shard, total: shardCount, head: head(), files, artifacts: hashes(directory),
  }, null, 2))
  console.log(`${suite} ${shard}/${shardCount}: ${files.length} files executed successfully`)
}
async function collect(suite) {
  const base = resolve(root, '.ci-shards')
  const directories = readdirSync(base).filter(name => name.startsWith(`${suite}-`)).sort()
  const receipts = directories.map(name => {
    const directory = resolve(base, name)
    const receipt = JSON.parse(readFileSync(resolve(directory, 'receipt.json')))
    assert.deepEqual(hashes(directory), receipt.artifacts, `Altered or missing artifacts: ${name}`)
    assert.equal(name, `${suite}-${receipt.shard}`, 'Unexpected producer directory')
    return receipt
  })
  validate(receipts, suite, await enumerate(suite), head())
  if (suite === 'component') rmSync(resolve(web, '.vitest-web-reports'), { recursive: true, force: true })
  else {
    mkdirSync(resolve(web, '.nyc_output'), { recursive: true })
    for (const file of readdirSync(resolve(web, '.nyc_output')).filter(file => /^e2e-.*\.json$/.test(file)))
      rmSync(resolve(web, '.nyc_output', file))
  }
  for (const name of directories) {
    if (suite === 'component') {
      mkdirSync(resolve(web, '.vitest-web-reports'), { recursive: true })
      cpSync(resolve(base, name, 'blob.json'), resolve(web, '.vitest-web-reports', `${name}.json`))
    } else {
      mkdirSync(resolve(web, '.nyc_output'), { recursive: true })
      for (const file of readdirSync(resolve(base, name, 'coverage'))) {
        assert(/^e2e-.*\.json$/.test(file), `Unexpected browser coverage: ${file}`)
        cpSync(resolve(base, name, 'coverage', file), resolve(web, '.nyc_output', `e2e-${name}-${file}`))
      }
    }
  }
  console.log(`Verified ${receipts.length} ${suite} producers: exact-once inventory`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, suite, shard] = process.argv.slice(2)
  assert(suites.includes(suite), 'Expected component or browser')
  if (command === 'run') await execute(suite, Number(shard))
  else if (command === 'collect') await collect(suite)
  else if (command === 'list') console.log(JSON.stringify(await enumerate(suite, shard && Number(shard))))
  else throw new Error('Expected run, collect or list')
}
