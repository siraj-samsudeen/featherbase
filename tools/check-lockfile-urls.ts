// Refuse an scp-style git URL in pnpm-lock.yaml.
//
// This has broken CI twice. pnpm records the URL it actually resolved
// through, and a dev environment that rewrites ssh→https (a corporate proxy,
// an `insteadOf` in ~/.gitconfig, an agent sandbox) resolves
// `git@github.com:owner/repo.git` perfectly well — so the bad URL is written
// into the lockfile by a machine on which it demonstrably works, and the
// author has no local way to notice.
//
// CI runners have no SSH key. There, the same line fails `pnpm install`
// outright with "Permission denied (publickey)" before a single test runs.
//
// The https clone URL works anonymously everywhere, including here, so there
// is never a reason to record the scp form.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCKFILE = resolve(import.meta.dirname, '..', 'pnpm-lock.yaml')

// `git@host:path` — the scp-style form. Matched loosely on purpose: any host,
// not just github.com, since the failure is about the form and not the site.
// Deliberately not /g: a stateful regex reused across lines skips matches.
const SCP_FORM = /\bgit@[\w.-]+:/

const offenders = readFileSync(LOCKFILE, 'utf8')
  .split('\n')
  .map((line, i) => ({ line, number: i + 1 }))
  .filter(({ line }) => SCP_FORM.test(line))

if (offenders.length) {
  console.error(
    `pnpm-lock.yaml records ${offenders.length} scp-style git URL(s). CI has no SSH key,\n` +
      'so `pnpm install` will fail there with "Permission denied (publickey)".\n\n' +
      'Rewrite each to the https clone URL, e.g.\n' +
      '  git+https://git@github.com:owner/repo.git  ->  git+https://github.com/owner/repo.git\n' +
      '  repo: git@github.com:owner/repo.git        ->  repo: https://github.com/owner/repo.git\n',
  )
  for (const { line, number } of offenders.slice(0, 10)) {
    console.error(`  ${LOCKFILE}:${number}: ${line.trim().slice(0, 120)}`)
  }
  process.exit(1)
}

console.log('pnpm-lock.yaml: no scp-style git URLs')
