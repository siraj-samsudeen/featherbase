import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { getBrowser } from '../src/print'
import { isThumbnable, makeThumbnailDataUrl } from '../src/thumbnails'

// FILE-004: image uploads get a downscaled thumbnail; non-images get none.

// Produce a real PNG of the given size (a diagonal split so it's not a trivial
// solid) using Chromium, so the test exercises the true decode/resize path.
async function makePng(w: number, h: number): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    const dataUrl = await page.evaluate(
      ({ w, h }: { w: number; h: number }) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#3366cc'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#cc6633'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(w, 0)
        ctx.lineTo(0, h)
        ctx.fill()
        return c.toDataURL('image/png')
      },
      { w, h },
    )
    return Buffer.from(dataUrl.split(',')[1], 'base64')
  } finally {
    await page.close()
  }
}

// Measure a data-URL image's natural dimensions in Chromium.
async function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    return await page.evaluate(async (url: string) => {
      const img = new Image()
      await new Promise((res) => {
        img.onload = res
        img.src = url
      })
      return { w: img.naturalWidth, h: img.naturalHeight }
    }, dataUrl)
  } finally {
    await page.close()
  }
}

// Note: the Chromium instance is a shared process-wide singleton (also used by
// the print/PDF tests), so we deliberately do NOT close it here — the process
// exit reaps it.

describe('FILE-004: thumbnails', () => {
  test('isThumbnable recognizes raster images only', () => {
    expect(isThumbnable('image/png')).toBe(true)
    expect(isThumbnable('image/jpeg')).toBe(true)
    expect(isThumbnable('image/svg+xml')).toBe(false)
    expect(isThumbnable('application/pdf')).toBe(false)
    expect(isThumbnable(undefined)).toBe(false)
  })

  test('downscales a large image, preserving aspect ratio, capped at 128px', async () => {
    const png = await makePng(300, 200) // 3:2, larger than the 128 cap
    const thumb = await makeThumbnailDataUrl(png, 'image/png', 128)
    expect(thumb).toBeTruthy()
    expect(thumb!.startsWith('data:image/jpeg;base64,')).toBe(true)

    const { w, h } = await measure(thumb!)
    expect(Math.max(w, h)).toBeLessThanOrEqual(128)
    expect(w).toBe(128) // longest side hits the cap
    expect(h).toBe(85) // 200 * (128/300) ≈ 85, aspect preserved

    // The thumbnail is materially smaller than the source bytes.
    const thumbBytes = Buffer.from(thumb!.split(',')[1], 'base64').length
    expect(thumbBytes).toBeLessThan(png.length)
  }, 30_000)

  test('does not upscale an already-small image', async () => {
    const png = await makePng(64, 48)
    const thumb = await makeThumbnailDataUrl(png, 'image/png', 128)
    const { w, h } = await measure(thumb!)
    expect(w).toBe(64)
    expect(h).toBe(48)
  }, 30_000)

  test('returns null for a non-image', async () => {
    const thumb = await makeThumbnailDataUrl(Buffer.from('hello, not an image'), 'text/plain')
    expect(thumb).toBeNull()
  })

  // The cached Chromium handle used to be memoized unconditionally, so once the
  // browser died under a long-lived server every later thumbnail came back null
  // — silently, because makeThumbnailDataUrl swallows the error — and every PDF
  // 500'd, until the server was restarted. getBrowser() now relaunches when the
  // cached handle is no longer connected.
  test('recovers when the cached browser has died', async () => {
    const png = await makePng(200, 100)
    const before = await getBrowser()
    await before.close() // simulate the browser dying under the server
    expect(before.isConnected()).toBe(false)

    const thumb = await makeThumbnailDataUrl(png, 'image/png', 128)
    expect(thumb).toBeTruthy()
    expect(thumb!.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect((await getBrowser()).isConnected()).toBe(true)
  }, 30_000)
})
