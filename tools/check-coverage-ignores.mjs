// ADR 0023: a coverage ignore sits at the code no test can reach, with the
// reason it cannot be reached after `--`. This lists every v8, c8 and
// istanbul ignore in the platform's sources, so a reviewer sees them, and
// fails when one gives no reason.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const IGNORE = /\b(v8|c8|istanbul)\s+ignore\b([^\n]*?)(\*\/|$)/gm

/** Each ignore comment in `text`: its line, its tool and its reason ('' when it gives none). */
export function scan(text) {
  const found = []
  for (const m of text.matchAll(IGNORE)) {
    const line = text.slice(0, m.index).split('\n').length
    const rest = m[2]
    const at = rest.indexOf('--')
    const reason = at < 0 ? '' : rest.slice(at + 2).trim()
    found.push({ line, tool: m[1], reason })
  }
  return found
}

const SOURCE = /\.(m?[jt]sx?)$/

function* files(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const path = join(dir, e.name)
    if (e.isDirectory()) yield* files(path)
    else if (SOURCE.test(e.name)) yield path
  }
}

/** The source folders the check covers, under `root`. */
export function sourceRoots(root) {
  const packages = (() => {
    try {
      return readdirSync(join(root, 'packages'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => join(root, 'packages', e.name, 'src'))
    } catch {
      return []
    }
  })()
  return [join(root, 'apps/server/src'), join(root, 'apps/web/src'), ...packages]
}

/** Every ignore under `root`'s source folders, with its file. */
export function collect(root) {
  const all = []
  for (const dir of sourceRoots(root))
    for (const file of files(dir))
      for (const hit of scan(readFileSync(file, 'utf8'))) all.push({ file: relative(root, file), ...hit })
  return all
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const all = collect(root)
  for (const i of all) console.log(`${i.file}:${i.line} ${i.tool} ignore -- ${i.reason || '(no reason)'}`)
  const bare = all.filter((i) => !i.reason)
  console.log(`check:coverage-ignores: ${all.length} ignore${all.length === 1 ? '' : 's'}, ${bare.length} without a reason`)
  if (bare.length) {
    for (const i of bare) console.error(`${i.file}:${i.line}: a ${i.tool} ignore needs a reason after "--" saying why the code cannot be reached`)
    process.exitCode = 1
  }
}
