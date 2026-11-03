// The process side of src/index.ts: booting the HTTP server, and serving a
// built web app beside the API when the image ships one (apps/web/dist).
import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { artifactDigest } from '../src/runtime-packages'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { serveWebDist, startServer } from '../src/index'
import { sql } from '../src/db'

describe('booting the server', () => {
  test('it listens on the port it is given, answers the API, and syncs the recurring jobs into the queue', async () => {
    // The worker starts but must not tick inside this test.
    vi.stubEnv('JOB_POLL_MS', '600000')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await sql`delete from background_job where method = 'auto_email_reports' and job_status = 'queued'`
      const { port, stop } = await startServer(0)
      try {
        expect(port).toBeGreaterThan(0)
        expect(log.mock.calls.flat()).toContain(`server listening on :${port}`)
        const res = await fetch(`http://127.0.0.1:${port}/api/ping`)
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ message: 'pong' })
        // The Scheduled Job rows were synced into the queue on boot.
        const queued = await sql`select 1 from background_job where method = 'auto_email_reports' and job_status = 'queued'`
        expect(queued).toHaveLength(1)
      } finally {
        await stop()
      }
      await expect(fetch(`http://127.0.0.1:${port}/api/ping`)).rejects.toThrow()
    } finally {
      log.mockRestore()
      warn.mockRestore()
      vi.unstubAllEnvs()
    }
  })
})

// #642 (E7): the boot-check repeats the release's refusal, so a server whose
// image lacks an installed, enabled app never starts serving without it.
describe('booting without an installed app', () => {
  test('the server refuses to start, naming the app and version', async () => {
    vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
    await sql`insert into installed_app (name, manifest, enabled, runtime_package, package_version, artifact_digest)
      values ('acme_board', ${sql.json({ name: 'acme_board' })}, true, true, '1.2.0', 'fingerprint-of-1.2.0')`
    try {
      await expect(startServer(0)).rejects.toThrow('App acme_board version 1.2.0 is installed and enabled, but this release does not ship it.')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // A developer's server runs its apps from their source folders (init.sh), so
  // editing an app or switching branches changes its fingerprint. There the
  // server starts with the app unavailable, and says how to bring it back.
  test('a development server starts, warning with the fix for a developer machine', async () => {
    vi.stubEnv('JOB_POLL_MS', '600000')
    vi.stubEnv('FEATHERBASE_ENV', 'development')
    vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sql`insert into installed_app (name, manifest, enabled, runtime_package, package_version, artifact_digest)
      values ('acme_board', ${sql.json({ name: 'acme_board' })}, true, true, '1.2.0', 'fingerprint-of-1.2.0')`
    try {
      const { stop } = await startServer(0)
      await stop()
      expect(warn.mock.calls.flat()).toContain('WARNING: App acme_board version 1.2.0 is installed and enabled, but this server does not have it, so it is unavailable. On a developer machine, add the folder holding acme_board 1.2.0 to FEATHERBASE_APP_PATHS (init.sh sets it), or disable the app in Admin. A release refuses until it ships.')
    } finally {
      warn.mockRestore()
      log.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  // Codex round 1 on #643: boot drops a version shipped twice with different files.
  test('two different artifacts for the installed version refuse the start, though one of them matches', async () => {
    const other = join(process.cwd(), '../../test-apps/other')
    const conflicting = mkdtempSync(join(process.cwd(), 'test/.b5-642-conflict-'))
    try {
      cpSync(other, conflicting, { recursive: true })
      writeFileSync(join(conflicting, 'client', 'extra.txt'), 'different files, same version')
      vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([other, conflicting]))
      await sql`insert into installed_app (name, manifest, enabled, runtime_package, package_version, artifact_digest)
        values ('other', ${sql.json({ name: 'other' })}, true, true, '0.0.1', ${await artifactDigest(realpathSync(other))})`
      await expect(startServer(0)).rejects.toThrow('App other version 0.0.1 is installed and enabled, but this release does not ship it.')
    } finally {
      vi.unstubAllEnvs()
      rmSync(conflicting, { recursive: true, force: true })
    }
  })
})

describe('serving the built web app', () => {
  function builtApp() {
    const dir = mkdtempSync(join(tmpdir(), 'fb-web-dist-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SPA</title>')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")')
    const target = new Hono<{ Variables: { user: never } }>()
    target.get('/api/ping', (c) => c.json({ message: 'pong' }))
    return { dir, target }
  }

  test('files are served as they are, a client route gets index.html, and server prefixes keep their own 404', async () => {
    const { dir, target } = builtApp()
    try {
      expect(serveWebDist(target as never, dir)).toBe(true)
      const asset = await target.request('/assets/app.js')
      expect(asset.status).toBe(200)
      expect(await asset.text()).toBe('console.log("app")')
      for (const route of ['/', '/table/Person', '/featherbase/login']) {
        const page = await target.request(route)
        expect(page.status).toBe(200)
        expect(await page.text()).toContain('<title>SPA</title>')
      }
      expect(await (await target.request('/api/ping')).json()).toEqual({ message: 'pong' })
      for (const owned of ['/api/nothing', '/files/x.txt', '/ws'])
        expect((await target.request(owned)).status).toBe(404)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('without a built app nothing is mounted', async () => {
    const target = new Hono()
    expect(serveWebDist(target as never, join(tmpdir(), 'fb-web-dist-absent'))).toBe(false)
    expect(serveWebDist(target as never, '')).toBe(false)
    expect((await target.request('/')).status).toBe(404)
  })
})
