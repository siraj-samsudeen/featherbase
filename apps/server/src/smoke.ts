// Asserts the RUNNING server is healthy. Does not boot anything itself.
const base = process.env.SERVER_URL ?? 'http://localhost:8000'

const res = await fetch(`${base}/api/ping`)
if (!res.ok) {
  console.error(`smoke: /api/ping returned ${res.status}`)
  process.exit(1)
}
const body = (await res.json()) as { message?: string; db?: boolean }
if (body.message !== 'pong' || body.db !== true) {
  console.error(`smoke: unexpected ping body ${JSON.stringify(body)}`)
  process.exit(1)
}
console.log('server smoke OK')
