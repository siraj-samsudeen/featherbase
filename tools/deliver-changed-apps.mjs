#!/usr/bin/env node
// #1178 (D8): used by .github/workflows/deliver-apps.yml. For each app folder
// changed between two commits, deliver it with tools/deliver-app.mjs, unless
// its featherbase.json changed too: that needs an ordinary deploy, which
// upgrades it. An app the instance doesn't have is refused there and skipped.
//
//   node tools/deliver-changed-apps.mjs <before> <after>
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The app folders `changed` touches, and whether each one's manifest changed. */
export function changedApps(changed, isApp = (folder) => existsSync(join(folder, 'featherbase.json'))) {
  const apps = new Map()
  for (const file of changed) {
    const parts = file.split('/')
    const folder = parts[0] === 'client-apps' ? parts.slice(0, 3).join('/') : parts[0] === 'example-apps' ? parts.slice(0, 2).join('/') : null
    if (!folder || folder.split('/').includes('instances') || !isApp(folder)) continue
    apps.set(folder, apps.get(folder) || file === `${folder}/featherbase.json`)
  }
  return [...apps].map(([folder, manifestChanged]) => ({ folder, manifestChanged }))
}

function main([before, after]) {
  const range = /^0+$/.test(before ?? '') || !before ? [`${after}~1`, after] : [before, after]
  const changed = execFileSync('git', ['diff', '--name-only', ...range], { encoding: 'utf8' }).split('\n').filter(Boolean)
  let failed = false
  for (const { folder, manifestChanged } of changedApps(changed)) {
    if (manifestChanged) { console.log(`${folder}: featherbase.json changed; the ordinary deploy upgrades it`); continue }
    const run = spawnSync('node', ['tools/deliver-app.mjs', folder, process.env.FEATHERBASE_DELIVERY_URL], { stdio: 'inherit' })
    if (run.status !== 0) failed = true
  }
  if (failed) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
