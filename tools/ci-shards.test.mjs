import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { acceptanceShardCount, enumerate, partition, shardCount, validate } from './ci-shards.mjs'

function collectorFixture(t, suite = 'component') {
  const root = resolve(import.meta.dirname, '..')
  const directory = mkdtempSync(resolve(tmpdir(), 'ci-shards-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(resolve(directory, 'tools'))
  cpSync(resolve(root, 'tools/ci-shards.mjs'), resolve(directory, 'tools/ci-shards.mjs'))
  const git = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' })
  assert.equal(git.status, 0)
  writeFileSync(resolve(directory, '.git'), `gitdir: ${git.stdout.trim()}\n`)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  writeFileSync(resolve(directory, 'package.json'), '{"name":"collector-fixture","private":true}')
  writeFileSync(resolve(directory, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
  const web = resolve(directory, 'apps/web')
  mkdirSync(resolve(web, 'src'), { recursive: true })
  symlinkSync(resolve(root, 'apps/web/node_modules'), resolve(web, 'node_modules'))
  writeFileSync(resolve(web, 'package.json'), '{"name":"web","type":"module"}')
  writeFileSync(resolve(web, 'vitest.config.mjs'), 'export default { test: { include: ["src/*.test.ts"] } }')
  for (let shard = 1; shard <= shardCount; shard++) {
    const file = `src/${shard}.test.ts`
    writeFileSync(resolve(web, file), `import { test } from 'vitest'; test('example', () => {})`)
    const producer = resolve(directory, '.ci-shards', `${suite}-${shard}`)
    const artifact = 'blob.json'
    mkdirSync(producer, { recursive: true })
    writeFileSync(resolve(producer, artifact), '{}')
    writeFileSync(resolve(producer, 'receipt.json'), JSON.stringify({
      suite, head, total: shardCount, shard, files: [file],
      artifacts: { [artifact]: createHash('sha256').update('{}').digest('hex') },
    }))
  }
  return { directory, web, collect: () => spawnSync(process.execPath,
    ['tools/ci-shards.mjs', 'collect', suite], { cwd: directory, encoding: 'utf8' }) }
}

test('collector CLI ignores merged coverage artifacts from previous attempts', async t => {
  for (const suite of ['component']) {
    const { directory, web, collect } = collectorFixture(t, suite)
    const aggregate = resolve(directory, '.ci-shards', `${suite}-coverage`)
    mkdirSync(aggregate)
    writeFileSync(resolve(aggregate, 'jsdom.json'), '{}')
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = collect()
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, new RegExp(`Verified ${shardCount} .* producers: exact-once inventory`))
    }
    assert.equal(readFileSync(resolve(web, '.vitest-web-reports/component-3.json'), 'utf8'), '{}')
  }
})

test('collector CLI rejects invalid producer inputs', async t => {
  for (const suite of ['component']) {
    const cases = [
      ['missing producer', /Missing or duplicate producers/, dir => rmSync(dir, { recursive: true })],
      ['failed producer without receipt', /ENOENT/, dir => rmSync(resolve(dir, 'receipt.json'))],
      ['duplicate producer', /Unexpected producer directory/, dir => cpSync(dir,
        resolve(dir, '..', `${suite}-${shardCount + 1}`), { recursive: true })],
      ['altered artifact', /Altered or missing artifacts/, dir => writeFileSync(resolve(dir, 'blob.json'), '{"changed":true}')],
      ['previous-head producer', /Stale producer/, null, receipt => { receipt.head = 'previous-head' }],
      ['duplicate file', /A file ran more than once/, null, receipt => {
        receipt.files = ['src/1.test.ts']
      }],
      ['unexpectedly skipped producer', /Empty producer/, null, receipt => { receipt.files = [] }],
    ]
    for (const [name, error, mutateFiles, mutateReceipt] of cases) await t.test(`${suite}: ${name}`, subtest => {
      const { directory, web, collect } = collectorFixture(subtest, suite)
      const producer = resolve(directory, '.ci-shards', `${suite}-2`)
      if (mutateFiles) mutateFiles(producer)
      if (mutateReceipt) {
        const file = resolve(producer, 'receipt.json')
        const receipt = JSON.parse(readFileSync(file))
        mutateReceipt(receipt)
        writeFileSync(file, JSON.stringify(receipt))
      }
      const result = collect()
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, error)
      assert(!existsSync(resolve(web, '.vitest-web-reports')))
    })
  }
})

test('configured component files partition exactly once', async () => {
  for (const suite of ['component']) {
    const all = await enumerate(suite)
    const shards = []
    for (let shard = 1; shard <= shardCount; shard++) shards.push(await enumerate(suite, shard))
    assert(all.length > shardCount)
    assert.deepEqual(shards.flat().sort(), all)
    assert.equal(new Set(shards.flat()).size, all.length)
    assert(shards.every(files => files.length > 0))
    console.log(`${suite}: ${all.length} files; shards ${shards.map(files => files.length).join('/')}`)
  }
})

test('the merge accepts exactly one successful producer per shard and every file once', () => {
  const files = ['a', 'b', 'c', 'd', 'e']
  const receipts = [['a', 'e'], ['b'], ['c'], ['d']].map((files, i) => ({
    suite: 'component', head: 'head', total: shardCount, shard: i + 1, files, artifacts: { 'blob.json': 'digest' },
  }))
  const check = value => validate(value, 'component', files, 'head')
  check(receipts)
  for (const mutate of [
    r => r.pop(),
    r => r.push(r[0]),
    r => { r[2].shard = 1 },
    r => { r[1].head = 'old' },
    r => { r[1].suite = 'browser' },
    r => { r[1].files = [] },
    r => { r[1].files = ['a'] },
    r => { r[1].files = ['unknown'] },
    r => { r[1].artifacts = {} },
  ]) {
    const invalid = structuredClone(receipts)
    mutate(invalid)
    assert.throws(() => check(invalid))
  }
})

test('acceptance Feature files partition exactly once, with their scenarios and in their order', async () => {
  const all = await enumerate('acceptance')
  const shards = []
  for (let shard = 1; shard <= acceptanceShardCount; shard++) shards.push(await enumerate('acceptance', shard))
  assert(all.length > acceptanceShardCount)
  assert.deepEqual(shards.flat().sort(), all)
  assert.equal(new Set(shards.flat()).size, all.length)
  assert(shards.every(files => files.length > 0))
  // Every Feature file offered to a runner has a scenario to run.
  for (const unit of all) assert.match(readFileSync(resolve(import.meta.dirname, '../acceptance-tests', unit.replace(/(?::\d+)+$/, '')), 'utf8'), /Scenario/)
})

test('a capability Vitest runs is not offered to cucumber', async () => {
  const { migratedCapabilities } = createRequire(import.meta.url)('./scenarios/bindings.cjs')
  const migrated = migratedCapabilities()
  assert(migrated.size > 0)
  const capabilities = (await enumerate('acceptance')).map(unit => { const parts = unit.split('/'); return parts[parts.lastIndexOf('specs') + 1] })
  assert.deepEqual(capabilities.filter(capability => migrated.has(capability)), [])
})

test('one capability runs on one runner, and all of its Feature files run', async t => {
  process.env.ACCEPTANCE_CAPABILITIES = 'list-view'
  t.after(() => { delete process.env.ACCEPTANCE_CAPABILITIES })
  const files = await enumerate('acceptance', 1)
  assert(files.length > 0)
  assert(files.every(file => file.includes('/list-view/')))
  assert.deepEqual([...files].sort(), await enumerate('acceptance'))
})

test('partition balances by weight, keeps the given order and spares the runner with a head start', () => {
  const weights = { a: 1, b: 9, c: 2, d: 8 }
  const [first, second] = partition(['a', 'b', 'c', 'd'], unit => weights[unit], 2)
  assert.deepEqual(first, ['a', 'b'])
  assert.deepEqual(second, ['c', 'd'])
  const [loaded, free] = partition(['a', 'b'], unit => weights[unit], 2, 100)
  assert.deepEqual(loaded, [])
  assert.deepEqual(free, ['a', 'b'])
})

test('the merge holds an acceptance run to the number of runners it expects', () => {
  const receipts = [{ suite: 'acceptance', head: 'head', total: 1, shard: 1, files: ['a'], artifacts: { 'results.json': 'digest' } }]
  validate(receipts, 'acceptance', ['a'], 'head', 1)
  assert.throws(() => validate(receipts, 'acceptance', ['a'], 'head', acceptanceShardCount), /Missing or duplicate producers/)
})
