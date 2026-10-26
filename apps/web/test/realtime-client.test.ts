// Review of #444: the server refuses a realtime frame over
// REALTIME_MAX_FRAME_BYTES. A long-lived page used to re-send EVERY channel it
// had ever opened, in one frame, on each reconnect — so a tab that had visited
// a few hundred rows was refused, reconnected, sent the same frame, and never
// had realtime again. Channels now leave with their last subscriber, and every
// frame stays under the limit.
import { afterEach, beforeEach, expect, test } from 'vitest'
import { REALTIME_MAX_FRAME_BYTES } from 'shared'
import { RealtimeClient } from '../src/lib/realtime'

class RecordingSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static all: RecordingSocket[] = []
  readyState = RecordingSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: unknown = null
  onclose: (() => void) | null = null
  onerror: unknown = null
  constructor(_url: string) {
    RecordingSocket.all.push(this)
  }
  open() {
    this.readyState = RecordingSocket.OPEN
    this.onopen?.()
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = RecordingSocket.CLOSED
  }
}

const original = globalThis.WebSocket
beforeEach(() => {
  RecordingSocket.all = []
  ;(globalThis as { WebSocket: unknown }).WebSocket = RecordingSocket
  localStorage.setItem('fc_token', 'signed-in')
})
afterEach(() => {
  ;(globalThis as { WebSocket: unknown }).WebSocket = original
})

const bytes = (s: string) => new TextEncoder().encode(s).length
const subscribed = (frames: string[]) => frames.flatMap((f) => (JSON.parse(f) as { subscribe?: string[] }).subscribe ?? [])
const rows = (n: number) => Array.from({ length: n }, (_, i) => `row:Sales Invoice:SINV-2026-${String(i).padStart(5, '0')}`)

test('hundreds of channels are re-sent on open in frames the server accepts', () => {
  const client = new RealtimeClient()
  const channels = rows(800)
  for (const ch of channels) client.subscribe([ch], () => {})
  const socket = RecordingSocket.all[0]
  socket.open()

  expect(socket.sent.length).toBeGreaterThan(1)
  for (const frame of socket.sent) expect(bytes(frame)).toBeLessThanOrEqual(REALTIME_MAX_FRAME_BYTES)
  expect(subscribed(socket.sent).sort()).toEqual([...channels].sort())
})

test('a channel leaves with its last subscriber, and is not re-sent on reconnect', () => {
  const client = new RealtimeClient()
  const keepA = client.subscribe(['list:Item'], () => {})
  const keepB = client.subscribe(['list:Item', 'row:Item:IT-1'], () => {})
  const socket = RecordingSocket.all[0]
  socket.open()
  socket.sent = []

  keepB()
  // list:Item still has a subscriber; only the row channel goes.
  expect(socket.sent).toEqual([JSON.stringify({ unsubscribe: ['row:Item:IT-1'] })])
  keepB() // a second call is a no-op, not a double release
  expect(socket.sent).toHaveLength(1)

  keepA()
  expect(socket.sent[1]).toBe(JSON.stringify({ unsubscribe: ['list:Item'] }))

  client.subscribe(['row:Item:IT-2'], () => {})
  socket.readyState = RecordingSocket.CLOSED
  socket.onclose?.()
  // The reconnect is scheduled; trigger it the way the next subscribe would.
  client.subscribe(['row:Item:IT-3'], () => {})
  const next = RecordingSocket.all.at(-1)!
  next.open()
  expect(subscribed(next.sent).sort()).toEqual(['row:Item:IT-2', 'row:Item:IT-3'])
})

// A socket that errors is closed rather than left half-open, so the close
// handler's reconnect takes over (merged web coverage, ADR 0012).
test('a socket that errors is closed', () => {
  const client = new RealtimeClient()
  client.subscribe(['list:Item'], () => {})
  const socket = RecordingSocket.all[0]
  socket.open()
  ;(socket.onerror as () => void)()
  expect(socket.readyState).toBe(RecordingSocket.CLOSED)
})
