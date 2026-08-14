import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { describe, expect } from 'vitest'
import { deleteStored } from '../src/storage'
import { attachRealtime } from '../src/realtime'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

// #173 (follow-up to #150): a session JWT must never travel in a URL. Private
// file links and the realtime WebSocket both used to carry
// `?token=<session jwt>`, which leaks through browser history, `Referer` and
// proxy/CDN access logs exactly as the OAuth callback did.
//
// Both surfaces are same-origin, so the HttpOnly `sid` cookie set at login is
// already on the request — including the WebSocket upgrade, which is an
// ordinary HTTP request before it switches protocols. That cookie is the
// credential now; the query parameter is not read at all.

const DT = 'Url Cred Doc'
const READER_ROLE = 'Url Cred Reader'

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: READER_ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'Permission',
    doc: { ref_table: DT, role: READER_ROLE, can_read: true },
  })
  const docName = (
    await admin.post<{ name: string }>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'secret' },
    })
  ).name

  const reader = await createUser({ roles: [READER_ROLE] })
  const outsider = await createUser({ roles: [] })

  const form = new FormData()
  form.append('file', new File(['classified'], 'cred.txt', { type: 'text/plain' }))
  form.append('is_private', '1')
  form.append('ref_doctype', DT)
  form.append('ref_name', docName)
  const up = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
  const fileUrl = ((await up.json()) as { file_url: string }).file_url
  return { docName, reader, outsider, fileUrl }
}

describe('#173: private files authenticate from the sid cookie', () => {
  test('the cookie alone serves the file — no Authorization header, no ?token=', async ({
    admin,
    createUser,
    api,
  }) => {
    const { reader, fileUrl } = await setup(admin, createUser)
    try {
      // What a browser actually sends for an <img src> or a download link.
      const res = await api.fetch(fileUrl, { headers: { cookie: `sid=${reader.token}` } })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('classified')
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })

  test('a session JWT in ?token= does not authenticate — the parameter is not read', async ({
    admin,
    createUser,
    api,
  }) => {
    const { reader, fileUrl } = await setup(admin, createUser)
    try {
      // The exact link the SPA used to render. #137 already refused a long-lived
      // access token here; a session JWT leaks through the same channels and is
      // refused for the same reason.
      const res = await api.fetch(`${fileUrl}?token=${encodeURIComponent(reader.token)}`)
      expect(res.status).toBe(401)
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })
})

// The WebSocket handshake is only observable through a real HTTP server, so
// these drive one. The sandbox transaction still applies: `sql` delegates
// through a module-level handle, so the upgrade handler sees this test's rows.
type Handshake = { user?: string; closeCode?: number }

async function handshake(
  path: string,
  headers: Record<string, string> = {},
): Promise<Handshake> {
  const server = createServer()
  attachRealtime(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await new Promise<Handshake>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers })
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          event: string
          payload?: { user?: string }
        }
        if (msg.event === 'ready') {
          resolve({ user: msg.payload?.user })
          socket.close()
        }
      })
      socket.on('close', (closeCode) => resolve({ closeCode }))
      socket.on('error', () => {})
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('#173: the realtime WebSocket authenticates from the sid cookie', () => {
  test('the upgrade request carries the cookie, and that is the credential', async ({
    admin,
  }) => {
    // A WebSocket cannot set headers from the browser, which is why this used
    // to be URL-borne. But the upgrade IS an HTTP request, and a same-origin
    // one, so the cookie is already there.
    expect(await handshake('/ws', { cookie: `sid=${admin.token}` })).toEqual({
      user: 'Administrator',
    })
  })

  test('a session JWT in ?token= is refused — the socket closes unauthorized', async ({
    admin,
  }) => {
    // The WebSocket URL is as loggable as any other: it appears in proxy access
    // logs and in the browser's own network history.
    expect(
      await handshake(`/ws?token=${encodeURIComponent(admin.token)}`),
    ).toEqual({ closeCode: 4001 })
  })
})
