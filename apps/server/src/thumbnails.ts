import { getBrowser } from './print'

// FILE-004: image optimization. Raster image uploads get a small thumbnail
// variant (a downscaled JPEG) that list/preview UIs use instead of fetching the
// full-size original. The thumbnail is produced in Chromium (already used for
// PDFs) via a canvas resize and returned as a self-contained data URI, so it
// needs no extra storage object or signed URL.

const THUMBNABLE = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function isThumbnable(mime: string | undefined): boolean {
  return !!mime && THUMBNABLE.has(mime.toLowerCase())
}

// Returns a `data:image/jpeg;base64,…` thumbnail no larger than maxDim on its
// longest side, or null if the image can't be decoded.
export async function makeThumbnailDataUrl(
  content: Buffer,
  mime: string,
  maxDim = 128,
): Promise<string | null> {
  if (!isThumbnable(mime)) return null
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    const dataUrl = `data:${mime};base64,${content.toString('base64')}`
    const thumb = await page.evaluate(
      async ({ dataUrl, maxDim }: { dataUrl: string; maxDim: number }) => {
        const img = new Image()
        const ok = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true)
          img.onerror = () => resolve(false)
          img.src = dataUrl
        })
        if (!ok || !img.width || !img.height) return null
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(img, 0, 0, w, h)
        return canvas.toDataURL('image/jpeg', 0.8)
      },
      { dataUrl, maxDim },
    )
    return thumb
  } catch {
    return null
  } finally {
    await page.close()
  }
}
