// The two guards around the variable registry (instance-settings D6, #465):
// the lint ban on process.env outside src/env.ts, and the generated
// DEPLOY.md table and .env.example that CI keeps current.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkEnvReads, scanSource } from '../scripts/check-env-reads'
import { deployTable, envExample, staleFiles } from '../scripts/generate-env-docs'
import { VARIABLES } from '../src/env'

describe('lint: process.env outside src/env.ts', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  it('flags each form of read and names the line', () => {
    const hits = scanSource([
      "const a = process.env.JWT_SECRET",
      "const b = process.env['SITE_URL']",
      "const { c } = process.env",
      "const d = process .env. PORT",
    ].join('\n'))
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4])
  })

  it('skips comments and Railway\'s own RAILWAY_* variables', () => {
    expect(scanSource([
      '// process.env.JWT_SECRET is read in env.ts',
      '/* process.env.X */ const y = 1',
      '/**',
      ' * process.env.Z',
      ' */',
      "const domain = process.env.RAILWAY_PUBLIC_DOMAIN",
    ].join('\n'))).toEqual([])
  })

  it('a file that reads process.env fails; env.ts itself may', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'env-lint-'))
    dirs.push(dir)
    mkdirSync(path.join(dir, 'nested'))
    writeFileSync(path.join(dir, 'env.ts'), 'export const x = process.env.ANY\n')
    writeFileSync(path.join(dir, 'nested', 'feature.ts'), "export const k = process.env.NEW_FEATURE_KEY ?? ''\n")
    expect(checkEnvReads(dir)).toEqual([{ file: path.join('nested', 'feature.ts'), line: 1, text: "export const k = process.env.NEW_FEATURE_KEY ?? ''" }])
  })

  it('the server source is clean', () => {
    expect(checkEnvReads()).toEqual([])
  })
})

describe('generated variable docs', () => {
  it('DEPLOY.md and .env.example match the registry', () => {
    expect(staleFiles()).toEqual([])
  })

  it('editing a registry entry without regenerating makes both stale', () => {
    const entry = VARIABLES.find((v) => v.name === 'FILE_STORAGE_DIR') as { purpose: string }
    const before = entry.purpose
    entry.purpose = `${before} — edited`
    try {
      expect(staleFiles()).toEqual(['docs/DEPLOY.md', 'apps/server/.env.example'])
    } finally {
      entry.purpose = before
    }
  })

  it('the example file lists every variable, commented out, and marks the secrets and required ones', () => {
    const example = envExample()
    for (const v of VARIABLES) expect(example).toContain(`\n# ${v.name}=\n`)
    expect(example).not.toMatch(/^[A-Z_]+=/m)
    expect(example).toMatch(/required: yes, outside development and test · SECRET · default: dev-secret-change-me\n# JWT_SECRET=/)
    expect(deployTable()).toContain('| `FILE_STORAGE_DIR` | recommended')
  })
})
