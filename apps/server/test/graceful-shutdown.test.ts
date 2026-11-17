// #1260 item 8: a deploy stops the old server with SIGTERM. It stops taking
// connections, lets the requests in flight finish, and exits; an idle server
// exits at once so the deploy's gap is not made longer.
import { createServer, request as httpRequest, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { drainServer, exitOnShutdownSignal } from '../src/graceful-shutdown'

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })))
}

/** A GET over a keep-alive agent, so the connection stays open after the answer, as a browser's does. */
function get(port: number, agent?: import('node:http').Agent): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('draining the server on shutdown', () => {
  test('a request in flight when the drain starts is answered in full', async () => {
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('finished'), 300))
    const answer = get(port)
    await new Promise((r) => setTimeout(r, 50))
    const outcome = await drainServer(server, 5000)
    expect(await answer).toEqual({ status: 200, body: 'finished' })
    expect(outcome).toBe('drained')
  })

  test('a new connection after the drain starts is refused, so the edge never waits on a server that is leaving', async () => {
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('ok'), 300))
    const inFlight = get(port)
    await new Promise((r) => setTimeout(r, 50))
    const drained = drainServer(server, 5000)
    await expect(get(port)).rejects.toThrow()
    await inFlight
    await drained
  })

  test('an idle server with an open keep-alive connection exits at once', async () => {
    const { server, port } = await listen((_req, res) => res.end('ok'))
    const { Agent } = await import('node:http')
    const agent = new Agent({ keepAlive: true })
    await get(port, agent)
    const started = Date.now()
    expect(await drainServer(server, 5000)).toBe('drained')
    expect(Date.now() - started).toBeLessThan(500)
    agent.destroy()
  })

  test('a keep-alive connection whose request finishes during the drain does not hold the server open', async () => {
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('ok'), 200))
    const { Agent } = await import('node:http')
    const agent = new Agent({ keepAlive: true })
    const answer = get(port, agent)
    await new Promise((r) => setTimeout(r, 50))
    const started = Date.now()
    expect(await drainServer(server, 5000)).toBe('drained')
    expect((await answer).status).toBe(200)
    expect(Date.now() - started).toBeLessThan(1500)
    agent.destroy()
  })

  test('a request still running at the deadline is cut, and the drain ends then', async () => {
    const { server, port } = await listen(() => { /* never answers */ })
    const answer = get(port).catch((error: Error) => error)
    await new Promise((r) => setTimeout(r, 50))
    const started = Date.now()
    expect(await drainServer(server, 300)).toBe('cut')
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(Date.now() - started).toBeLessThan(1500)
    expect(await answer).toBeInstanceOf(Error)
  })

  test('the hook before the close runs first, so realtime sockets are told before the listener goes', async () => {
    const { server } = await listen((_req, res) => res.end('ok'))
    const order: string[] = []
    server.on('close', () => order.push('closed'))
    await drainServer(server, 1000, async () => { order.push('hook') })
    expect(order).toEqual(['hook', 'closed'])
  })
})

describe('the shutdown signal', () => {
  test('SIGTERM stops the server, says so, and exits 0', async () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process
    const stop = vi.fn(async () => 'drained' as const)
    const exit = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      exitOnShutdownSignal(proc, stop, exit)
      ;(proc as unknown as EventEmitter).emit('SIGTERM')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(stop).toHaveBeenCalledTimes(1)
      expect(log.mock.calls.flat()).toContain('SIGTERM: finishing the requests in flight, then exiting')
      expect(log.mock.calls.flat()).toContain('shutdown: every request in flight finished')
    } finally {
      log.mockRestore()
    }
  })

  test('a second signal while draining does not start a second drain', async () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process
    let finish!: () => void
    const stop = vi.fn(() => new Promise<'drained'>((resolve) => { finish = () => resolve('drained') }))
    const exit = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      exitOnShutdownSignal(proc, stop, exit)
      ;(proc as unknown as EventEmitter).emit('SIGTERM')
      ;(proc as unknown as EventEmitter).emit('SIGINT')
      finish()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1))
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  test('a drain that fails still exits, with code 1', async () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process
    const exit = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      exitOnShutdownSignal(proc, async () => { throw new Error('boom') }, exit)
      ;(proc as unknown as EventEmitter).emit('SIGTERM')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    } finally {
      error.mockRestore()
      log.mockRestore()
    }
  })
})
