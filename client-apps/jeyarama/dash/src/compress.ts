// The Dive's compressed cache (#4453): gzip, then base64, so it rides in `initial_state` as text.
// Server-side only (node:zlib); the Dive reads it back with the browser's DecompressionStream.
import { gzipSync } from 'node:zlib'

export const gzipBase64 = (text: string): string => gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64')
