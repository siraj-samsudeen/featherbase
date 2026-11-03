import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { enumerate, shardCount, validate } from './ci-shards.mjs'

function collectorFixture(t, suite) {
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
  mkdirSync(resolve(web, 'e2e'))
  symlinkSync(resolve(root, 'apps/web/node_modules'), resolve(web, 'node_modules'))
  writeFileSync(resolve(web, 'package.json'), '{"name":"web","type":"module"}')
  writeFileSync(resolve(web, 'vitest.config.mjs'), 'export default { test: { include: ["src/*.test.ts"] } }')
  writeFileSync(resolve(web, 'playwright.config.mjs'), 'export default { testDir: "./e2e" }')
  for (let shard = 1; shard <= 3; shard++) {
    const file = suite === 'component' ? `src/${shard}.test.ts` : `e2e/${shard}.spec.ts`
    const runner = suite === 'component' ? 'vitest' : '@playwright/test'
    writeFileSync(resolve(web, file), `import { test } from '${runner}'; test('example', () => {})`)
    const producer = resolve(directory, '.ci-shards', `${suite}-${shard}`)
    const artifact = suite === 'component' ? 'blob.json' : 'coverage/e2e-example.json'
    mkdirSync(resolve(producer, 'coverage'), { recursive: true })
    writeFileSync(resolve(producer, artifact), '{}')
    writeFileSync(resolve(producer, 'receipt.json'), JSON.stringify({
      suite, head, total: 3, shard, files: [file],
      artifacts: { [artifact]: createHash('sha256').update('{}').digest('hex') },
    }))
  }
  // Prepare the fresh workspace before the CLI captures its JSON listing.
  const prepared = spawnSync('pnpm', ['--filter', 'web', 'exec', 'playwright', '--version'], {
    cwd: directory, encoding: 'utf8',
  })
  assert.equal(prepared.status, 0, prepared.stderr)
  return { directory, web, collect: () => spawnSync(process.execPath,
    ['tools/ci-shards.mjs', 'collect', suite], { cwd: directory, encoding: 'utf8' }) }
}

test('collector CLI ignores merged coverage artifacts from previous attempts', async t => {
  for (const suite of ['component', 'browser']) {
    const { directory, web, collect } = collectorFixture(t, suite)
    const aggregate = resolve(directory, '.ci-shards', `${suite}-coverage`)
    mkdirSync(aggregate)
    writeFileSync(resolve(aggregate, 'jsdom.json'), '{}')
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = collect()
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Verified 3 .* producers: exact-once inventory/)
    }
    assert.equal(readFileSync(resolve(web, suite === 'component'
      ? '.vitest-web-reports/component-3.json' : '.nyc_output/e2e-browser-3-e2e-example.json'), 'utf8'), '{}')
  }
})

test('collector CLI rejects invalid producer inputs', async t => {
  for (const suite of ['component', 'browser']) {
    const cases = [
      ['missing producer', /Missing or duplicate producers/, dir => rmSync(dir, { recursive: true })],
      ['failed producer without receipt', /ENOENT/, dir => rmSync(resolve(dir, 'receipt.json'))],
      ['duplicate producer', /Unexpected producer directory/, dir => cpSync(dir, `${dir.slice(0, -1)}4`, { recursive: true })],
      ['altered artifact', /Altered or missing artifacts/, dir => writeFileSync(resolve(dir,
        suite === 'component' ? 'blob.json' : 'coverage/e2e-example.json'), '{"changed":true}')],
      ['previous-head producer', /Stale producer/, null, receipt => { receipt.head = 'previous-head' }],
      ['duplicate file', /A file ran more than once/, null, receipt => {
        receipt.files = [suite === 'component' ? 'src/1.test.ts' : 'e2e/1.spec.ts']
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
      assert(!existsSync(resolve(web, suite === 'component' ? '.vitest-web-reports' : '.nyc_output')))
    })
  }
})

test('configured component and browser files partition exactly once, including fixture groups within a file', async () => {
  for (const suite of ['component', 'browser']) {
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
  const receipts = [['a', 'e'], ['b'], ['c', 'd']].map((files, i) => ({
    suite: 'component', head: 'head', total: 3, shard: i + 1, files, artifacts: { 'blob.json': 'digest' },
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
