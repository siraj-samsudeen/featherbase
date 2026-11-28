#!/usr/bin/env node
// #1459: every Table says who reads which of its rows, and a Table with no rule is read by System Managers only.
// An app in this repo that leaves one of its Tables out of `rowRules` would ship it closed by accident, so this
// fails on any such Table. A Sub-table follows the row that holds it and has no rule.
//
//   node tools/check-row-rules.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The Tables of one manifest that have no rule, and the rules that name no Table of it. */
export function rowRuleProblems(manifest) {
  const rules = manifest.rowRules ?? {}
  const tables = (manifest.tables ?? []).filter((table) => table.kind !== 'sub_table').map((table) => table.name)
  return [
    ...tables.filter((name) => !Object.hasOwn(rules, name)).map((name) => `${name} has no row rule`),
    ...Object.keys(rules).filter((name) => !tables.includes(name)).map((name) => `rowRules names ${name}, which is not one of the app's Tables with a rule of its own`),
  ]
}

/** Every app folder under client-apps/<client>/ and example-apps/. */
export function appFolders(root) {
  const folders = []
  const clients = join(root, 'client-apps')
  for (const client of existsSync(clients) ? readdirSync(clients, { withFileTypes: true }) : [])
    if (client.isDirectory())
      for (const app of readdirSync(join(clients, client.name), { withFileTypes: true }))
        if (app.isDirectory()) folders.push(join(clients, client.name, app.name))
  const examples = join(root, 'example-apps')
  for (const app of existsSync(examples) ? readdirSync(examples, { withFileTypes: true }) : [])
    if (app.isDirectory()) folders.push(join(examples, app.name))
  return folders.filter((folder) => existsSync(join(folder, 'featherbase.json'))).sort()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let failed = 0
  for (const folder of appFolders(root)) {
    const problems = rowRuleProblems(JSON.parse(readFileSync(join(folder, 'featherbase.json'), 'utf8')))
    for (const problem of problems) console.error(`${folder.slice(root.length + 1)}: ${problem}`)
    failed += problems.length
  }
  if (failed) {
    console.error(`\n${failed} problem(s). Give each Table a rule in the app's rowRules (docs/design/row-access.md).`)
    process.exit(1)
  }
  console.log('Every app Table has a row rule.')
}
