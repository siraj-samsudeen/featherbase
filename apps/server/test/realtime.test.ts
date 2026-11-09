import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, vi } from 'vitest'
import WebSocket from 'ws'
import { test } from './pg-test'
import {
  MAX_FRAME_BYTES,
  MAX_PENDING_FRAMES,
  attachRealtime,
  canSubscribe,
  eventVisibleTo,
  onEvent,
  publishDocEvent,
  publishUserEvent,
  type RealtimeEvent,
} from '../src/realtime'
import type { SessionUser } from '../src/auth'
import { realtimeFrames } from 'shared'
import { sql } from '../src/db'
import { expectRefused, grantRole, makeTable } from './fixtures'

// RT-001/002/003 (server side): the lifecycle publishes the right channel
// events. The browser wiring is covered by e2e/realtime.spec.ts.

function collect(): { events: RealtimeEvent[]; stop: () => void } {
  const events: RealtimeEvent[] = []
  const stop = onEvent((e) => events.push(e))
  return { events, stop }
}

describe('realtime event bus', () => {
  test('publishDocEvent emits both list and doc channel events', () => {
    const { events, stop } = collect()
    publishDocEvent('Task', 'TASK-1', 'created')
    stop()
    expect(events).toContainEqual({
      channel: 'list:Task',
      event: 'created',
      payload: { table: 'Task', row_id: 'TASK-1' },
    })
    expect(events).toContainEqual({
      channel: 'row:Task:TASK-1',
      event: 'created',
      payload: { table: 'Task', row_id: 'TASK-1' },
    })
  })

  test('publishUserEvent targets a personal channel', () => {
    const { events, stop } = collect()
    publishUserEvent('alice@x.com', 'notification', { subject: 'hi' })
    stop()
    expect(events).toContainEqual({
      channel: 'user:alice@x.com',
      event: 'notification',
      payload: { subject: 'hi' },
    })
  })

  test('a listener that throws does not stop delivery to the others', () => {
    const stopBroken = onEvent(() => { throw new Error('broken listener') })
    const { events, stop } = collect()
    publishDocEvent('Task', 'TASK-3', 'updated')
    stop()
    stopBroken()
    expect(events).toContainEqual({ channel: 'list:Task', event: 'updated', payload: { table: 'Task', row_id: 'TASK-3' } })
  })

  test('unsubscribed listeners stop receiving events', () => {
    const { events, stop } = collect()
    stop()
    publishDocEvent('Task', 'TASK-2', 'updated')
    expect(events).toHaveLength(0)
  })
})

describe('RT channel authorization (eval #9 fix)', () => {
  const admin: SessionUser = { row_id: 'Administrator', kind: 'person', email: 'a@x.com', full_name: 'Admin' }
  const guest: SessionUser = { row_id: 'Guest', kind: 'person', email: 'g@x.com', full_name: 'Guest' }

  test('a user may only subscribe to their own personal channel', async () => {
    expect(await canSubscribe(guest, 'user:Guest')).toBe(true)
    expect(await canSubscribe(guest, 'user:Administrator')).toBe(false)
  })

  test('Administrator (read-all) may subscribe to any list/doc channel', async () => {
    expect(await canSubscribe(admin, 'list:User')).toBe(true)
    expect(await canSubscribe(admin, 'row:User:Administrator')).toBe(true)
  })

  test('a user without read permission cannot subscribe to that Table channel', async () => {
    // Guest has no Permission on User → cannot watch its list/doc channels.
    expect(await canSubscribe(guest, 'list:User')).toBe(false)
    expect(await canSubscribe(guest, 'row:User:Administrator')).toBe(false)
  })

  test('rejects unknown channel shapes', async () => {
    expect(await canSubscribe(admin, 'system')).toBe(false)
    expect(await canSubscribe(admin, 'evil:*')).toBe(false)
    expect(await canSubscribe(admin, 'row:')).toBe(false)
  })
})

// #224: a subscribe frame is asynchronous, so a client (and the e2e suite)
// needs to be TOLD when its subscription is live rather than guess with a
// sleep. This is the only test that drives the socket end of realtime — the
// rest of the file talks to the in-process bus.
describe('subscription acknowledgment', () => {
  test('the server acks the channels it registered, and only those', async ({ admin }) => {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    // The socket authenticates off the `sid` cookie, exactly as the browser's
    // same-origin upgrade does (#173).
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie: `sid=${admin.token}` },
    })
    const frames: RealtimeEvent[] = []
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as RealtimeEvent))
    const frame = async (event: string): Promise<RealtimeEvent> => {
      const deadline = Date.now() + 5_000
      for (;;) {
        const hit = frames.find((f) => f.event === event)
        if (hit) return hit
        if (Date.now() > deadline)
          throw new Error(`no '${event}' frame arrived; saw ${JSON.stringify(frames)}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    try {
      await frame('ready')
      // 'user:Guest' is somebody else's personal channel — refused, and so
      // absent from the ack: the ack reports what is live, not what was asked.
      socket.send(JSON.stringify({ subscribe: ['list:User', 'user:Guest'] }))
      expect(await frame('subscribed')).toEqual({
        channel: 'system',
        event: 'subscribed',
        payload: { channels: ['list:User'] },
      })
    } finally {
      socket.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('a frame that is not JSON is ignored and the socket keeps serving', async ({ admin }) => {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `sid=${admin.token}` } })
    const frames: RealtimeEvent[] = []
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as RealtimeEvent))
    const frame = async (event: string): Promise<RealtimeEvent> => {
      const deadline = Date.now() + 5_000
      for (;;) {
        const hit = frames.find((f) => f.event === event)
        if (hit) return hit
        if (Date.now() > deadline) throw new Error(`no '${event}' frame arrived; saw ${JSON.stringify(frames)}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    try {
      await frame('ready')
      socket.send('{not json')
      socket.send(JSON.stringify({ subscribe: ['list:User'] }))
      expect((await frame('subscribed')).payload).toEqual({ channels: ['list:User'] })
      expect(socket.readyState).toBe(WebSocket.OPEN)
    } finally {
      socket.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  // #426: the browser sends its subscribe frame the moment the socket opens
  // (apps/web/src/lib/realtime.ts), not after 'ready'. That frame arrives
  // while the server is still authenticating the upgrade, a database round
  // trip. It must be answered, not dropped: a dropped frame leaves the page
  // subscribed to nothing, with no error and no retry (RT-003 timed out on it).
  test('a subscribe frame sent the moment the socket opens is still answered', async ({ admin }) => {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie: `sid=${admin.token}` },
    })
    const frames: RealtimeEvent[] = []
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as RealtimeEvent))
    socket.on('open', () => socket.send(JSON.stringify({ subscribe: ['list:User'] })))
    try {
      const deadline = Date.now() + 5_000
      while (!frames.some((f) => f.event === 'subscribed')) {
        if (Date.now() > deadline) throw new Error(`no 'subscribed' frame arrived; saw ${JSON.stringify(frames)}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(frames.find((f) => f.event === 'subscribed')?.payload).toEqual({ channels: ['list:User'] })
      // 'ready' still comes first: the page is told who it is before anything else.
      expect(frames[0].event).toBe('ready')
    } finally {
      socket.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
  // Codex P1 on #444: frames wait for authentication, so the wait must be
  // bounded — neither one huge frame nor a flood of small ones is buffered.
  async function closeCodeAfter(token: string, send: (socket: WebSocket) => void): Promise<number> {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `sid=${token}` } })
    socket.on('error', () => {})
    try {
      return await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket was not closed')), 5_000)
        socket.on('close', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
        socket.on('open', () => send(socket))
      })
    } finally {
      socket.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  test('a frame larger than any subscribe list is refused, not buffered', async ({ admin }) => {
    const code = await closeCodeAfter(admin.token!, (socket) =>
      socket.send(JSON.stringify({ subscribe: ['x'.repeat(MAX_FRAME_BYTES)] })),
    )
    expect(code).toBe(1009)
  })

  test('a client that floods frames while they are queued is closed', async ({ admin }) => {
    const code = await closeCodeAfter(admin.token!, (socket) => {
      for (let i = 0; i <= MAX_PENDING_FRAMES * 3; i++) socket.send(JSON.stringify({ subscribe: ['list:User'] }))
    })
    expect(code).toBe(1008)
  })
  // Review of #444: a long-lived page re-sends every channel it watches on
  // reconnect. Framed the way the client frames it, a set far beyond one
  // frame's limit is accepted whole, with the socket left open.
  test('a re-subscribe set larger than one frame is accepted in full', async ({ admin }) => {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `sid=${admin.token}` } })
    const channels = Array.from({ length: 1500 }, (_, i) => `row:User:user-${String(i).padStart(5, '0')}`)
    const frames = realtimeFrames('subscribe', channels)
    expect(frames.length).toBeGreaterThan(2)
    expect(frames.length).toBeLessThan(MAX_PENDING_FRAMES)
    const acked = new Set<string>()
    let closed: number | null = null
    socket.on('message', (raw) => {
      const f = JSON.parse(String(raw)) as RealtimeEvent
      if (f.event === 'subscribed') for (const ch of (f.payload as { channels: string[] }).channels) acked.add(ch)
    })
    socket.on('close', (code) => (closed = code))
    socket.on('open', () => frames.forEach((f) => socket.send(f)))
    try {
      const deadline = Date.now() + 10_000
      while (acked.size < channels.length && closed === null) {
        if (Date.now() > deadline) throw new Error(`only ${acked.size} of ${channels.length} channels acknowledged`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(closed).toBeNull()
      expect(acked.size).toBe(channels.length)
    } finally {
      socket.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 20_000)
})

// Running an Instance / Open pages hear about changes as they happen: the
// whole path, over real sockets — a row saved through the API reaches the
// pages that watch its table, and a personal notice reaches only its person.
describe('Open pages hear about changes as they happen', () => {
  async function listen() {
    const server = createServer()
    attachRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const open: WebSocket[] = []
    const connect = (token: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `sid=${token}` } })
      const frames: RealtimeEvent[] = []
      socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as RealtimeEvent))
      open.push(socket)
      const waitFor = async (match: (f: RealtimeEvent) => boolean): Promise<RealtimeEvent> => {
        const deadline = Date.now() + 5_000
        for (;;) {
          const hit = frames.find(match)
          if (hit) return hit
          if (Date.now() > deadline) throw new Error(`no matching frame; saw ${JSON.stringify(frames)}`)
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      return { socket, frames, waitFor }
    }
    const close = async () => {
      for (const s of open) s.terminate()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    return { connect, close }
  }

  test('someone else saves a row: a page watching that table is told, and a page that may not read it is not', async ({ admin, createUser }) => {
    const outsider = await createUser({ email: 'rt.outsider@example.com' })
    const live = await listen()
    try {
      const watcher = live.connect(admin.token!)
      const blocked = live.connect(outsider.token!)
      await watcher.waitFor((f) => f.event === 'ready')
      await blocked.waitFor((f) => f.event === 'ready')
      watcher.socket.send(JSON.stringify({ subscribe: ['list:Role'] }))
      blocked.socket.send(JSON.stringify({ subscribe: ['list:Role'] }))
      await watcher.waitFor((f) => f.event === 'subscribed')
      // The page that may not read the table is refused: nothing is acknowledged.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(blocked.frames.some((f) => f.event === 'subscribed')).toBe(false)

      await admin.post('/api/table/Role', { row_id: 'Realtime Probe Role' })
      const told = await watcher.waitFor((f) => f.channel === 'list:Role' && f.event === 'created')
      expect(told.payload).toEqual({ table: 'Role', row_id: 'Realtime Probe Role' })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(blocked.frames.some((f) => f.channel === 'list:Role')).toBe(false)
    } finally {
      await live.close()
    }
  })

  test('a private notice reaches only that person, without asking to watch it', async ({ admin, createUser }) => {
    const other = await createUser({ email: 'rt.other@example.com' })
    const live = await listen()
    try {
      const mine = live.connect(admin.token!)
      const theirs = live.connect(other.token!)
      await mine.waitFor((f) => f.event === 'ready')
      await theirs.waitFor((f) => f.event === 'ready')
      publishUserEvent('Administrator', 'notification', { n: 1 })
      expect((await mine.waitFor((f) => f.event === 'notification')).payload).toEqual({ n: 1 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(theirs.frames.some((f) => f.event === 'notification')).toBe(false)
    } finally {
      await live.close()
    }
  })

  test('a socket opened with an access token is served; there is no session to have been signed out', async ({ admin }) => {
    const issued = await admin.post<{ token: string }>('/api/access_tokens', { label: 'socket token' })
    const live = await listen()
    try {
      const page = live.connect(issued.token)
      expect(await page.waitFor((f) => f.event === 'ready')).toMatchObject({ payload: { user: 'Administrator' } })
    } finally {
      await live.close()
    }
  })

  test('open sockets are rechecked on a timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const server = createServer()
    try {
      attachRealtime(server)
      await vi.advanceTimersByTimeAsync(60_000)
    } finally {
      vi.useRealTimers()
      server.close()
    }
  })

  test('an event whose visibility cannot be decided for a database failure is simply not delivered', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Realtime Undecided', naming_rule: 'prompt', columns: ['title'] })
    await grantRole(admin, { role: 'Realtime Undecided Reader', table: table.name, can_read: true })
    const reader = await createUser({ email: 'rt.undecided@example.com', roles: ['Realtime Undecided Reader'] })
    const live = await listen()
    try {
      const page = live.connect(reader.token!)
      await page.waitFor((f) => f.event === 'ready')
      page.socket.send(JSON.stringify({ subscribe: [`list:${table.name}`] }))
      await page.waitFor((f) => f.event === 'subscribed')
      await sql.unsafe('alter table featherbase.data_scope rename to data_scope_gone')
      publishDocEvent(table.name, 'row-1', 'updated')
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(page.frames.some((f) => f.channel === `list:${table.name}`)).toBe(false)
    } finally {
      await live.close()
    }
  })

  test('a session recheck that cannot reach the database leaves the sockets as they are', async ({ createUser }) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const person = await createUser({ email: 'rt.recheck@example.com' })
      const live = await listen()
      try {
        const page = live.connect(person.token!)
        await page.waitFor((f) => f.event === 'ready')
        await sql.unsafe('alter table featherbase.revoked_session rename to revoked_session_gone')
        await vi.advanceTimersByTimeAsync(60_000)
        expect(page.socket.readyState).toBe(page.socket.OPEN)
      } finally {
        await live.close()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  test('row subscriptions respect reader scope and the team feed requires System Manager', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Realtime Policy', naming_rule: 'prompt', columns: ['title'] })
    await admin.post(table.url, { row_id: 'North', title: 'Visible northern row' })
    await admin.post(table.url, { row_id: 'South', title: 'Hidden southern row' })
    await grantRole(admin, { role: 'Realtime Reader', table: table.name, can_read: true })
    const reader = await createUser({ email: 'rt.reader@example.com', roles: ['Realtime Reader'] })
    const scoped = await createUser({ email: 'rt.scoped@example.com', roles: ['Realtime Reader'] })
    const manager = await createUser({ email: 'rt.manager@example.com', roles: ['System Manager'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: table.name, for_value: 'North' } })
    expect((await reader.get(table.rowUrl('South'))).row_id).toBe('South')
    expect((await scoped.get(table.rowUrl('North'))).row_id).toBe('North')
    await expectRefused(scoped.get(table.rowUrl('South')), 403)

    const north = `row:${table.name}:North`
    const south = `row:${table.name}:South`
    const live = await listen()
    try {
      // Each mixed request has a permitted channel, making its ACK a
      // positive completion barrier for every permission check in that frame.
      for (const [person, channels] of [[reader, [north, south]], [scoped, [north]], [manager, [north, south, 'feed']]] as const) {
        const page = live.connect(person.token!)
        await page.waitFor((f) => f.event === 'ready')
        page.socket.send(JSON.stringify({ subscribe: [north, south, 'feed'] }))
        expect(await page.waitFor((f) => f.event === 'subscribed')).toEqual({
          channel: 'system', event: 'subscribed', payload: { channels },
        })
      }
    } finally {
      await live.close()
    }
  })

  test('unsubscribing the team feed retains exact public row events without later feed pings', async ({ admin, createUser }) => {
    const manager = await createUser({ email: 'rt.unsubscribe@example.com', roles: ['System Manager'] })
    const live = await listen()
    try {
      const page = live.connect(manager.token!)
      await page.waitFor((f) => f.event === 'ready')
      page.socket.send(JSON.stringify({ subscribe: ['feed', 'list:Role'] }))
      expect((await page.waitFor((f) => f.event === 'subscribed')).payload).toEqual({ channels: ['feed', 'list:Role'] })
      await admin.post('/api/table/Role', { row_id: 'Before Unsubscribe' })
      expect(await page.waitFor((f) => f.channel === 'list:Role')).toEqual({
        channel: 'list:Role', event: 'created', payload: { table: 'Role', row_id: 'Before Unsubscribe' },
      })
      expect(page.frames.filter((f) => f.channel === 'feed')).toEqual([{ channel: 'feed', event: 'changed' }])

      // Frames run in arrival order, so the following subscription ACK
      // proves the preceding unsubscribe ran before the HTTP mutation.
      // It does not imply that pending asynchronous deliveries drained.
      page.frames.length = 0
      page.socket.send(JSON.stringify({ unsubscribe: ['feed'] }))
      page.socket.send(JSON.stringify({ subscribe: ['list:Role'] }))
      expect((await page.waitFor((f) => f.event === 'subscribed')).payload).toEqual({ channels: ['list:Role'] })
      await admin.post('/api/table/Role', { row_id: 'After Unsubscribe' })
      expect(await page.waitFor((f) => f.channel === 'list:Role')).toEqual({
        channel: 'list:Role', event: 'created', payload: { table: 'Role', row_id: 'After Unsubscribe' },
      })
      // publishDocEvent sends feed synchronously; list events must await
      // eventVisibleTo. If feed were still registered, that frame would
      // precede this same mutation's list frame on this ordered socket.
      expect(page.frames.filter((f) => f.channel !== 'system')).toEqual([{
        channel: 'list:Role', event: 'created', payload: { table: 'Role', row_id: 'After Unsubscribe' },
      }])
    } finally {
      await live.close()
    }
  })

  test('a page that is not signed in is refused', async () => {
    const live = await listen()
    try {
      const anon = live.connect('not-a-session')
      const code = await new Promise<number>((resolveCode, reject) => {
        const timer = setTimeout(() => reject(new Error('socket was not closed')), 5_000)
        anon.socket.on('close', (c) => {
          clearTimeout(timer)
          resolveCode(c)
        })
      })
      expect(code).toBe(4001)
      expect(anon.frames).toEqual([])
    } finally {
      await live.close()
    }
  })
})

describe('who sees an event that names no single row', () => {
  test('an event without a row is visible to every subscriber of its channel', async ({ createUser }) => {
    const anyone = await createUser({ email: 'rt.anyone@example.com' })
    expect(await eventVisibleTo(anyone.user!, { channel: 'feed', event: 'changed' })).toBe(true)
  })

  test('a deleted row of a Table a scoped reader\'s scope does not narrow reaches them', async ({ admin, createUser }) => {
    const scopedTable = await makeTable(admin, { name: 'Realtime Scoped', naming_rule: 'prompt', columns: ['title'] })
    const open = await makeTable(admin, { name: 'Realtime Open', naming_rule: 'prompt', columns: ['title'] })
    await grantRole(admin, { role: 'Realtime Open Reader', table: [scopedTable.name, open.name], can_read: true })
    const scoped = await createUser({ email: 'rt.open.scoped@example.com', roles: ['Realtime Open Reader'] })
    await admin.post(scopedTable.url, { row_id: 'North', title: 'n' })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: scopedTable.name, for_value: 'North' } })
    expect(await eventVisibleTo(scoped.user!, { channel: `list:${open.name}`, event: 'deleted', payload: { table: open.name, row_id: 'gone' } })).toBe(true)
  })
})
