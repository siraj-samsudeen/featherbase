// PLAT-004: developer CLI over the document API. One process = one command.
//   cli migrate                       run pending migrations
//   cli patches                       run pending patches
//   cli seed                          (re)apply idempotent core seed data
//   cli create-doctype --name "X" --field title:Data --field status:Select:Open|Closed [--single]
//   cli create-user <email> <password> [--full-name "Name"] [--roles "System Manager,All"]
//   cli console                       REPL with the document API in scope
import { sql } from './db'
import { createDocType } from './doctype-engine'
import { getDoc, saveDoc } from './document'
import { getList } from './query'
import { getMeta } from './meta'
import { setUserPassword } from './auth'
import { runMigrations } from './migrate'
import { runPatches } from './patches'
import { patches } from '../patches/index'

// --- tiny flag parser: collects --key value, repeatable keys become arrays,
// bare --flags become boolean true, everything else is a positional. --------
function parseArgs(argv: string[]) {
  const flags: Record<string, string | string[] | boolean> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        const prev = flags[key]
        if (prev === undefined) flags[key] = next
        else if (Array.isArray(prev)) prev.push(next)
        else flags[key] = [prev as string, next]
        i++
      }
    } else positional.push(a)
  }
  return { flags, positional }
}

function asArray(v: string | string[] | boolean | undefined): string[] {
  if (v === undefined || typeof v === 'boolean') return []
  return Array.isArray(v) ? v : [v]
}

async function cmdCreateDocType(flags: Record<string, string | string[] | boolean>) {
  const name = flags.name
  if (typeof name !== 'string') throw new Error('create-doctype requires --name')
  const fields = asArray(flags.field).map((spec) => {
    // fieldname:Fieldtype[:Opt1|Opt2]
    const [fieldname, fieldtype, options] = spec.split(':')
    if (!fieldname || !fieldtype) throw new Error(`bad --field "${spec}" (want fieldname:Fieldtype)`)
    return {
      fieldname,
      fieldtype,
      ...(options ? { options: options.split('|').join('\n') } : {}),
    }
  })
  const meta = await createDocType({ name, issingle: flags.single === true, fields })
  console.log(`created DocType ${meta.name} with ${meta.fields.length} field(s)`)
}

async function cmdCreateUser(
  positional: string[],
  flags: Record<string, string | string[] | boolean>,
) {
  const [email, password] = positional
  if (!email || !password) throw new Error('create-user requires <email> <password>')
  const roles = asArray(flags.roles).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean)
  const fullName = typeof flags['full-name'] === 'string' ? (flags['full-name'] as string) : email
  await saveDoc(
    'User',
    {
      name: email,
      email,
      full_name: fullName,
      enabled: true,
      ...(roles.length ? { roles: roles.map((role) => ({ role })) } : {}),
    },
    'Administrator',
  )
  await setUserPassword(email, password)
  console.log(`created user ${email}${roles.length ? ` with roles: ${roles.join(', ')}` : ''}`)
}

async function cmdSeed() {
  // Core seed migrations are written idempotently (ensureDocType/ensureDoc),
  // so re-running them is a safe "seed" that repairs missing core data.
  for (const file of ['0005_core_seeds.ts', '0006_admin_password.ts']) {
    const mod = await import(new URL(`../migrations/${file}`, import.meta.url).href)
    await mod.up()
    console.log(`seeded ${file}`)
  }
  console.log('seed complete')
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function cmdConsole() {
  const context = { sql, getDoc, saveDoc, getList, getMeta, createDocType }
  // Non-interactive (piped/redirected): run the whole stdin script with the
  // document API in scope and AWAIT it, so async work finishes before the
  // connection closes. Interactive: a normal REPL.
  if (!process.stdin.isTTY) {
    const code = await readStdin()
    if (code.trim()) {
      const fn = new AsyncFunction(...Object.keys(context), code)
      await fn(...Object.values(context))
    }
    return
  }
  const repl = await import('node:repl')
  console.log('frappe-clone console — document API in scope: sql, getDoc, saveDoc, getList, getMeta, createDocType')
  const server = repl.start({ prompt: 'fc> ', useGlobal: true })
  Object.assign(server.context, context)
  await new Promise<void>((resolve) => server.on('exit', resolve))
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseArgs(rest)

  switch (cmd) {
    case 'migrate':
      await runMigrations()
      break
    case 'patches': {
      const newly = await runPatches(patches)
      if (newly.length) for (const n of newly) console.log(`applied patch ${n}`)
      console.log(`patches up to date (${patches.length} total)`)
      break
    }
    case 'seed':
      await cmdSeed()
      break
    case 'create-doctype':
      await cmdCreateDocType(flags)
      break
    case 'create-user':
      await cmdCreateUser(positional, flags)
      break
    case 'console':
      await cmdConsole()
      break
    default:
      console.log('usage: cli <migrate|patches|seed|create-doctype|create-user|console> [...]')
      process.exitCode = cmd ? 1 : 0
  }
  await sql.end()
}

main().catch(async (err) => {
  console.error('error:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
})
