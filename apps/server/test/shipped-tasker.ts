// #695: the Tasker versions this release ships, read from the one place that
// decides them: the image's FEATHERBASE_APP_PATHS (apps/server/Dockerfile).
// Each image path maps to its source in this repository: /app/runtime-apps/
// tasker is runtime-apps/tasker, /app/runtime-apps/tasker-X.Y.0 is the
// predecessor fixture runtime-apps/fixtures/tasker-vX.Y. Tests that upgrade
// from a predecessor discover exactly these paths, so a version the image
// does not ship cannot pass by being added to a test.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function imageAppPaths(): string[] {
  const dockerfile = readFileSync(resolve(repo, 'apps/server/Dockerfile'), 'utf8')
  const line = dockerfile.match(/^ENV FEATHERBASE_APP_PATHS='(.*)'$/m)
  if (!line) throw new Error('apps/server/Dockerfile sets no FEATHERBASE_APP_PATHS')
  return JSON.parse(line[1]) as string[]
}

function sourceOf(imagePath: string): string {
  if (imagePath === '/app/runtime-apps/tasker') return resolve(repo, 'runtime-apps/tasker')
  const predecessor = imagePath.match(/^\/app\/runtime-apps\/tasker-(\d+)\.(\d+)\.0$/)
  if (predecessor) return resolve(repo, `runtime-apps/fixtures/tasker-v${predecessor[1]}.${predecessor[2]}`)
  throw new Error(`No source in this repository for the image's app path ${imagePath}`)
}

const versionOf = (directory: string) =>
  (JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version: string }).version

/** The shipped Tasker directories, in the image's order (oldest first). */
export const shippedTasker = imageAppPaths().map(sourceOf)
export const currentTasker = resolve(repo, 'runtime-apps/tasker')
export const currentTaskerVersion = versionOf(currentTasker)
/** Each shipped predecessor: its directory and the version it installs. */
export const shippedPredecessors = shippedTasker
  .filter(directory => directory !== currentTasker)
  .map(directory => ({ directory, version: versionOf(directory) }))
