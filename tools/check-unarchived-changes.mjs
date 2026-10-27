#!/usr/bin/env node
/**
 * CI check: a finished OpenSpec change is archived in the PR that finishes it.
 *
 * Archiving is what folds a change's delta into openspec/specs. Agents ticked
 * every task and merged without archiving, so by 26-Oct-2026 thirty-six built
 * changes had never reached the main specs and those specs described early
 * October. This check makes the PR that ticks a change's last task also
 * archive it: an active change under openspec/changes/ (not archive/) whose
 * tasks.md has tasks and every one of them ticked fails the build.
 *
 * A change that is genuinely still open — later stages to come, or a step
 * only the owner can take — keeps that task unticked, and passes.
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

/** True when the change is finished and should have been archived. */
export function isFinished({ total, done }) {
  return total > 0 && done === total
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const changes = path.join(root, 'openspec', 'changes')
  const finished = []
  for (const name of fs.readdirSync(changes).sort()) {
    if (name === 'archive') continue
    const tasks = path.join(changes, name, 'tasks.md')
    if (!fs.existsSync(tasks)) continue
    const counts = countTasks(fs.readFileSync(tasks, 'utf8'))
    if (isFinished(counts)) finished.push({ name, ...counts })
  }
  if (finished.length === 0) {
    console.log('check:unarchived-changes: every finished OpenSpec change is archived')
    return
  }
  console.error('Finished OpenSpec changes that are not archived (every task ticked):')
  for (const f of finished) console.error(`  ${f.name} (${f.done}/${f.total})`)
  console.error('\nArchive each in this PR so its delta reaches openspec/specs:')
  for (const f of finished) console.error(`  pnpm exec openspec archive ${f.name} --yes`)
  console.error('If the change is not finished, leave its remaining task unticked.')
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main()
