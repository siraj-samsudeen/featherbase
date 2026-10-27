// `pnpm smoke` (`tsx src/smoke.ts`): asserts a RUNNING server answers its ping
// with a working database. Run in this process through `main(argv, io)` (ADR
// 0012) against real local servers; one case runs it as a process, to prove
// the entry point.
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { serve } from '@hono/node-server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index'
import { main } from '../src/smoke'
import { runMain } from './command-io'

const servers: { close(): unknown }[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const s of servers.splice(0)) s.close()
})

/** The app itself, listening on a free local port. */
async function appServer(): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s as Server))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A server that answers every request with this status and body. */
async function fixedServer(status: number, body: unknown): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('server smoke check', () => {
  it('passes against the running app', async () => {
    vi.stubEnv('SERVER_URL', await appServer())
    expect(await runMain(main, [])).toEqual({ code: 0, stdout: 'server smoke OK\n', stderr: '' })
  })

  it('fails on a ping that does not answer 200', async () => {
    vi.stubEnv('SERVER_URL', await fixedServer(503, { message: 'down' }))
    expect(await runMain(main, [])).toEqual({ code: 1, stdout: '', stderr: 'smoke: /api/ping returned 503\n' })
  })

  it('fails on a ping whose database is not working', async () => {
    vi.stubEnv('SERVER_URL', await fixedServer(200, { message: 'pong', db: false }))
    expect(await runMain(main, [])).toEqual({ code: 1, stdout: '', stderr: 'smoke: unexpected ping body {"message":"pong","db":false}\n' })
  })

  // Asynchronous, so this process's server can answer while the child runs.
  it('runs as a process, and exits 1 when the ping does not answer 200', async () => {
    const server = fileURLToPath(new URL('..', import.meta.url))
    const url = await fixedServer(500, {})
    const failure = (await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/smoke.ts'], {
      cwd: server, encoding: 'utf8', timeout: 60_000, env: { ...process.env, SERVER_URL: url },
    }).catch((err: unknown) => err)) as { code?: number; stderr?: string }
    expect(failure.code).toBe(1)
    expect(failure.stderr).toBe('smoke: /api/ping returned 500\n')
  }, 60_000)
})
