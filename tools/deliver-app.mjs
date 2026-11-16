#!/usr/bin/env node
// #1178 (D8): build one app and deliver its code fix to a running instance,
// which serves it at once (docs/DEPLOY.md, "Delivering an app fix").
//
//   APP_DELIVERY_TOKEN=… node tools/deliver-app.mjs <app folder> <instance address>
//   e.g. node tools/deliver-app.mjs client-apps/jeyarama/dash https://dash.example.com
//
// Only a code change to the installed version is taken; the instance refuses a
// changed featherbase.json, which needs an ordinary deploy.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyShipped } from './build-instance-apps.mjs'
import { buildApp, DevError } from './dev.mjs'

/** Every file under `folder`, as the instance takes them: relative path and base64. */
export function filesOf(folder, under = '') {
  return readdirSync(join(folder, under), { withFileTypes: true }).flatMap((entry) => {
    const path = under ? `${under}/${entry.name}` : entry.name
    return entry.isDirectory() ? filesOf(folder, path) : [{ path, data: readFileSync(join(folder, path)).toString('base64') }]
  })
}

async function main([appFolder, address]) {
  if (!appFolder || !address) throw new DevError('usage: deliver-app.mjs <app folder> <instance address>')
  const key = process.env.APP_DELIVERY_TOKEN
  if (!key) throw new DevError('APP_DELIVERY_TOKEN is not set: the instance\'s deploy key')
  const root = resolve(appFolder)
  const started = Date.now()
  buildApp({ root }, process.env)
  const output = mkdtempSync(join(tmpdir(), 'deliver-'))
  try {
    const { name, version, target } = copyShipped(root, output)
    const response = await fetch(new URL('/deliver/app', address), {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: filesOf(target) }),
    })
    const text = await response.text()
    if (response.status === 404) throw new DevError(`${address} refused the delivery: delivery is off there, or the key is wrong`)
    if (!response.ok) throw new DevError(`${address} refused ${name} ${version}: ${text}`)
    console.log(`delivered ${name} ${version} to ${address} in ${((Date.now() - started) / 1000).toFixed(1)} s: ${JSON.parse(text).outcome}`)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`!! ${error instanceof DevError ? error.message : error.stack ?? error}`)
    process.exit(1)
  })
}
