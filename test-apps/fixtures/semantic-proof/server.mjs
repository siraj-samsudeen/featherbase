// Semantic model fixture: an app that declares a dataset and what it means.
// A model is answered by the platform as the read it names, so `ask` here
// only counts the calls that reach the app's own handler.
export const platformVersion = '2026-10'
export const calls = { handler: 0 }
const run = () => {
  calls.handler++
  return 'the app answered'
}
export const reads = { ask: run, open: run, away: run }
