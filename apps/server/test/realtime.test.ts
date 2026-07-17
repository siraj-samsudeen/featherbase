import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { canSubscribe, onEvent, publishDocEvent, publishUserEvent, type RealtimeEvent } from '../src/realtime'
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
      payload: { doctype: 'Task', name: 'TASK-1' },
    })
    expect(events).toContainEqual({
      channel: 'doc:Task:TASK-1',
      event: 'created',
      payload: { doctype: 'Task', name: 'TASK-1' },
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
  const admin: SessionUser = { name: 'Administrator', email: 'a@x.com', full_name: 'Admin' }
  const guest: SessionUser = { name: 'Guest', email: 'g@x.com', full_name: 'Guest' }

  test('a user may only subscribe to their own personal channel', async () => {
    expect(await canSubscribe(guest, 'user:Guest')).toBe(true)
    expect(await canSubscribe(guest, 'user:Administrator')).toBe(false)
  })

  test('Administrator (read-all) may subscribe to any list/doc channel', async () => {
    expect(await canSubscribe(admin, 'list:User')).toBe(true)
    expect(await canSubscribe(admin, 'doc:User:Administrator')).toBe(true)
  })

  test('a user without read permission cannot subscribe to that DocType channel', async () => {
    // Guest has no DocPerm on User → cannot watch its list/doc channels.
    expect(await canSubscribe(guest, 'list:User')).toBe(false)
    expect(await canSubscribe(guest, 'doc:User:Administrator')).toBe(false)
  })

  test('rejects unknown channel shapes', async () => {
    expect(await canSubscribe(admin, 'system')).toBe(false)
    expect(await canSubscribe(admin, 'evil:*')).toBe(false)
    expect(await canSubscribe(admin, 'doc:')).toBe(false)
  })
})
