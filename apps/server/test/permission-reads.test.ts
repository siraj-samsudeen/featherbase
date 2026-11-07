import { expect, test } from 'vitest'
import { readOnce, withStablePermissionReads } from '../src/permission-reads'

// #1042: a read-only pass reads each permission fact once; nothing else does.
test('outside the scope every call reads again', async () => {
  let reads = 0
  const read = async () => ++reads
  await readOnce('k', read)
  await readOnce('k', read)
  expect(reads).toBe(2)
})

test('inside the scope a key is read once; another key reads on its own', async () => {
  let reads = 0
  const read = async () => ++reads
  const seen = await withStablePermissionReads(async () => [await readOnce('a', read), await readOnce('a', read), await readOnce('b', read)])
  expect(seen).toEqual([1, 1, 2])
  // A new scope starts empty.
  expect(await withStablePermissionReads(() => readOnce('a', read))).toBe(3)
})

test('a failed read is not remembered', async () => {
  let reads = 0
  const read = async () => { reads++; if (reads === 1) throw new Error('lost connection'); return reads }
  await withStablePermissionReads(async () => {
    await expect(readOnce('a', read)).rejects.toThrow('lost connection')
    expect(await readOnce('a', read)).toBe(2)
  })
})
