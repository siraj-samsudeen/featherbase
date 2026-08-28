import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect } from 'vitest'
import WebSocket from 'ws'
import { test } from './pg-test'
import {
  attachRealtime,
  canSubscribe,
  onEvent,
  publishDocEvent,
  publishUserEvent,
  type RealtimeEvent,
} from '../src/realtime'
import type { SessionUser } from '../src/auth'

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

  test('unsubscribed listeners stop receiving events', () => {
    const { events, stop } = collect()
    stop()
    publishDocEvent('Task', 'TASK-2', 'updated')
    expect(events).toHaveLength(0)
  })
})

describe('RT channel authorization (eval #9 fix)', () => {
  const admin: SessionUser = { row_id: 'Administrator', email: 'a@x.com', full_name: 'Admin' }
  const guest: SessionUser = { row_id: 'Guest', email: 'g@x.com', full_name: 'Guest' }

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
})
