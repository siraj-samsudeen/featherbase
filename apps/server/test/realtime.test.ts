import { describe, expect, it } from 'vitest'
import { onEvent, publishDocEvent, publishUserEvent, type RealtimeEvent } from '../src/realtime'

// RT-001/002/003 (server side): the lifecycle publishes the right channel
// events. The browser wiring is covered by e2e/realtime.spec.ts.

function collect(): { events: RealtimeEvent[]; stop: () => void } {
  const events: RealtimeEvent[] = []
  const stop = onEvent((e) => events.push(e))
  return { events, stop }
}

describe('realtime event bus', () => {
  it('publishDocEvent emits both list and doc channel events', () => {
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

  it('publishUserEvent targets a personal channel', () => {
    const { events, stop } = collect()
    publishUserEvent('alice@x.com', 'notification', { subject: 'hi' })
    stop()
    expect(events).toContainEqual({
      channel: 'user:alice@x.com',
      event: 'notification',
      payload: { subject: 'hi' },
    })
  })

  it('unsubscribed listeners stop receiving events', () => {
    const { events, stop } = collect()
    stop()
    publishDocEvent('Task', 'TASK-2', 'updated')
    expect(events).toHaveLength(0)
  })
})
