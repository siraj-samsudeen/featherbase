// Sign in with Microsoft (microsoft-sign-in, D2/D3): what Featherbase believes
// from a Microsoft ID token. The permanent subject is the tenant plus the
// object ID; the address counts only when Microsoft says the tenant verified
// its domain (`xms_edov`), never from `preferred_username`.
import { describe, expect, test } from 'vitest'
import { microsoftIdentityFromClaims, microsoftNonce, MICROSOFT_CONSUMER_TENANT } from '../src/microsoft'

const TID = '0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11'
const OID = '5f1e2d3c-4b5a-4968-8776-655443322110'
const CLIENT = 'b1e2c3d4-0000-4000-8000-00000000c1d0'
const NONCE = microsoftNonce('some-state')
const NOW = 1_800_000_000

function claims(over: Record<string, unknown> = {}) {
  return {
    iss: `https://login.microsoftonline.com/${TID}/v2.0`,
    aud: CLIENT,
    exp: NOW + 600,
    iat: NOW - 5,
    nonce: NONCE,
    tid: TID,
    oid: OID,
    email: 'Asha@Bisquared.example',
    xms_edov: true,
    preferred_username: 'asha@bisquared.example',
    name: 'Asha Kumar',
    ...over,
  }
}

const expected = { clientId: CLIENT, tenant: 'organizations', nonce: NONCE, now: NOW }
const read = (over: Record<string, unknown> = {}, exp: Partial<typeof expected> = {}) =>
  microsoftIdentityFromClaims(claims(over), { ...expected, ...exp })

describe('a Microsoft ID token', () => {
  test('a good token: subject is tenant + object ID, the verified address and its domain', () => {
    expect(read()).toEqual({
      status: 'verified',
      subject: `${TID}/${OID}`,
      email: 'asha@bisquared.example',
      email_verified: true,
      display_name: 'Asha Kumar',
      hosted_domain: 'bisquared.example',
    })
  })

  test('without xms_edov the address is not kept, not verified, and has no domain', () => {
    for (const edov of [undefined, false, 'false', 0, null]) {
      const v = read({ xms_edov: edov })
      expect(v).toMatchObject({ status: 'verified', subject: `${TID}/${OID}`, email: null, email_verified: false, hosted_domain: null })
    }
  })

  test('xms_edov may arrive as a string or a number', () => {
    expect(read({ xms_edov: 'true' }).email_verified).toBe(true)
    expect(read({ xms_edov: 1 }).email_verified).toBe(true)
  })

  test('preferred_username is never taken as the address', () => {
    const v = read({ email: undefined })
    expect(v.email).toBeNull()
    expect(v.email_verified).toBe(false)
  })

  test.each([
    ['another issuer', { iss: 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0' }],
    ['a v1 issuer', { iss: `https://sts.windows.net/${TID}/` }],
    ['another audience', { aud: 'someone-else' }],
    ['an expired token', { exp: NOW - 301 }],
    ['another nonce', { nonce: microsoftNonce('other-state') }],
    ['no nonce', { nonce: undefined }],
    ['no object ID', { oid: undefined }],
    ['a tenant that is not an ID', { tid: 'bisquared.example', iss: 'https://login.microsoftonline.com/bisquared.example/v2.0' }],
    ['a personal Microsoft account', { tid: MICROSOFT_CONSUMER_TENANT, iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0` }],
  ])('refuses %s', (_name, over) => {
    expect(() => read(over)).toThrow(/Microsoft/)
  })

  test('a method set to one tenant refuses any other', () => {
    expect(read({}, { tenant: TID }).subject).toBe(`${TID}/${OID}`)
    expect(() => read({}, { tenant: '22222222-2222-4222-8222-222222222222' })).toThrow(/Microsoft/)
  })

  test('the nonce is bound to the sign-in that started it', () => {
    expect(microsoftNonce('a')).not.toBe(microsoftNonce('b'))
    expect(microsoftNonce('a')).toBe(microsoftNonce('a'))
  })
})
