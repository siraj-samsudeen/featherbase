import zlib from 'node:zlib'
import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// FILE-004: an image attachment shows a thumbnail; a non-image does not.

// Build a valid RGB PNG of the given size (no deps) so Chromium can decode it.
const CRC = (() => {
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      const i = off + 1 + x * 3
      raw[i] = (x * 255) / w
      raw[i + 1] = (y * 255) / h
      raw[i + 2] = 128
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Isolated to its own DocType/doc so it never contends with the FILE-002
// attachments spec (which uses User/Guest) when specs run in parallel.
const DT = 'Thumb E2E Doc'
const DOC = 'thumb-e2e-1'

async function adminAuth(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data' }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${DOC}`, { headers })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { name: DOC, title: 'x' } })
})

async function cleanupFiles(request: APIRequestContext) {
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['ref_doctype', '=', DT], ['ref_name', '=', DOC]]))
  const listed = (await (await request.get(`/api/resource/File?filters=${filters}`, { headers })).json()) as { data: { name: string }[] }
  for (const f of listed.data) await request.delete(`/api/resource/File/${f.name}`, { headers })
}

test.beforeEach(async ({ request }) => cleanupFiles(request))
test.afterEach(async ({ request }) => cleanupFiles(request))

test('FILE-004: image attachment gets a thumbnail; text does not', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${DOC}`)
  await expect(page.getByTestId('attachments-panel')).toBeVisible()

  // Attach a real (decodable) image.
  await page.getByTestId('attach-file-input').setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer: makePng(240, 160),
  })
  const imgRow = page.getByTestId('attachment-row').filter({ hasText: 'picture.png' })
  await expect(imgRow).toHaveCount(1)

  // A thumbnail image is shown, sourced from an inline JPEG data URI.
  const thumb = imgRow.getByTestId('attachment-thumb')
  await expect(thumb).toBeVisible()
  const src = await thumb.getAttribute('src')
  expect(src).toMatch(/^data:image\/jpeg;base64,/)
  // The thumbnail actually decodes and is small (≤128px on its longest side).
  const dims = await thumb.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }))
  expect(Math.max(dims.w, dims.h)).toBeLessThanOrEqual(128)
  expect(dims.w).toBeGreaterThan(0)

  // Attach a text file → no thumbnail on its row.
  await page.getByTestId('attach-file-input').setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  })
  const txtRow = page.getByTestId('attachment-row').filter({ hasText: 'note.txt' })
  await expect(txtRow).toHaveCount(1)
  await expect(txtRow.getByTestId('attachment-thumb')).toHaveCount(0)
})
