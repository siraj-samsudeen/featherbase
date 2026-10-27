// A CommandIO for in-process tests of an entry point's `main(argv, io)`:
// stdout and stderr are collected as text, and stdin is the given text (or,
// with `tty`, an open stream that reports itself as a terminal).
import { PassThrough, Writable } from 'node:stream'
import { streamIO, type CommandIO } from '../src/command-io'

function sink() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk))
      done()
    },
  })
  return { stream, text: () => chunks.join('') }
}

export interface CapturedIO {
  io: CommandIO
  /** The stdin stream: with `tty`, write to it to type at the console. */
  input: PassThrough
  stdout(): string
  stderr(): string
}

export function captureIO(stdin = '', opts: { tty?: boolean } = {}): CapturedIO {
  const input = new PassThrough()
  if (opts.tty) Object.assign(input, { isTTY: true })
  else input.end(stdin)
  const out = sink()
  const err = sink()
  return { io: streamIO(input, out.stream, err.stream), input, stdout: out.text, stderr: err.text }
}

/** Run an entry point's main in this process and return what it printed. */
export async function runMain(
  main: (argv: string[], io: CommandIO) => Promise<number>,
  argv: string[],
  stdin = '',
): Promise<{ code: number; stdout: string; stderr: string }> {
  const captured = captureIO(stdin)
  const code = await main(argv, captured.io)
  return { code, stdout: captured.stdout(), stderr: captured.stderr() }
}
