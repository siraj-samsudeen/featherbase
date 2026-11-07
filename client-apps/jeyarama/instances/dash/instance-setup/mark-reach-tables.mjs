#!/usr/bin/env node
// Instance setup for store administration (featherbase#919): marks the
// organisation masters Feather Dash's store reach provider reads, Plant and
// Site Master, `decides_scope`, so a Cluster Manager's stores can be worked out
// (a read of an unmarked one gives the person no reach at all). A Table that
// decides scope is written only by a System Manager from then on. Run as a
// System Manager:
//
//   FEATHERBASE_URL=https://<instance> FEATHERBASE_TOKEN=<token> \
//     node instance-setup/mark-reach-tables.mjs
//
// Idempotent, and it changes nothing but the mark.
import { markScopeTables } from '../../../dash/platform-test/mark-scope-tables.mjs'

export const REACH_TABLES = ['Plant', 'Site Master']

const base = process.env.FEATHERBASE_URL?.replace(/\/+$/, '')
const token = process.env.FEATHERBASE_TOKEN
if (!base || !token) {
  console.error('Set FEATHERBASE_URL and FEATHERBASE_TOKEN (a System Manager access token)')
  process.exit(2)
}
const request = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status} ${JSON.stringify(body.error ?? body)}`)
  return body
}
for (const { table, outcome } of await markScopeTables(request, REACH_TABLES)) console.log(`${table}: ${outcome}`)
