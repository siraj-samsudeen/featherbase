// #772 / ADR 0018: a pasted warehouse token is stored encrypted under SECRET_STORE_KEY.
import { afterEach, describe, expect, it } from 'vitest'
import { overrideVariable } from '../src/env'
import { AppError } from '../src/errors'
import { decryptSecret, encryptSecret, lastFour } from '../src/secret-store'

const TOKEN = 'md-token-abcdefghijklmnop-4f2a'

afterEach(() => {
  overrideVariable('SECRET_STORE_KEY', undefined)
  overrideVariable('FEATHERBASE_ENV', undefined)
})

describe('secret store', () => {
  it('gives back what it was given, and the stored form never contains it', () => {
    overrideVariable('SECRET_STORE_KEY', 'a-long-random-master-key')
    const stored = encryptSecret(TOKEN)
    expect(stored).not.toContain(TOKEN)
    expect(stored).not.toContain('4f2a')
    expect(decryptSecret(stored)).toBe(TOKEN)
  })

  it('encrypts the same token differently each time', () => {
    overrideVariable('SECRET_STORE_KEY', 'a-long-random-master-key')
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN))
  })

  it('refuses a stored value that was tampered with, without naming the token', () => {
    overrideVariable('SECRET_STORE_KEY', 'a-long-random-master-key')
    const stored = encryptSecret(TOKEN)
    const bytes = Buffer.from(stored.slice(3), 'base64url')
    bytes[bytes.length - 1] ^= 1
    const flipped = `v1:${bytes.toString('base64url')}`
    expect(() => decryptSecret(flipped)).toThrow(AppError)
    expect(() => decryptSecret('not-a-stored-secret')).toThrow(/cannot be read/)
  })

  it('cannot read a value stored under a different master key', () => {
    overrideVariable('SECRET_STORE_KEY', 'first-master-key')
    const stored = encryptSecret(TOKEN)
    overrideVariable('SECRET_STORE_KEY', 'second-master-key')
    expect(() => decryptSecret(stored)).toThrow(/master key/)
  })

  it('works without a master key in development and test, and refuses elsewhere, naming the variable', () => {
    overrideVariable('SECRET_STORE_KEY', undefined)
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN)
    overrideVariable('FEATHERBASE_ENV', 'production')
    expect(() => encryptSecret(TOKEN)).toThrow(/SECRET_STORE_KEY is not set/)
  })

  it('shows only the last four characters', () => {
    expect(lastFour(TOKEN)).toBe('4f2a')
    expect(lastFour('ab')).toBe('ab')
  })
})

describe('secret store outside development', () => {
  it('a stored token cannot be read on a server with no master key, and the refusal names the variable', () => {
    overrideVariable('SECRET_STORE_KEY', 'a-long-random-master-key')
    const stored = encryptSecret(TOKEN)
    overrideVariable('SECRET_STORE_KEY', undefined)
    overrideVariable('FEATHERBASE_ENV', 'production')
    expect(() => decryptSecret(stored)).toThrow(/SECRET_STORE_KEY is not set/)
  })
})

describe('secret store hardening (#772 security review)', () => {
  it('refuses a short master key outside development, and a stored value too short to hold a full tag', () => {
    overrideVariable('SECRET_STORE_KEY', 'a-long-random-master-key-of-40-characters')
    const stored = encryptSecret(TOKEN)
    expect(() => decryptSecret(stored.slice(0, 20))).toThrow(/cannot be read/)
    overrideVariable('SECRET_STORE_KEY', 'too-short')
    overrideVariable('FEATHERBASE_ENV', 'production')
    expect(() => encryptSecret(TOKEN)).toThrow(/shorter than 32 characters/)
  })
})
