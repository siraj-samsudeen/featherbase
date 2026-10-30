#!/usr/bin/env node
// `pnpm apps:prepare`: install, test and build the apps this repo ships that
// are their own npm projects (Tasker and the client app Feather Dash, each with
// its package-lock.json), and build the scope-proof fixture. Feather Dash is
// built before its tests: one of them runs the platform's loader over its dist.
//
// They are run with npm, as their lockfiles say, but in npm's own environment.
// pnpm hands its settings to every script it runs as npm_config_* variables
// (npm_config_verify_deps_before_run, npm_config__jsr_registry, …); an npm
// started from that script reads them as npm settings and warns about each
// one it does not know (#692). So the npm_config_* variables are dropped and
// npm reads its settings from .npmrc and its defaults, as it does from a
// shell. An npm setting meant for these installs belongs in .npmrc.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)))

const steps = [
  ['ci', '--prefix', 'runtime-apps/tasker', '--ignore-scripts'],
  ['test', '--prefix', 'runtime-apps/tasker'],
  ['run', 'build', '--prefix', 'runtime-apps/tasker'],
  ['run', 'build', '--prefix', 'runtime-apps/scope-proof'],
  ['ci', '--prefix', 'client-apps/jeyarama/dash', '--ignore-scripts'],
  ['run', 'build', '--prefix', 'client-apps/jeyarama/dash'],
  ['test', '--prefix', 'client-apps/jeyarama/dash'],
]
for (const args of steps) {
  const result = spawnSync('npm', args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
