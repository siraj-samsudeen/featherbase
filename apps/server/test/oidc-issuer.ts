import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { setOidcTestTransport } from '../src/hosted-providers'

// Real loopback HTTP/code redemption and asymmetric signatures, never real accounts.
export async function issuer(kind: 'google' | 'microsoft' = 'google') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const tenant = '9188040d-6c67-4c5b-b112-36a304b66dad'
  const authority = kind === 'google' ? 'https://accounts.google.com' : 'https://login.microsoftonline.com'
  const tokenIssuer = kind === 'google' ? authority : `${authority}/${tenant}/v2.0`
  let claims: Record<string, unknown> = {}
  let badSignature = false
  let unavailable = false
  let exchanges = 0
  const codes = new Map<string, { nonce: string; challenge: string }>()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    res.setHeader('content-type', 'application/json')
    if (unavailable) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'server_error', error_description: 'SENTINEL_PASSWORD_TOKEN_RESPONSE' }))
    } else if (url.pathname.includes('well-known')) {
      res.end(JSON.stringify({ issuer: kind === 'google' ? tokenIssuer : `${authority}/{tenantid}/v2.0`,
        authorization_endpoint: `${authority}/authorize`, token_endpoint: `${authority}/token`, jwks_uri: `${authority}/jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] }))
    } else if (url.pathname === '/jwks') {
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', use: 'sig', alg: 'RS256' }] }))
    } else if (url.pathname === '/token') {
      exchanges++
      let body = ''
      for await (const chunk of req) body += chunk
      const params = new URLSearchParams(body)
      const code = params.get('code') ?? ''
      const operation = codes.get(code)
      codes.delete(code)
      if (!operation || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== operation.challenge) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'SENTINEL_CODE_TOKEN_PASSWORD' }))
        return
      }
      const now = Math.floor(Date.now() / 1000)
      const bodyClaims = { iss: tokenIssuer, ...(kind === 'microsoft' ? { tid: tenant } : {}), aud: 'test-client', sub: 'subject-one',
        iat: now, exp: now + 300, nonce: operation.nonce, email: 'fixture@example.test', email_verified: true, ...claims }
      const parts = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic-key' })).toString('base64url'),
        Buffer.from(JSON.stringify(bodyClaims)).toString('base64url')]
      const signature = sign('RSA-SHA256', Buffer.from(parts.join('.')), badSignature ? wrongKey : privateKey).toString('base64url')
      res.end(JSON.stringify({ token_type: 'Bearer', access_token: 'SENTINEL_ACCESS_TOKEN', id_token: [...parts, signature].join('.') }))
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  setOidcTestTransport(async (input, init) => {
    const url = new URL(String(input))
    return fetch(origin + url.pathname + url.search, init as RequestInit)
  })
  return {
    tokenIssuer,
    setClaims(value: Record<string, unknown>, wrongSignature = false) { claims = value; badSignature = wrongSignature },
    setUnavailable(value: boolean) { unavailable = value },
    code(url: URL) {
      const code = randomUUID()
      codes.set(code, { nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')! })
      return code
    },
    get exchanges() { return exchanges },
    async close() {
      setOidcTestTransport(null)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
