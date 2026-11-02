#!/usr/bin/env node
// A pull request that changes an app's version must take it above main's
// (ADR 0014 section 4). Two PRs bumping to the same number merge without a
// conflict, and an instance would then see changed code under an unchanged
// version. So "changed" is measured from where the PR forked, and the new
// number is compared with main as it is now.
//
//   node tools/check-app-versions.mjs [--main origin/main] [--head HEAD]
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The ordering of two versions (semver precedence), or null if either is not one. */
export function compareVersions(a, b) {
  const parse = (version) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version))
  const [left, right] = [parse(a), parse(b)]
  if (!left || !right) return null
  for (const i of [1, 2, 3]) {
    const difference = Number(left[i]) - Number(right[i])
    if (difference) return Math.sign(difference)
  }
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4])
  const [x, y] = [left[4].split('.'), right[4].split('.')]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1
    if (y[i] === undefined) return 1
    if (x[i] === y[i]) continue
    const numeric = [/^\d+$/.test(x[i]), /^\d+$/.test(y[i])]
    if (numeric[0] && numeric[1]) return Math.sign(Number(x[i]) - Number(y[i]))
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1
    return x[i] < y[i] ? -1 : 1
  }
  return 0
}

/** What is wrong with one app's version, or null. Undefined means no such app at that commit. */
export function versionProblem({ head, fork, main }) {
  if (head === fork) return null
  if (main === undefined) return compareVersions(head, head) === null ? `version ${head} is not a version` : null
  const order = compareVersions(head, main)
  if (order === null) return `cannot compare version ${head} with main's ${main}`
  return order > 0 ? null : `version ${head} is not greater than main's ${main}`
}

function run(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function versionAt(commit, packageJson, cwd) {
  let text
  try {
    text = run(['show', `${commit}:${packageJson}`], cwd)
  } catch {
    return undefined
  }
  return JSON.parse(text).version
}

/** Every problem between `head` and `main`; `git merge-base` failing throws, which fails the check. */
export function findProblems({ main, head, cwd }) {
  const fork = run(['merge-base', main, head], cwd).trim()
  const files = new Set(run(['ls-tree', '-r', '--name-only', head, '--', 'client-apps', 'example-apps'], cwd).split('\n'))
  const problems = []
  for (const file of files) {
    if (!file.endsWith('/featherbase.json')) continue
    const app = dirname(file)
    const packageJson = `${app}/package.json`
    if (!files.has(packageJson)) continue
    const problem = versionProblem({
      head: versionAt(head, packageJson, cwd),
      fork: versionAt(fork, packageJson, cwd),
      main: versionAt(main, packageJson, cwd),
    })
    if (problem) problems.push(`${app}: ${problem}`)
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = (name, fallback) => {
    const at = process.argv.indexOf(name)
    return at === -1 ? fallback : process.argv[at + 1]
  }
  const problems = findProblems({ main: option('--main', 'origin/main'), head: option('--head', 'HEAD') })
  for (const problem of problems) console.error(`::error::${problem}`)
  if (problems.length) process.exit(1)
  console.log('No app version clashes with main.')
}
