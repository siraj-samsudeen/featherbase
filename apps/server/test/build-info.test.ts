// #938: a System Manager can see what an instance is running: the platform
// commit it was built from, and what changed in each app version.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'
import { test } from './pg-test'
import { overrideVariable } from '../src/env'
import { buildInfo } from '../src/build-info'
import { expectRefused } from './fixtures'

const RAILWAY = ['RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_GIT_COMMIT_MESSAGE', 'RAILWAY_GIT_REPO_OWNER', 'RAILWAY_GIT_REPO_NAME'] as const

afterEach(() => { for (const name of RAILWAY) overrideVariable(name, undefined) })

interface Apps {
  build: { commit: string | null; message: string | null; commitUrl: string | null; historyUrl: string | null; repositoryUrl: string | null; startedAt: string }
  catalog: { name: string; version: string; releaseNotes?: { version: string; changes: string[] }[] }[]
}

test('a deployed instance shows the commit its host built it from, linked to that commit and its history', async ({ admin }) => {
  const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
  overrideVariable('RAILWAY_GIT_COMMIT_SHA', sha)
  overrideVariable('RAILWAY_GIT_COMMIT_MESSAGE', 'Merge pull request #903 from example/branch\n\n#861 item 2: readers see no errors on a row')
  overrideVariable('RAILWAY_GIT_REPO_OWNER', 'example-owner')
  overrideVariable('RAILWAY_GIT_REPO_NAME', 'featherbase')
  const { build } = await admin.get<Apps>('/api/apps')
  expect(build).toMatchObject({
    commit: sha,
    message: 'Merge pull request #903 from example/branch\n\n#861 item 2: readers see no errors on a row',
    repositoryUrl: 'https://github.com/example-owner/featherbase',
    commitUrl: `https://github.com/example-owner/featherbase/commit/${sha}`,
    historyUrl: `https://github.com/example-owner/featherbase/commits/${sha}`,
  })
  expect(Date.parse(build.startedAt)).toBeLessThanOrEqual(Date.now())
})

test('a host that names only the commit gets no links, rather than wrong ones', () => {
  overrideVariable('RAILWAY_GIT_COMMIT_SHA', 'f00dbabe')
  expect(buildInfo()).toMatchObject({ commit: 'f00dbabe', message: null, repositoryUrl: null, commitUrl: null, historyUrl: null })
})

test('a checkout with no host variables reads its own git commit', async () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const subject = execFileSync('git', ['log', '-1', '--format=%B'], { encoding: 'utf8' }).trim()
  expect(buildInfo()).toMatchObject({ commit: head, message: subject })
})

test('a build that cannot tell its commit says so rather than guessing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'build-info-'))
  try {
    expect(buildInfo(folder)).toMatchObject({ commit: null, message: null, commitUrl: null, historyUrl: null, repositoryUrl: null })
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('a checkout with no GitHub remote names its commit but links nowhere, and an empty message is none', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'build-info-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  try {
    run('init', '-q')
    run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '--allow-empty-message', '-m', '')
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim()
    // A commit with no message has none to show. No origin at all, then an
    // origin that is not on GitHub: neither gets links.
    expect(buildInfo(folder)).toMatchObject({ commit: head, message: null, repositoryUrl: null, commitUrl: null })
    run('remote', 'add', 'origin', 'https://git.example.com/team/featherbase.git')
    const other = await mkdtemp(join(tmpdir(), 'build-info-'))
    try {
      execFileSync('git', ['clone', '-q', folder, other], { stdio: 'ignore' })
      execFileSync('git', ['remote', 'set-url', 'origin', 'https://git.example.com/team/featherbase.git'], { cwd: other, stdio: 'ignore' })
      expect(buildInfo(other)).toMatchObject({ commit: head, repositoryUrl: null, commitUrl: null, historyUrl: null })
    } finally { await rm(other, { recursive: true, force: true }) }
  } finally { await rm(folder, { recursive: true, force: true }) }
})

test('each app shows what changed in its current version, newest first', async ({ admin }) => {
  const { catalog } = await admin.get<Apps>('/api/apps')
  const tasker = catalog.find(app => app.name === 'tasker')!
  expect(tasker.releaseNotes?.[0]?.version).toBe(tasker.version)
  expect(tasker.releaseNotes?.map(note => note.version)).toEqual(['3.3.2', '3.3.1', '3.3.0', '3.2.0', '3.1.0', '3.0.3', '3.0.2', '3.0.1', '3.0.0'])
  expect(tasker.releaseNotes?.[7]?.changes.join(' ')).toContain('#563')
})

test('only a System Manager sees what the instance is running', async ({ createUser }) => {
  const member = await createUser({ email: 'build-info.member@example.com' })
  await expectRefused(member.get('/api/apps'), 403)
})
