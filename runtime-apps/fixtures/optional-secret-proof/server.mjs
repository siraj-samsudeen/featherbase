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
export const actions = {
  note: secretNames,
  echo_caption: caption,
  embed_note: secretNames,
}
