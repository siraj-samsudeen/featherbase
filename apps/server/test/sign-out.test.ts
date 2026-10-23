import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sign } from 'hono/jwt'
import { describe, expect } from 'vitest'
import WebSocket from 'ws'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueAccessToken, issueSession } from '../src/auth'
import { attachRealtime } from '../src/realtime'
import { makePerson } from './fixtures'

// #411: signing out ends THAT session — the same token is refused afterwards
// on every path — while the person's other sessions keep working.

type Api = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } })
const whoami = async (api: Api, token: string) => (await api.fetch('/api/whoami', bearer(token))).status
const logout = (api: Api, init: RequestInit) => api.fetch('/api/logout', { method: 'POST', ...init })

async function withRealtime<T>(run: (open: (token: string) => Promise<{ socket: WebSocket; closed: Promise<number> }>) => Promise<T>): Promise<T> {
  const server = createServer()
  attachRealtime(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const sockets: WebSocket[] = []
  // Resolves once the socket is either ready or refused; `closed` settles
  // with the close code whenever the server ends the connection.
  const open = async (token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `sid=${token}` } })
    sockets.push(socket)
    const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)))
    await Promise.race([
      new Promise<void>((resolve) => socket.on('message', (raw) => {
        if ((JSON.parse(String(raw)) as { event?: string }).event === 'ready') resolve()
      })),
      closed,
    ])
    return { socket, closed }
  }
  try {
    return await run(open)
  } finally {
    for (const s of sockets) s.terminate()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('#411: sign-out ends that session only', () => {
  test('after sign-out the same bearer token is refused; another session of the same person still works', async ({ api }) => {
    const id = await makePerson({})
    const signedOut = (await issueSession(id)).token
    const other = (await issueSession(id)).token
    expect(await whoami(api, signedOut)).toBe(200)

    expect((await logout(api, bearer(signedOut))).status).toBe(200)

    expect(await whoami(api, signedOut)).toBe(401)
    expect(await whoami(api, other)).toBe(200)
    const [row] = await sql`select person_id, expires_at > now() as live from revoked_session`
    expect(row).toEqual({ person_id: id, live: true })
  })

  test('sign-out through the sid cookie alone revokes that session too', async ({ api }) => {
    const id = await makePerson({})
    const token = (await issueSession(id)).token
    expect((await logout(api, { headers: { cookie: `sid=${token}` } })).status).toBe(200)
    expect(await whoami(api, token)).toBe(401)
  })

  test('the realtime socket of the signed-out session is closed, and it cannot reconnect; the other session stays connected', async ({ api }) => {
    const id = await makePerson({})
    const signedOut = (await issueSession(id)).token
    const other = (await issueSession(id)).token
    await withRealtime(async (open) => {
      const a = await open(signedOut)
      const b = await open(other)
      expect(a.socket.readyState).toBe(WebSocket.OPEN)

      await logout(api, bearer(signedOut))

      expect(await a.closed).toBe(4001)
      expect(b.socket.readyState).toBe(WebSocket.OPEN)
      const again = await open(signedOut)
      expect(await again.closed).toBe(4001)
    })
  })

  test('a session token without a session id is refused (signed in before #411)', async ({ api }) => {
    const id = await makePerson({})
    const now = Math.floor(Date.now() / 1000)
    const old = await sign({ sub: id, iat: now, exp: now + 3600 }, process.env.JWT_SECRET ?? 'dev-secret-change-me')
    expect(await whoami(api, old)).toBe(401)
  })

  test('sign-out prunes revocations whose sessions have expired', async ({ api }) => {
    const id = await makePerson({})
    await sql`insert into revoked_session (jti, person_id, expires_at) values ('long-gone', ${id}, now() - interval '1 minute')`
    await logout(api, bearer((await issueSession(id)).token))
    expect(await sql`select jti from revoked_session where jti = 'long-gone'`).toHaveLength(0)
  })

  test('sign-out with an access token or no credential revokes nothing; the access token keeps working', async ({ api }) => {
    const id = await makePerson({})
    const { token } = await issueAccessToken(id, 'integration')
    expect((await logout(api, bearer(token))).status).toBe(200)
    expect((await logout(api, {})).status).toBe(200)
    expect(await whoami(api, token)).toBe(200)
    expect(await sql`select 1 from revoked_session`).toHaveLength(0)
  })
})
