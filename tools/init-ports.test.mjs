import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = new URL('..', import.meta.url).pathname
const init = join(root, 'init.sh')

async function command(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function setupCheckout(name) {
  const dir = await mkdtemp(join(tmpdir(), `featherbase-init-${name}-`))
  const bin = join(dir, 'bin')
  await mkdir(join(dir, 'apps/server'), { recursive: true })
  await mkdir(join(dir, 'apps/web'), { recursive: true })
  await mkdir(bin)
  await writeFile(join(dir, 'init.sh'), await (await import('node:fs/promises')).readFile(init))
  await writeFile(
    join(dir, 'server.mjs'),
    `import { createServer } from 'node:http'
const delay = Number(process.env.MOCK_SERVER_DELAY_MS ?? 0)
setTimeout(() => createServer((req, res) => {
  if (req.url === '/api/ping') res.end(JSON.stringify({ message: 'pong', db: true }))
  else res.end('web')
}).listen(Number(process.env.PORT ?? process.env.WEB_PORT)), delay)
`,
  )
  await writeFile(
    join(bin, 'pnpm'),
    `#!/bin/sh
if [ "$1" = "smoke" ]; then
  test "$SERVER_URL" = "http://localhost:$API_PORT" || exit 41
  test "$WEB_URL" = "http://localhost:$WEB_PORT" || exit 42
  exit 0
fi
case "$*" in
  *dev*) exec "${process.execPath}" "$INIT_TEST_ROOT/server.mjs" ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  )
  await writeFile(join(bin, 'psql'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { dir, bin }
}

function initEnv(checkout, extra = {}) {
  return {
    ...process.env,
    PATH: `${checkout.bin}:/usr/bin:/bin`,
    INIT_TEST_ROOT: checkout.dir,
    ...extra,
  }
}

test('init boots isolated selected ports without touching a sibling stack', async (t) => {
  const sibling = await setupCheckout('default')
  const selected = await setupCheckout('selected')
  t.after(async () => {
    await command('pkill', ['-f', sibling.dir])
    await command('pkill', ['-f', selected.dir])
    await Promise.all([rm(sibling.dir, { recursive: true, force: true }), rm(selected.dir, { recursive: true, force: true })])
  })

  const defaultRun = await command('/bin/bash', ['./init.sh'], { cwd: sibling.dir, env: initEnv(sibling) })
  assert.equal(defaultRun.code, 0, defaultRun.stderr)
  assert.match(defaultRun.stdout, /server :8000, web :5173/)

  const selectedRun = await command('/bin/bash', ['./init.sh'], {
    cwd: selected.dir,
    env: initEnv(selected, { API_PORT: '18010', WEB_PORT: '15188' }),
  })
  assert.equal(selectedRun.code, 0, selectedRun.stderr)
  assert.match(selectedRun.stdout, /server :18010, web :15188/)
  assert.equal((await fetch('http://localhost:8000/api/ping')).status, 200)
  assert.equal((await fetch('http://localhost:18010/api/ping')).status, 200)
  assert.equal((await fetch('http://localhost:15188')).status, 200)
})

test('init rejects a listener that did not descend from its selected API process', async (t) => {
  const checkout = await setupCheckout('foreign')
  t.after(async () => {
    await command('pkill', ['-f', checkout.dir])
    await rm(checkout.dir, { recursive: true, force: true })
  })

  const foreign = spawn(process.execPath, [join(checkout.dir, 'server.mjs')], {
    env: { ...process.env, PORT: '18011', MOCK_SERVER_DELAY_MS: '100' },
    detached: true,
    stdio: 'ignore',
  })
  foreign.unref()
  const result = await command('/bin/bash', ['./init.sh'], {
    cwd: checkout.dir,
    env: initEnv(checkout, { API_PORT: '18011', WEB_PORT: '15189', MOCK_SERVER_DELAY_MS: '1000' }),
  })
  assert.notEqual(result.code, 0)
  assert.match(result.stdout, /:18011 is answering, but from PID .*not the/)
  assert.match(result.stdout, /featherbase-server-18011\.log/)
})
