// The realtime socket's frame contract, shared so the server's limit and the
// client's frames cannot drift apart (#426, review of #444).

/** The largest frame the server accepts; a bigger one closes the socket (1009). */
export const REALTIME_MAX_FRAME_BYTES = 16 * 1024

/**
 * Split a subscribe/unsubscribe request into frames that each stay at half the
 * server's limit. A long-lived page can hold hundreds of row channels, and it
 * re-sends all of them on every reconnect: one frame would cross the limit, be
 * refused, and be retried identically forever. A single channel too long to
 * fit any frame is left out — no legitimate channel name comes near it.
 */
export function realtimeFrames(op: 'subscribe' | 'unsubscribe', channels: string[]): string[] {
  const budget = REALTIME_MAX_FRAME_BYTES / 2
  const encoder = new TextEncoder()
  // `{"subscribe":[` + `]}`: the envelope every frame carries.
  const envelope = encoder.encode(JSON.stringify({ [op]: [] })).length
  const frames: string[] = []
  let batch: string[] = []
  let size = envelope
  for (const ch of channels) {
    const item = encoder.encode(JSON.stringify(ch)).length
    if (envelope + item > budget) continue
    const added = (batch.length ? 1 : 0) + item // a comma before every item but the first
    if (size + added > budget) {
      frames.push(JSON.stringify({ [op]: batch }))
      batch = []
      size = envelope
    }
    size += (batch.length ? 1 : 0) + item
    batch.push(ch)
  }
  if (batch.length) frames.push(JSON.stringify({ [op]: batch }))
  return frames
}
