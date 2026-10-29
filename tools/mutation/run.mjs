import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Run the real shared suite against a disposable source copy, never rewriting
// a developer's checkout. This pure-function slice needs no database. Keep
// forks: Node worker threads do not apply process.env.TZ changes to Date.
const tool = dirname(fileURLToPath(import.meta.url))
const shared = resolve(tool, '../../packages/shared')
// The isolated runner must exercise the application's actual Zod version.
// Refuse dependency drift rather than producing a score for a different API.
const version = (root) => JSON.parse(readFileSync(join(root, 'node_modules/zod/package.json'), 'utf8')).version
if (version(tool) !== version(shared)) throw new Error('Update tools/mutation to the installed shared Zod version before running mutations')
const sandbox = mkdtempSync(join(tmpdir(), 'featherbase-mutation-'))
const reports = join(tool, 'reports')

try {
  rmSync(reports, { recursive: true, force: true })
  for (const path of ['src', 'test', 'vitest.config.ts', 'tsconfig.json']) {
    cpSync(join(shared, path), join(sandbox, path), { recursive: true })
  }
  for (const path of ['package.json', 'stryker.config.json']) {
    cpSync(join(tool, path), join(sandbox, path))
  }
  symlinkSync(join(tool, 'node_modules'), join(sandbox, 'node_modules'), 'dir')
  const result = spawnSync(process.execPath, [join(tool, 'node_modules/@stryker-mutator/core/bin/stryker.js'), 'run'], {
    cwd: sandbox,
    env: { ...process.env, TZ: 'Asia/Kolkata' },
    stdio: 'inherit',
  })
  if (existsSync(join(sandbox, 'reports'))) {
    cpSync(join(sandbox, 'reports'), reports, { recursive: true })
    console.log(`Mutation reports: ${reports}`)
  }
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
