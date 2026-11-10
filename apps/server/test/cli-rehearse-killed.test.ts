// `cli migrate:rehearse` runs the rehearsal as its own process and exits with
// its status. A child ended by a signal has no status; the command then fails.
// The child process is stubbed at its boundary: spawnSync answers as Node does
// for a child killed by a signal.
import { expect, test, vi } from 'vitest'
import { runMain } from './command-io'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawnSync: () => ({ pid: 1, output: [], stdout: null, stderr: null, status: null, signal: 'SIGKILL' }) }
})

const { main } = await import('../src/cli')

test('a rehearsal ended by a signal fails the command', async () => {
  expect((await runMain(main, ['migrate:rehearse'])).code).toBe(1)
})
