// The standard streams of a command-line entry point (cli.ts, migrate.ts,
// release.ts, run-patches.ts, smoke.ts). Each exports `main(argv, io)`; run as
// a process it gets `processIO`, and a test passes its own streams to read what
// the command printed and feed it stdin, in this process (ADR 0012).
import type { Readable, Writable } from 'node:stream'

export interface CommandIO {
  /** One line to stdout. */
  out(text: string): void
  /** One line to stderr. */
  err(text: string): void
  /** The whole of stdin, as text. */
  readStdin(): Promise<string>
  /** Whether stdin is a terminal (a person typing) rather than a pipe. */
  stdinIsTTY(): boolean
  /** The interactive console's streams. */
  input(): Readable
  output(): Writable
}

/** A CommandIO over three streams. A stream is only read when a command
 *  reads it, so passing process.stdin here consumes nothing. */
export function streamIO(stdin: Readable, stdout: Writable, stderr: Writable): CommandIO {
  return {
    out: (text) => void stdout.write(`${text}\n`),
    err: (text) => void stderr.write(`${text}\n`),
    readStdin: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Buffer))
      return Buffer.concat(chunks).toString('utf8')
    },
    stdinIsTTY: () => Boolean((stdin as Readable & { isTTY?: boolean }).isTTY),
    input: () => stdin,
    output: () => stdout,
  }
}

export const processIO: CommandIO = streamIO(process.stdin, process.stdout, process.stderr)
