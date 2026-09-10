// Not sandboxed: fresh migration chains and CLI subprocesses need independent
// connections. Each case owns a disposable database and drops it in finally.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { verifyPassword, hashPassword } from '../src/auth'

const exec = promisify(execFile)
const cwd = fileURLToPath(new URL('..', import.meta.url))
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))

describe('#130 production bootstrap', () => {
  for (const [environment, password, expected] of [
    ['production', undefined, null], ['production', '   ', null],
    ['production', 'fresh-secret', 'fresh-secret'], ['development', undefined, 'admin'],
    ['test', undefined, 'admin'],
  ] as const) {
    it(`fresh ${environment} with ${password === undefined ? 'missing' : password.trim() ? 'explicit' : 'blank'} password`, async () => {
      const name = `bootstrap_${randomUUID().replaceAll('-', '')}`
      const adminUrl = new URL(config.databaseUrl)
      adminUrl.pathname = '/postgres'
      const control = postgres(adminUrl.toString(), { onnotice: () => {} })
      const url = new URL(adminUrl)
      url.pathname = `/${name}`
      const db = postgres(url.toString(), { onnotice: () => {} })
      const env = { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: environment, ADMIN_PASSWORD: password }
      const run = (args: string[], overrides = {}) => exec(tsx, args, { cwd, env: { ...env, ...overrides }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
      try {
        await control.unsafe(`create database "${name}"`)
        await run(['src/migrate.ts'])
        const [first] = await db`select password_hash from "user" where row_id = 'Administrator'`
        if (expected === null) expect(first.password_hash).toBeNull()
        else expect(verifyPassword(expected, first.password_hash)).toBe(true)
        // Recorded migrations must not replay 0006, and deliberate seed must
        // use the same safe policy, not directly import the retired seed.
        await run(['src/migrate.ts'])
        await run(['src/cli.ts', 'seed'])
        const [again] = await db`select password_hash from "user" where row_id = 'Administrator'`
        expect(again.password_hash).toBe(first.password_hash)
        if (expected === null) {
          const release = await run(['src/release.ts'])
          expect(release.stderr).toContain('First admin bootstrap pending')
          await run(['src/cli.ts', 'seed'], { ADMIN_PASSWORD: 'late-explicit' })
          const [late] = await db`select password_hash from "user" where row_id = 'Administrator'`
          expect(verifyPassword('late-explicit', late.password_hash)).toBe(true)
        }
        const existing = hashPassword('admin')
        await db`update "user" set password_hash = ${existing} where row_id = 'Administrator'`
        await run(['src/cli.ts', 'seed'], { ADMIN_PASSWORD: 'do-not-rotate' })
        const release = await run(['src/release.ts'], { ADMIN_PASSWORD: 'do-not-rotate' })
        expect((await db`select password_hash from "user" where row_id = 'Administrator'`)[0].password_hash).toBe(existing)
        if (environment === 'production') expect(release.stderr).toContain('known default password remains active')
      } finally {
        await db.end({ timeout: 1 })
        await control.unsafe(`drop database if exists "${name}" with (force)`)
        await control.end()
      }
    }, 120_000)
  }
})
