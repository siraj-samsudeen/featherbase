// An installed app's own client files are served from its package, each with
// its type. A file of a kind the server has no type for goes out as bytes.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectStatus } from './fixtures'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("an app's own files", () => {
  test('a file of a kind the server has no type for is served as bytes', async ({ admin }) => {
    const directory = await mkdtemp(resolve('test/.app-files-'))
    directories.push(directory)
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    await writeFile(resolve(directory, 'client/notes.txt'), 'plain words')
    expect(await discoverPackages([directory])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const file = await admin.fetch('/other/notes.txt')
    await expectStatus(file, 200)
    expect(file.headers.get('content-type')).toBe('application/octet-stream')
    expect(await file.text()).toBe('plain words')
  })
})
