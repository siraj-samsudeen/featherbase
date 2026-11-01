// #307: the deploy's pre-deploy step (`pnpm --filter server pre-deploy`) run
// in this process through `main(argv, io)` (ADR 0012), inside a rolled-back
// sandbox: the release, then the preview seed, and a failure of either fails
// the deploy.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sql } from '../src/db'
import { main } from '../src/pre-deploy'
import { PREVIEW_KEY_MIN_LENGTH } from '../src/preview'
import { runMain } from './command-io'
import { test } from './pg-test'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PREVIEW_USER = 'pre-deploy-preview@example.com'

afterEach(() => {
  vi.unstubAllEnvs()
})

function configurePreview(user = PREVIEW_USER) {
  vi.stubEnv('PREVIEW_LOGIN_KEY', 'k'.repeat(PREVIEW_KEY_MIN_LENGTH))
  vi.stubEnv('PREVIEW_LOGIN_USER', user)
}

describe('the deploy config runs one pre-deploy command', () => {
  it('.railway/railway.ts names the pre-deploy command alone in every environment, with nothing a shell would have to read', async () => {
    const { createRailwayContext, project } = await import('railway/iac')
    const { default: program } = await import('../../../.railway/railway')
    // The host may run each entry as argv, not through a shell: an `&&` there
    // is an argument, and whatever follows it silently never runs.
    for (const environment of ['production', 'staging']) {
      const { resources = [] } = await program(createRailwayContext({ environment }), project)
      const server = resources.flat().find(resource => resource.type === 'service')
      expect(server?.type === 'service' && server.deploy?.preDeployCommand, environment).toEqual(['pnpm --filter server pre-deploy'])
    }
    const server = JSON.parse(readFileSync(join(repo, 'apps', 'server', 'package.json'), 'utf8'))
    expect(server.scripts['pre-deploy']).toBe('tsx src/pre-deploy.ts')
  })

  // The one case run as a process: the entry point runs main, prints to the
  // real streams and exits 0. Without preview variables it writes nothing.
  it('run as a process, it releases and reports the preview seed', () => {
    const env = { ...process.env }
    delete env.PREVIEW_LOGIN_KEY
    delete env.PREVIEW_LOGIN_USER
    const output = execFileSync(process.execPath, ['--import', 'tsx', join(repo, 'apps', 'server', 'src', 'pre-deploy.ts')], {
      cwd: join(repo, 'apps', 'server'), env, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(output).toContain('preflight: pending migrations: none\n')
    expect(output).toContain('preview sign-in is not configured here — nothing to seed\n')
  }, 60_000)
})

describe('pre-deploy for a client instance', () => {
  it('refuses a development server before the release changes anything', async () => {
    vi.stubEnv('FEATHERBASE_INSTANCE', 'jeyarama/dash')
    vi.stubEnv('FEATHERBASE_ENV', 'development')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('use pnpm dev')
    expect(r.stdout).not.toContain('preflight:')
  })

  it('refuses an image that holds no such instance before the release changes anything', async () => {
    vi.stubEnv('FEATHERBASE_INSTANCE', 'acme/not_here')
    vi.stubEnv('FEATHERBASE_ENV', 'staging')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('holds no instance "acme/not_here"')
    expect(r.stdout).not.toContain('preflight:')
  })
})

describe('pre-deploy for a client instance, past the release', () => {
  it('a problem in the instance step fails the deploy', async () => {
    vi.stubEnv('FEATHERBASE_INSTANCE', 'jeyarama/dash')
    vi.stubEnv('FEATHERBASE_ENV', 'staging')
    vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('preflight:')
    expect(r.stderr).toContain('deploy failed: This image ships no app')
  })
})

describe('pre-deploy', () => {
  test('with preview sign-in configured it releases, then creates the preview person and the demo Table', async () => {
    configurePreview()
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('preflight: pending migrations: none\n')
    expect(r.stdout.indexOf('preflight: pending migrations')).toBeLessThan(r.stdout.indexOf('preview seed complete'))
    const [person] = await sql`select row_id, enabled from person where lower(email) = ${PREVIEW_USER}`
    expect(person).toMatchObject({ enabled: true })
    expect(await sql`select 1 from table_def where name = 'Store Sections'`).toHaveLength(1)
    // A second deploy converges.
    const again = await runMain(main, [])
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('demo Table Store Sections already exists')
    expect(await sql`select count(*)::int as n from person where lower(email) = ${PREVIEW_USER}`).toEqual([{ n: 1 }])
  })

  test('without preview sign-in it releases and seeds nothing', async () => {
    vi.stubEnv('PREVIEW_LOGIN_KEY', '')
    vi.stubEnv('PREVIEW_LOGIN_USER', '')
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('preview sign-in is not configured here — nothing to seed\n')
    expect(await sql`select 1 from table_def where name = 'Store Sections'`).toEqual([])
  })

  test('a release that stops fails the step, and the seed does not run', async () => {
    configurePreview()
    vi.stubEnv('FEATHERBASE_ENV', '')
    vi.stubEnv('NODE_ENV', '')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/^release failed — aborting: /)
    expect(r.stdout).not.toContain('preview')
    expect(await sql`select 1 from person where lower(email) = ${PREVIEW_USER}`).toEqual([])
  })

  test('a preview seed that fails fails the step', async () => {
    configurePreview('nobody@example.invalid')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/^preview seed failed: /m)
  })
})
