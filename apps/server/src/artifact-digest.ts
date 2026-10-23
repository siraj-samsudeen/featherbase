import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { canonical, refuse } from './runtime-migrations'

// Shipped files, never operator directory spelling, identify an artifact.
export async function artifactDigest(root: string) {
  const hash = createHash('sha256')
  async function walk(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      if (entry.isSymbolicLink()) refuse('Package artifact must not contain symbolic links')
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else hash.update(canonical([relative(root, file), (await readFile(file)).toString('base64')]))
    }
  }
  await walk(root)
  return hash.digest('hex')
}
