// #625 fixture: an app that declares a cached dataset and reads it. Each read
// hands its context to `hooks.run`, which a test sets, so one test can look
// at one thing the platform hands the handler. `inside` runs inside the
// authorization transaction; `outside` is declared outbound and runs after it.
export const platformVersion = '2026-10'
export const hooks = { run: async () => null }
export const calls = { handler: 0 }
const run = (context) => {
  calls.handler++
  return hooks.run(context)
}
export const reads = { inside: run, outside: run, unscoped: run }
