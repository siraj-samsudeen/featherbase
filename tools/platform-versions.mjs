// Prints the platform versions this Featherbase runs apps on, read from
// SUPPORTED_PLATFORM_VERSIONS in apps/server/src/runtime-packages.ts, joined
// by commas. The image publish workflow (.github/workflows/publish-image.yml)
// stamps it on the platform image as a label, so the label can never drift
// from the code (#587).
//
//   node tools/platform-versions.mjs   → 2026-10
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function platformVersions(source) {
  const declaration = source.match(/SUPPORTED_PLATFORM_VERSIONS[^=]*=\s*\[([^\]]*)\]/)
  if (!declaration) throw new Error('No SUPPORTED_PLATFORM_VERSIONS array found')
  const entries = declaration[1].split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.map((entry) => {
    const version = entry.match(/^(['"])(.*)\1$/)?.[2]
    if (!version || !MONTH.test(version)) throw new Error(`SUPPORTED_PLATFORM_VERSIONS entry ${entry} is not a month, like '2026-10'`)
    return version
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync(new URL('../apps/server/src/runtime-packages.ts', import.meta.url), 'utf8')
  console.log(platformVersions(source).join(','))
}
