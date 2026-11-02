import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enumerate, shardCount, validate } from './ci-shards.mjs'

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
