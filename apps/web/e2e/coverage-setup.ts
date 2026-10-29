import { readdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Playwright calls globalSetup once, not once per worker or worker restart.
// Keep the independent component report; browser hits belong to this run only.
export default function resetBrowserCoverage() {
  const output = fileURLToPath(new URL('../.nyc_output/', import.meta.url))
  if (!existsSync(output)) return
  for (const file of readdirSync(output))
    if (/^e2e-.*\.json$/.test(file)) rmSync(`${output}${file}`)
}
