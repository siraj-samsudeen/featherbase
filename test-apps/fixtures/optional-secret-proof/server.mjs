// #666 fixture: an app with a required secret and an optional one (an
// optional embed integration). `quick_view` works without the embed;
// `embed` declares it needs the optional secret; `reach_embed` reaches it
// without declaring it, which the platform must refuse.
export const platformVersion = '2026-10'
export const calls = { handler: 0 }
const secretNames = (context) => {
  calls.handler++
  return { secrets: Object.keys(context.secrets).sort() }
}
// The caption setting can hold a value the app never got as a secret (one
// withheld from this operation); the platform must still keep it in.
const caption = (context) => {
  calls.handler++
  return { caption: context.settings.caption }
}
export const reads = {
  echo_caption: caption,
  outbound_caption: caption,
  log_caption(context) {
    calls.handler++
    console.log('caption is', context.settings.caption)
    return { ok: true }
  },
  throw_caption(context) {
    calls.handler++
    throw new Error(`upstream refused ${context.settings.caption}`)
  },
  quick_view: secretNames,
  embed: secretNames,
  reach_embed(context) {
    calls.handler++
    return { embed: typeof context.secrets.OPTPROOF_EMBED_KEY }
  },
}
// Codex round 2 on #670: what a handler returns or throws is app code too.
// `via` picks the value carried: the required token, or the caption setting
// (which a test fills with an optional secret this action does not need).
const carried = (context) => context.payload.via === 'token' ? context.secrets.OPTPROOF_TOKEN : context.settings.caption
export const actions = {
  note: secretNames,
  echo_caption: caption,
  // A result whose getter refuses with the value when it is serialized.
  getter_rejects(context) {
    calls.handler++
    return { get value() { context.reject(`bad ${carried(context)}`) } }
  },
  // A result whose getter logs the value when it is serialized.
  getter_logs(context) {
    calls.handler++
    return { get value() { console.log('value is', carried(context)); return 'ok' } }
  },
  // An error whose own getter logs the value when it is inspected.
  error_getter_logs(context) {
    calls.handler++
    throw Object.defineProperty(new Error('upstream refused'), 'detail',
      { enumerable: true, get() { console.log('detail is', carried(context)); return 'x' } })
  },
  // A refusal whose message reads harmless while the guard checks it (its
  // stack, then itself), then carries the value when it is answered.
  message_flips(context) {
    calls.handler++
    let reads = 0
    try { context.reject('upstream refused') } catch (error) {
      Object.defineProperty(error, 'message', { get: () => reads++ >= 2 ? `bad ${carried(context)}` : 'upstream refused' })
      throw error
    }
  },
  embed_note: secretNames,
}
