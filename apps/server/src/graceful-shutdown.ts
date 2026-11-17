import type { Server } from 'node:http'

// #1260: a deploy stops the old server with SIGTERM. The service has a
// volume, so Railway runs the old and new servers one after the other, never
// together: the old one must hand back quickly, but a request it is answering
// must not be cut off (a write cut mid-way is the one a browser cannot safely
// send again). Railway's draining time must be longer than the deadline here.

/** How long requests in flight get to finish before they are cut. */
export const SHUTDOWN_DEADLINE_MS = 25_000

/** Sockets that outlive HTTP (realtime): told to go, or dropped at the deadline. */
export interface ClosableSockets {
  closeAll(): Promise<void>
  terminateAll(): void
}

/** Stop taking connections, let the requests in flight finish, then resolve:
 *  'drained' when they all did, 'cut' when something was still open at the
 *  deadline. One deadline covers every phase. The listener stops taking
 *  connections first, then `sockets` are told to go (Codex, #1260: a socket
 *  that opened while others closed was never told, and held the stop open). */
export async function drainServer(server: Server, deadlineMs: number, sockets?: ClosableSockets): Promise<'drained' | 'cut'> {
  let deadline: ReturnType<typeof setTimeout> | undefined
  const cut = new Promise<'cut'>((resolve) => {
    deadline = setTimeout(() => {
      sockets?.terminateAll()
      server.closeAllConnections()
      resolve('cut')
    }, deadlineMs)
  })
  const closed = new Promise<'drained'>((resolve) => server.close(() => resolve('drained')))
  // A keep-alive connection with no request on it holds close() open until
  // its own timeout, and Node does not close one whose request finishes
  // during the drain (the test pins this): so idle ones are closed now and
  // again every 100 ms, as requests finish.
  server.closeIdleConnections()
  const sweep = setInterval(() => server.closeIdleConnections(), 100)
  try {
    const told = sockets ? sockets.closeAll() : Promise.resolve()
    return await Promise.race([told.then(() => closed), cut])
  } finally {
    clearTimeout(deadline)
    clearInterval(sweep)
  }
}

/** On SIGTERM or SIGINT, drain once and exit: 0 when the drain finished,
 *  1 when it failed. A second signal while draining changes nothing. */
export function exitOnShutdownSignal(
  proc: NodeJS.Process,
  stop: () => Promise<'drained' | 'cut'>,
  exit: (code: number) => void = (code) => proc.exit(code),
): void {
  let stopping = false
  const onSignal = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`${signal}: finishing the requests in flight, then exiting`)
    stop().then(
      (outcome) => {
        console.log(outcome === 'drained'
          ? 'shutdown: every request in flight finished'
          : `shutdown: requests still running after ${SHUTDOWN_DEADLINE_MS / 1000} s were cut`)
        exit(0)
      },
      (error: unknown) => {
        console.error('shutdown failed:', error)
        exit(1)
      },
    )
  }
  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('SIGINT', () => onSignal('SIGINT'))
}
