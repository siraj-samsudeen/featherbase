// Opaque permanent ids (person-rename R1): a fixed prefix naming the kind of
// record, then 20 lowercase base32 characters (100 random bits). Never an
// address, a username or an employee code — those change and collide.
import { randomBytes } from 'node:crypto'

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

export function opaqueId(prefix: string, length = 20): string {
  const bytes = randomBytes(Math.ceil((length * 5) / 8))
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < length) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return prefix + out
}

export const PERSON_ID_PREFIX = 'psn_'
const SERVICE_ACCOUNT_ID_PREFIX = 'svc_'

/** A new service account's permanent id. */
export function newServiceAccountId(): string {
  return opaqueId(SERVICE_ACCOUNT_ID_PREFIX)
}
