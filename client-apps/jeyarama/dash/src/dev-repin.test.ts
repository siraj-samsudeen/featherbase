// scripts/dev-repin.sh refuses any database not stamped `development`. The
// database is a system boundary, so `psql` is a stub on PATH that answers the
// script's stamp queries as a database stamped `staging` would.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SENTINEL = 'sentinel-password-b6p1'
const script = resolve(import.meta.dirname, '../scripts/dev-repin.sh')

function stubPsql(stamp: string) {
  const bin = mkdtempSync(join(tmpdir(), 'dev-repin-'))
  writeFileSync(join(bin, 'psql'), `#!/bin/sh
query="$(cat)"
case "$query" in
  *to_regclass*) echo t ;;
  *internal_metadata*) echo ${stamp} ;;
esac
`)
  chmodSync(join(bin, 'psql'), 0o755)
  return bin
}

describe('dev-repin on a database not stamped development', () => {
  it('never prints the database password', () => {
    const run = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env,
      PATH: `${stubPsql('staging')}:${process.env.PATH}`,
      DATABASE_URL: `postgres://postgres:${SENTINEL}@db.example.test:5432/feather_dash` } })
    expect(run.status).not.toBe(0)
    expect(run.stdout + run.stderr).not.toContain(SENTINEL)
  })
})
