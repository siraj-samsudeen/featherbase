import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { compareVersions, findProblems, versionProblem } from './check-app-versions.mjs'

test('versions order numerically, and a pre-release sits below its release', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1)
  assert.equal(compareVersions('1.0.0-1', '1.0.0-rc'), -1)
  assert.equal(compareVersions('1.0', '1.0.0'), null)
})

test('an unchanged version is never a problem, even behind main', () => {
  assert.equal(versionProblem({ head: '1.0.0', fork: '1.0.0', main: '1.1.0' }), null)
})

test('a changed version must be greater than main', () => {
  assert.equal(versionProblem({ head: '1.1.0', fork: '1.0.0', main: '1.0.0' }), null)
  assert.match(versionProblem({ head: '0.9.0', fork: '1.0.0', main: '1.0.0' }), /not greater/)
})

test('two PRs bumping to the same number clash', () => {
  assert.match(versionProblem({ head: '1.1.0', fork: '1.0.0', main: '1.1.0' }), /not greater/)
})

test('a new app needs only a real version; a broken one fails', () => {
  assert.equal(versionProblem({ head: '0.1.0', fork: undefined, main: undefined }), null)
  assert.match(versionProblem({ head: 'soon', fork: undefined, main: undefined }), /not a version/)
  assert.match(versionProblem({ head: undefined, fork: '1.0.0', main: '1.0.0' }), /cannot compare/)
})

test('reads real commits: only apps with both files, under the two app folders', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fb-ci-versions-'))
  try {
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'pipe' })
    const put = (folder, version, manifest = true) => {
      mkdirSync(join(cwd, folder), { recursive: true })
      writeFileSync(join(cwd, folder, 'package.json'), JSON.stringify({ version }))
      if (manifest) writeFileSync(join(cwd, folder, 'featherbase.json'), '{}')
    }
    const commit = () => { git('add', '.'); git('commit', '-m', 'x') }
    git('init', '-b', 'main')
    put('client-apps/c/a', '1.0.0')
    put('example-apps/t', '2.0.0')
    put('example-apps/not-an-app', '1.0.0', false)
    put('test-apps/x', '1.0.0')
    commit()
    git('checkout', '-b', 'pr')
    put('client-apps/c/a', '1.1.0')
    put('example-apps/not-an-app', '0.0.1', false)
    put('test-apps/x', '0.0.1')
    commit()
    assert.deepEqual(findProblems({ main: 'main', head: 'pr', cwd }), [])

    git('checkout', 'main')
    put('client-apps/c/a', '1.1.0')
    commit()
    assert.deepEqual(findProblems({ main: 'main', head: 'pr', cwd }), ["client-apps/c/a: version 1.1.0 is not greater than main's 1.1.0"])
    assert.throws(() => findProblems({ main: 'no-such-ref', head: 'pr', cwd }))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
