// `pnpm coverage:ci` (#1201) must make its numbers the way CI does
// (.github/workflows/test.yml: unit-server, release-preflight-pg18,
// coverage-server, component-shards, unit-web).
import test from 'node:test'
import assert from 'node:assert/strict'
import { plan } from './ci-coverage.mjs'

const BASE = 'postgres://me:ci@127.0.0.1:5432'
const p = plan(BASE, 'run1')
const zeroed = ['lines', 'statements', 'functions', 'branches'].map(m => `--coverage.thresholds.${m}=0`)

test('the server runs three shards and the release preflight, each on a database of its own', () => {
  assert.deepEqual(p.server.runs.map(r => r.name), ['shard 1/3', 'shard 2/3', 'shard 3/3', 'release preflight'])
  const dbs = p.server.runs.map(r => r.database)
  assert.equal(new Set(dbs).size, dbs.length)
  for (const r of p.server.runs) {
    assert.equal(r.env.DATABASE_URL, `${BASE}/${r.database}`)
    assert.equal(r.env.NODE_ENV, 'test')
    assert.equal(r.env.ALLOW_MOCK_OAUTH, '1')
    for (const z of zeroed) assert.ok(r.args.includes(z), `${r.name}: ${z}`)
    assert.ok(r.args.includes('--coverage') && r.args.includes('--reporter=blob'), r.name)
  }
  assert.ok(p.server.runs[0].args.includes('--shard=1/3'))
  // Shards run side by side here, not on separate machines: each needs its own
  // report folder, or one deletes another's temporary files.
  const folders = p.server.runs.map(r => r.args.find(a => a.startsWith('--coverage.reportsDirectory=')))
  assert.equal(new Set(folders).size, 4)
  assert.ok(folders.every(Boolean))
  assert.deepEqual(p.server.runs[3].args.slice(0, 3), ['vitest', 'run', 'test/release-preflight.test.ts'])
  assert.deepEqual(p.server.runs.map(r => r.args.find(a => a.startsWith('--outputFile.blob='))),
    ['blob-1', 'blob-2', 'blob-3', 'release-pg18'].map(n => `--outputFile.blob=.vitest-reports/${n}.json`))
})

test('the server merge enforces the real thresholds, as coverage-server does', () => {
  assert.deepEqual(p.server.merge, ['vitest', 'run', '--merge-reports=.vitest-reports', '--coverage'])
})

test('the web runs the four component shards through ci-shards.mjs, each on a database of its own, then merges', () => {
  assert.deepEqual(p.web.runs.map(r => r.args), [1, 2, 3, 4].map(n => ['tools/ci-shards.mjs', 'run', 'component', String(n)]))
  const dbs = p.web.runs.map(r => r.database)
  assert.equal(new Set([...dbs, ...p.server.runs.map(r => r.database)]).size, 8)
  for (const r of p.web.runs) assert.equal(r.env.DATABASE_URL, `${BASE}/${r.database}`)
  assert.deepEqual(p.web.collect, ['tools/ci-shards.mjs', 'collect', 'component'])
  assert.deepEqual(p.web.merge, ['vitest', 'run', '--merge-reports=.vitest-web-reports', '--coverage'])
})

test('every database it makes is named for this run, so two runs never share one', () => {
  const other = plan(BASE, 'run2')
  const mine = [...p.server.runs, ...p.web.runs].map(r => r.database)
  for (const db of mine) assert.match(db, /^coverage_ci_run1_/)
  assert.ok([...other.server.runs, ...other.web.runs].every(r => !mine.includes(r.database)))
})
