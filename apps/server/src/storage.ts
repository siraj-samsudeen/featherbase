import { mkdirSync } from 'node:fs'
import { readVariable } from './env'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError } from './errors'

// FILE-001: disk-backed file storage (the local equivalent of Supabase
// Storage per the architecture invariants). Uploads land under
// storage/public or storage/private; every upload also gets a File Table
// row, and files are only ever served by looking that row up — an
// unregistered path is never readable.

const ROOT =
  readVariable('FILE_STORAGE_DIR') ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'storage')

for (const bucket of ['public', 'private']) mkdirSync(join(ROOT, bucket), { recursive: true })

// Keep the original filename readable but collision- and traversal-proof:
// an 8-byte random prefix plus a sanitized basename.
function storedName(filename: string): string {
  const safe = basename(filename)
    .replace(/[^\w.\-]+/g, '_')
    .slice(-120)
  return `${randomBytes(8).toString('hex')}_${safe || 'file'}`
}

interface StoredFile {
  file_url: string
  stored_name: string
}

export async function saveUpload(
  content: Buffer,
  filename: string,
  isPrivate: boolean,
): Promise<StoredFile> {
  const stored = storedName(filename)
  const bucket = isPrivate ? 'private' : 'public'
  await writeFile(join(ROOT, bucket, stored), content)
  return {
    stored_name: stored,
    file_url: isPrivate ? `/private/files/${stored}` : `/files/${stored}`,
  }
}

export async function readStored(fileUrl: string): Promise<Buffer> {
  const stored = basename(fileUrl)
  const bucket = fileUrl.startsWith('/private/files/') ? 'private' : 'public'
  try {
    return await readFile(join(ROOT, bucket, stored))
  } catch {
    throw new AppError('NotFoundError', `File not found: ${fileUrl}`)
  }
}

export async function deleteStored(fileUrl: string): Promise<void> {
  const stored = basename(fileUrl)
  const bucket = fileUrl.startsWith('/private/files/') ? 'private' : 'public'
  await unlink(join(ROOT, bucket, stored)).catch(() => {})
}

// FILE-003: signed URLs for private files. After a permission check on the
// linked document, we mint a short-lived HMAC signature bound to the exact
// file path and an expiry, so the URL works in an <img>/<a> with no session
// header and cannot be reused for a different file or after it expires.
const urlSecret = () => readVariable('FILE_URL_SECRET') ?? readVariable('JWT_SECRET') ?? 'dev-secret-change-me'
const DEFAULT_TTL_SECONDS = 300

function signature(fileUrl: string, expires: number): string {
  return createHmac('sha256', urlSecret()).update(`${fileUrl}:${expires}`).digest('hex')
}

export function signFileUrl(fileUrl: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = signature(fileUrl, expires)
  return `${fileUrl}?expires=${expires}&signature=${sig}`
}

export function verifyFileSignature(
  fileUrl: string,
  expires: string | undefined,
  sig: string | undefined,
): boolean {
  if (!expires || !sig) return false
  const exp = Number(expires)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = signature(fileUrl, exp)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
