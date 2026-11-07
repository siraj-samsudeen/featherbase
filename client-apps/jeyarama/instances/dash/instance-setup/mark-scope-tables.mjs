#!/usr/bin/env node
// Instance setup: marks the core Tables Dash's scope provider reads `decides_scope`, so it may read
// them (a read of an unmarked one fails the whole scope closed). Run as a System Manager:
//
//   FEATHERBASE_URL=https://<instance> FEATHERBASE_TOKEN=<token> \
//     node instance-setup/mark-scope-tables.mjs
//
// Idempotent, and it changes nothing but the mark.
import { markScopeTables } from '../../../dash/platform-test/mark-scope-tables.mjs'

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
for (const { table, outcome } of await markScopeTables(request)) console.log(`${table}: ${outcome}`)
