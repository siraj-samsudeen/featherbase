// #642 (design E4): an app declares the outside sites it frames. Featherbase
// allows them as frame sources on that app's own pages and nowhere else.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A copy of the `other` fixture app, its manifest changed by `change`. */
async function otherApp(change: (manifest: Record<string, unknown>) => Record<string, unknown>) {
  const directory = await mkdtemp(resolve('test/.b5-642-frames-'))
  directories.push(directory)
  await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  await writeFile(file, JSON.stringify(change(JSON.parse(await readFile(file, 'utf8')))))
  return directory
}

describe('declared frame origins: discovery', () => {
  test('absolute https origins are accepted', async () => {
    const directory = await otherApp((manifest) => ({ ...manifest, frameOrigins: ['https://embed.example.com', 'https://reports.example.org:8443'] }))
    expect(await discoverPackages([directory])).toEqual([])
  })

  test.for([
    'http://embed.example.com',
    'https://embed.example.com/reports',
    'https://embed.example.com/',
    'https://*.example.com',
    '*',
    'embed.example.com',
    'https://user@embed.example.com',
  ])('%s is refused', async (origin) => {
    const directory = await otherApp((manifest) => ({ ...manifest, frameOrigins: [origin] }))
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: expect.stringContaining('frameOrigins must be absolute https origins') }),
    ])
  })
})

describe('declared frame origins: the frame policy', () => {
  const FRAMED = 'https://embed.example.com'

  test("an app's own page allows its declared origins and nothing else", async ({ admin }) => {
    await discoverPackages([await otherApp((manifest) => ({ ...manifest, frameOrigins: [FRAMED] }))])
    await admin.post('/api/install_app', { name: 'other' })
    const page = await admin.fetch('/other/', { headers: { accept: 'text/html' } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toBe(`frame-src 'self' ${FRAMED}`)
  })

  test("another app's page does not allow them", async ({ admin }) => {
    expect(await discoverPackages([
      await otherApp((manifest) => ({ ...manifest, frameOrigins: [FRAMED] })),
      resolve('../..', 'example-apps/tasker'),
    ])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/install_app', { name: 'tasker' })
    const page = await admin.fetch('/tasker/', { headers: { accept: 'text/html' } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toBe("frame-src 'self'")
  })

  test.for(['/featherbase/admin', '/api/ping'])('%s allows frames from its own origin only', async (path, { admin }) => {
    await discoverPackages([await otherApp((manifest) => ({ ...manifest, frameOrigins: [FRAMED] }))])
    await admin.post('/api/install_app', { name: 'other' })
    expect((await admin.fetch(path)).headers.get('content-security-policy')).toBe("frame-src 'self'")
  })
})
