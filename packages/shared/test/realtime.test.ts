import { describe, expect, test } from 'vitest'
import { REALTIME_MAX_FRAME_BYTES, realtimeFrames } from '../src/realtime'

const bytes = (s: string) => new TextEncoder().encode(s).length

describe('realtimeFrames', () => {
  test('every frame stays within half the limit, and together they carry every channel once, in order', () => {
    const channels = Array.from({ length: 2000 }, (_, i) => `row:Sales Invoice:SINV-${i} ✓`)
    const frames = realtimeFrames('subscribe', channels)
    for (const f of frames) expect(bytes(f)).toBeLessThanOrEqual(REALTIME_MAX_FRAME_BYTES / 2)
    expect(frames.flatMap((f) => (JSON.parse(f) as { subscribe: string[] }).subscribe)).toEqual(channels)
  })

  test('a small set is one frame; an empty set is none', () => {
    expect(realtimeFrames('unsubscribe', ['list:Item', 'user:psn_1'])).toEqual([
      JSON.stringify({ unsubscribe: ['list:Item', 'user:psn_1'] }),
    ])
    expect(realtimeFrames('subscribe', [])).toEqual([])
  })

  test('a channel too long for any frame is left out rather than sent and refused', () => {
    const huge = `row:Item:${'x'.repeat(REALTIME_MAX_FRAME_BYTES)}`
    expect(realtimeFrames('subscribe', ['list:Item', huge])).toEqual([JSON.stringify({ subscribe: ['list:Item'] })])
  })
})
