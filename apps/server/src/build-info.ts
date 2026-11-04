// #938: what this instance is running. A System Manager sees it on Admin →
// Apps, so "is the fix on staging yet?" needs no trip to the host's console.
// Railway names the commit it built from; a checkout (development) asks git.
// Anything else says "unknown" (null) rather than guessing.
import { execFileSync } from 'node:child_process'
import { readVariable } from './env'

export interface BuildInfo {
  commit: string | null
  message: string | null
  repositoryUrl: string | null
  commitUrl: string | null
  historyUrl: string | null
  /** When this server process started: roughly when it was deployed. */
  startedAt: string
}

const startedAt = new Date().toISOString()
const fromGit = new Map<string, { commit: string | null; message: string | null; repository: string | null }>()

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null
  } catch { return null }
}

/** owner/name from a GitHub remote URL (https or ssh), or null. */
function githubRepository(remote: string | null): string | null {
  const match = remote?.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

function checkout(cwd: string) {
  let known = fromGit.get(cwd)
  if (!known) {
    const commit = git(['rev-parse', 'HEAD'], cwd)
    known = commit
      ? { commit, message: git(['log', '-1', '--format=%B'], cwd), repository: githubRepository(git(['remote', 'get-url', 'origin'], cwd)) }
      : { commit: null, message: null, repository: null }
    fromGit.set(cwd, known)
  }
  return known
}

export function buildInfo(cwd = process.cwd()): BuildInfo {
  const sha = readVariable('RAILWAY_GIT_COMMIT_SHA')?.trim()
  const owner = readVariable('RAILWAY_GIT_REPO_OWNER')?.trim()
  const name = readVariable('RAILWAY_GIT_REPO_NAME')?.trim()
  const known = sha
    ? { commit: sha, message: readVariable('RAILWAY_GIT_COMMIT_MESSAGE')?.trim() || null, repository: owner && name ? `${owner}/${name}` : null }
    : checkout(cwd)
  const repositoryUrl = known.repository ? `https://github.com/${known.repository}` : null
  return {
    commit: known.commit,
    message: known.message,
    repositoryUrl,
    commitUrl: repositoryUrl && known.commit ? `${repositoryUrl}/commit/${known.commit}` : null,
    historyUrl: repositoryUrl && known.commit ? `${repositoryUrl}/commits/${known.commit}` : null,
    startedAt,
  }
}
