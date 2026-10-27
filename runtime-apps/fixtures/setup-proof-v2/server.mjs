// #620 fixture: an app that declares settings, a secret, a role and a role
// suggestion. Each handler shows one thing the platform hands it, or does one
// thing the platform must stop (leaking its secret).
export const platformVersion = '2026-10'
export const calls = { handler: 0 }
const answer = (context) => {
  calls.handler++
  return { settings: context.settings, secrets: Object.keys(context.secrets).sort() }
}
export const reads = {
  config: answer,
  places(context) {
    calls.handler++
    return { places: context.authorization.places.map((place) => place.label) }
  },
  echo_secret(context) {
    calls.handler++
    return { token: context.secrets.SETUPPROOF_TOKEN }
  },
  fail_with_secret(context) {
    calls.handler++
    throw new Error(`upstream refused token ${context.secrets.SETUPPROOF_TOKEN}`)
  },
  log_secret(context) {
    calls.handler++
    console.log('calling upstream with', context.secrets.SETUPPROOF_TOKEN)
    console.error(new Error(`upstream said no to ${context.secrets.SETUPPROOF_TOKEN}`))
    return { ok: true }
  },
  log_then_throw(context) {
    calls.handler++
    console.warn({ token: context.secrets.SETUPPROOF_TOKEN })
    throw new Error('upstream refused')
  },
  reject_with_secret(context) {
    calls.handler++
    context.reject(`bad token ${context.secrets.SETUPPROOF_TOKEN}`)
  },
}
export const actions = {
  record: answer,
  echo_secret(context) {
    calls.handler++
    return { token: context.secrets.SETUPPROOF_TOKEN }
  },
}
