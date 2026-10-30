#!/usr/bin/env node
/**
 * CI check: a finished OpenSpec change does not stay unarchived on main.
 *
 * Archiving is what folds a change's delta into openspec/specs. Agents ticked
 * every task and never archived, so by 26-Oct-2026 thirty-six built changes
 * had never reached the main specs (#553).
 *
 * The flow is proposal PR → implementation PR → archive on main after the
 * implementation merges (ADR 0014, the change-modes skill). So a finished,
 * unarchived change (every task in tasks.md ticked, still under
 * openspec/changes/ and not archive/) is expected in two places, and only
 * reported there:
 *   - the implementation PR that ticks its last task;
 *   - main, between that merge and the archive commit.
 * It fails a PR only when the change was already finished on the PR's base:
 * it reached main finished and nobody archived it. Failing the next PR,
 * rather than main itself, keeps main green, since every main commit is a
 * deploy.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const TASK = /^\s*- \[([ xX])\]/

/** Task counts for one tasks.md: { total, done }. */
export function countTasks(text) {
  let total = 0
  let done = 0
  for (const line of text.split('\n')) {
    const m = TASK.exec(line)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return { total, done }
}

/** True when the change is finished and should be archived. */
export function isFinished({ total, done }) {
  return total > 0 && done === total
}

/**
 * Splits the finished changes in the working tree by whether the base already
 * had them finished. `finishedOnBase` is null when there is no base to compare
 * with (on main), and then nothing is stale.
 */
export function classify(finishedHere, finishedOnBase) {
  const stale = finishedOnBase ? finishedHere.filter((c) => finishedOnBase.has(c.name)) : []
  const fresh = finishedHere.filter((c) => !stale.includes(c))
  return { stale, fresh }
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim()
}

function tryGit(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

/**
 * The commit to compare with, or null on main. In a pull_request run the
 * checkout is the merge commit, whose first parent is the base branch tip; a
 * shallow checkout is deepened by one commit to reach it. Locally, a branch
 * other than main compares with origin/main.
 */
function baseRef(env) {
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    if (!tryGit(['rev-parse', '--verify', '-q', 'HEAD^1'])) tryGit(['fetch', '--deepen=1', '--quiet'])
    return tryGit(['rev-parse', '--verify', '-q', 'HEAD^1']) ? 'HEAD^1' : null
  }
  if (env.GITHUB_ACTIONS) return null
  const branch = tryGit(['branch', '--show-current'])
  if (!branch || branch === 'main') return null
  return tryGit(['rev-parse', '--verify', '-q', 'origin/main']) ? 'origin/main' : null
}

function finishedOn(ref, names) {
  const finished = new Set()
  for (const name of names) {
    const text = tryGit(['show', `${ref}:openspec/changes/${name}/tasks.md`])
    if (text !== null && isFinished(countTasks(text))) finished.add(name)
  }
  return finished
}

function main() {
  const root = git(['rev-parse', '--show-toplevel'])
  const changes = path.join(root, 'openspec', 'changes')
  const finishedHere = []
  for (const name of fs.readdirSync(changes).sort()) {
    if (name === 'archive') continue
    const tasks = path.join(changes, name, 'tasks.md')
    if (!fs.existsSync(tasks)) continue
    const counts = countTasks(fs.readFileSync(tasks, 'utf8'))
    if (isFinished(counts)) finishedHere.push({ name, ...counts })
  }
  if (finishedHere.length === 0) {
    console.log('check:unarchived-changes: no finished OpenSpec change is waiting to be archived')
    return
  }
  const base = baseRef(process.env)
  const { stale, fresh } = classify(finishedHere, base ? finishedOn(base, finishedHere.map((c) => c.name)) : null)
  if (fresh.length > 0) {
    console.log('check:unarchived-changes: finished, to be archived on main once this work merges:')
    for (const f of fresh) console.log(`  ${f.name} (${f.done}/${f.total})  →  pnpm exec openspec archive ${f.name} --yes`)
  }
  if (stale.length === 0) return
  console.error(`Finished OpenSpec changes that reached ${base === 'HEAD^1' ? 'the base branch' : base} and were never archived:`)
  for (const f of stale) console.error(`  ${f.name} (${f.done}/${f.total})`)
  console.error('\nArchive each on main (sync the specs, then archive), then update this branch:')
  for (const f of stale) console.error(`  pnpm exec openspec archive ${f.name} --yes`)
  console.error('If the change is not finished, untick its remaining task on main.')
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main()
