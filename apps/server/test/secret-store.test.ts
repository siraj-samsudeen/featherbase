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
    const flipped = stored.slice(0, -2) + (stored.endsWith('A') ? 'B' : 'A') + stored.slice(-1)
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
