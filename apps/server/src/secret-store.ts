// #772 / ADR 0018: a secret pasted in the app (a MotherDuck token) is stored
// encrypted with AES-256-GCM under SECRET_STORE_KEY. The stored form is
// `v1:<base64url iv|tag|ciphertext>`; the plaintext is never logged or returned.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { AppError } from './errors'
import { currentEnvironment, DEV_ENVIRONMENTS, readVariable } from './env'

const VERSION = 'v1:'
// Development and test only, like JWT_SECRET's default.
const DEV_KEY = 'dev-secret-store-key-change-me'

function masterKey(): Buffer {
  const configured = readVariable('SECRET_STORE_KEY')?.trim()
  const dev = DEV_ENVIRONMENTS.includes(currentEnvironment())
  if (!configured && !dev)
    throw new AppError('ValidationError',
      `SECRET_STORE_KEY is not set on a "${currentEnvironment()}" server, so a pasted token cannot be stored. Set it (docs/DEPLOY.md) and paste the token again.`)
  // The key is hashed into an AES key, so its strength is the value's own.
  if (configured && configured.length < 32 && !dev)
    throw new AppError('ValidationError', 'SECRET_STORE_KEY is shorter than 32 characters; set a long random value (docs/DEPLOY.md)')
  return createHash('sha256').update(configured || DEV_KEY).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(VERSION)) throw new AppError('ValidationError', 'The stored token cannot be read; paste it again')
  const raw = Buffer.from(stored.slice(VERSION.length), 'base64url')
  // iv (12) + tag (16): a shorter value would let a truncated tag be accepted.
  if (raw.length < 28) throw new AppError('ValidationError', 'The stored token cannot be read; paste it again')
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12), { authTagLength: 16 })
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError('ValidationError', 'The stored token cannot be read with this server\'s master key (SECRET_STORE_KEY); paste it again')
  }
}

export const lastFour = (secret: string): string => secret.slice(-4)
